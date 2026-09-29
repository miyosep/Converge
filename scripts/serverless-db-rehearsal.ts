import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex, type Hex } from "viem";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { DatabaseExploreStore } from "../src/lib/explore/database-store.js";
import { JobLease, withJobLease } from "../src/lib/jobs/lease.js";
import {
  explorePersistence,
  pendingSigner,
  ServerlessGroupRepository,
} from "../src/lib/jobs/journal.js";
import {
  executeJournaled,
  type JournalTransaction,
} from "./lib/transaction-journal.js";
import { groupPolicyConfig } from "../src/lib/server/group-config.js";
import { hashPolicy, policySchema } from "../src/lib/policy.js";

// Synthetic records on an explicitly selected disposable branch. No RPC, LLM,
// Google, Inngest or wallet credentials are loaded or used by this rehearsal.
async function main() {
  if (
    process.env.NEON_BRANCH !== "dev-vercel-inngest" ||
    !process.env.DATABASE_URL
  )
    throw new Error("Isolated serverless test branch required");
  const pool = new Pool({
    connectionString: verifiedPostgresUrl(process.env.DATABASE_URL),
    max: 5,
  });
  const signer = privateKeyToAccount(generatePrivateKey());
  const judge = privateKeyToAccount(generatePrivateKey());
  const group = `serverless-test-${randomUUID()}`,
    evaluation = randomUUID();
  const decision = keccak256(stringToHex(group));
  const leaseName = `rehearsal:${group}`;
  const store = new DatabaseExploreStore(pool);
  let runId = "";
  const policy = policySchema.parse({
    ...groupPolicyConfig,
    executor: signer.address,
    policyVersion: 1,
    decisionId: decision,
    reservationReference: keccak256(stringToHex(evaluation)),
    merchant: judge.address,
    participants: Array.from(
      { length: 6 },
      () => privateKeyToAccount(generatePrivateKey()).address,
    ),
    approvalThreshold: 6,
    contributionPerParticipant: "10000000",
    paymentAmount: "45000000",
    maxDeposit: "60000000",
    maxTotalSpend: "60000000",
    expiry: Math.floor(Date.now() / 1000) + 3600,
  });
  try {
    const run = await store.create(judge.address, 20);
    runId = run.id;
    assert.equal(
      (await new DatabaseExploreStore(pool).read(runId))?.judge,
      judge.address,
    );
    await store.queue(judge.address, {
      action: "extract",
      text: "Quiet and under $35",
    });
    await assert.rejects(
      store.queue(judge.address, { action: "extract", text: "duplicate" }),
      /DEMO_BUSY/,
    );
    await store.withRunLock(runId, async () => {
      await assert.rejects(
        new DatabaseExploreStore(pool).queue(judge.address, {
          action: "extract",
          text: "race",
        }),
        /DEMO_BUSY/,
      );
    });
    await pool.query(
      "INSERT INTO converge_groups(id,name,reservation_starts_at,reservation_time_zone,creator_wallet) VALUES($1,'Synthetic serverless test',now()+interval '1 day','Asia/Seoul',$2)",
      [group, judge.address.toLowerCase()],
    );
    await pool.query(
      "INSERT INTO converge_evaluations(id,group_id,input_snapshot,internal_result) VALUES($1,$2,'{}','{}')",
      [evaluation, group],
    );
    await pool.query(
      "INSERT INTO converge_group_policies(decision_id,group_id,evaluation_id,policy,policy_hash) VALUES($1,$2,$3,$4::jsonb,$5)",
      [decision, group, evaluation, JSON.stringify(policy), hashPolicy(policy)],
    );
    await withJobLease(pool, leaseName, async (lease) => {
      await assert.rejects(
        withJobLease(pool, leaseName, async () => {}),
        /JOB_BUSY/,
      );
      const p = explorePersistence(pool, lease);
      const id = `${runId}:test payment`;
      const intent = {
        chainId: 11155111,
        from: signer.address,
        to: judge.address,
        data: "0x" as Hex,
        valueWei: "0",
      };
      const serialized = await signer.signTransaction({
        chainId: 11155111,
        to: judge.address,
        nonce: 0,
        value: 0n,
        gas: 21000n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
        type: "eip1559",
      });
      let signatures = 0,
        sends = 0;
      const options = {
        intent,
        load: async () => (await p.load())[id],
        prepare: async () => {
          signatures++;
          return serialized;
        },
        save: async (journal: JournalTransaction) =>
          p.save(id, { ...journal, confirmed: false, reservedWei: "42" }),
        findReceipt: async (_hash: Hex): Promise<string | undefined> =>
          undefined,
        broadcast: async () => {
          sends++;
          throw new Error("Simulated lost response");
        },
        waitReceipt: async () => "mined",
      };
      await assert.rejects(executeJournaled(options), /lost response/);
      assert.equal(
        await pendingSigner(pool, signer.address, "group:other"),
        true,
      );
      const repo = new ServerlessGroupRepository(pool, lease, signer.address);
      const entry = (await p.load())[id]!;
      // Cross-mode guard: a pending Explore signature blocks ordinary-group signing.
      assert.equal(await repo.pendingOther(decision), true);
      await assert.rejects(repo.save(decision, entry, 42n, 10n ** 20n));
      assert.equal(await repo.load(decision), undefined);
      const replay = await executeJournaled({
        ...options,
        broadcast: async (value: Hex) => {
          sends++;
          assert.equal(value, serialized);
          return keccak256(value);
        },
      });
      assert.equal(replay.receipt, "mined");
      assert.equal(signatures, 1);
      assert.equal(sends, 2);
      await p.save(id, { ...entry, confirmed: true });
      await repo.save(
        decision,
        { ...entry, hash: keccak256(stringToHex("group-test")) },
        42n,
        10n ** 20n,
      );
      assert.equal(await p.pendingOther(signer.address, "new-explore"), true);
      await repo.status(decision, "confirmed");
      assert.equal(await p.pendingOther(signer.address, "new-explore"), false);
      await assert.rejects(
        p.save(id, { ...entry, hash: keccak256(stringToHex("replacement")) }),
        /IMMUTABLE_TRANSACTION/,
      );
      // A stale owner cannot write after its lease expires and another invocation takes over.
      await pool.query(
        "UPDATE converge_job_leases SET expires_at=now()-interval '1 second' WHERE name=$1",
        [leaseName],
      );
      await withJobLease(pool, leaseName, async () => {
        await assert.rejects(p.save(id, entry), /JOB_LEASE_LOST/);
        await assert.rejects(
          repo.status(decision, "pending"),
          /JOB_LEASE_LOST/,
        );
      });
    });
    const dead = new JobLease(pool, leaseName, randomUUID());
    const fencedStore = new DatabaseExploreStore(pool, dead);
    await assert.rejects(
      fencedStore.withRunLock(runId, async () => fencedStore.save(run)),
      /JOB_LEASE_LOST/,
    );
    console.log(
      "Serverless DB rehearsal passed: persistence, duplicate delivery, cross-mode signer exclusion, transaction replay, atomic rollback and expired-lease fencing. No external side effects.",
    );
  } finally {
    await pool.query(
      "DELETE FROM converge_job_transactions WHERE id LIKE $1 OR id=$2",
      [`explore:${runId}:%`, `group:${decision}`],
    );
    await pool.query("DELETE FROM converge_explore_runs WHERE id=$1", [runId]);
    await pool.query(
      "DELETE FROM converge_group_execution WHERE decision_id=$1",
      [decision],
    );
    await pool.query(
      "DELETE FROM converge_group_policies WHERE decision_id=$1",
      [decision],
    );
    await pool.query("DELETE FROM converge_evaluations WHERE id=$1", [
      evaluation,
    ]);
    await pool.query("DELETE FROM converge_groups WHERE id=$1", [group]);
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Serverless DB rehearsal failed. Credentials and provider details withheld.",
  );
  process.exitCode = 1;
});
