import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { GroupExecutionRepository } from "../src/lib/db/group-execution.js";
import { groupPolicyConfig } from "../src/lib/server/group-config.js";
import { hashPolicy, policySchema } from "../src/lib/policy.js";
import type { GroupChainState } from "../src/lib/group-chain.js";

async function main() {
  if (
    process.env.NEON_BRANCH !== "dev-preferences" ||
    !process.env.DATABASE_URL
  )
    throw new Error("Development database required");
  const pool = new Pool({
    connectionString: verifiedPostgresUrl(process.env.DATABASE_URL),
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  const group = `execution-test-${randomUUID()}`,
    evaluation = randomUUID(),
    id = keccak256(stringToHex(group));
  const address = (n: number) =>
    `0x${n.toString(16).padStart(40, "0")}` as Address;
  const policy = policySchema.parse({
    ...groupPolicyConfig,
    policyVersion: 1,
    decisionId: id,
    reservationReference: keccak256(stringToHex(evaluation)),
    merchant: address(99),
    participants: [1, 2, 3, 4, 5, 6].map(address),
    approvalThreshold: 6,
    contributionPerParticipant: "10000000",
    paymentAmount: "45000000",
    maxDeposit: "60000000",
    maxTotalSpend: "60000000",
    expiry: Math.floor(Date.now() / 1000) + 3600,
  });
  const hash = hashPolicy(policy),
    txHash = `0x${"a".repeat(64)}` as Hex,
    blockHash = `0x${"b".repeat(64)}` as Hex;
  try {
    await pool.query(
      "INSERT INTO converge_groups(id,name,reservation_starts_at,reservation_time_zone,creator_wallet) VALUES($1,'Synthetic execution test',now()+interval '1 day','Asia/Seoul',$2)",
      [group, address(1)],
    );
    await pool.query(
      "INSERT INTO converge_participants(group_id,wallet_address,display_name) VALUES($1,$2,'Synthetic participant')",
      [group, address(1)],
    );
    await pool.query(
      "INSERT INTO converge_evaluations(id,group_id,input_snapshot,internal_result) VALUES($1,$2,'{}','{}')",
      [evaluation, group],
    );
    await pool.query(
      "INSERT INTO converge_group_policies(decision_id,group_id,evaluation_id,policy,policy_hash) VALUES($1,$2,$3,$4::jsonb,$5)",
      [id, group, evaluation, JSON.stringify(policy), hash],
    );
    const repo = new GroupExecutionRepository(pool);
    const journal = {
      intent: {
        chainId: 11155111,
        from: policy.executor,
        to: policy.verifyingContract,
        data: "0x" as Hex,
        valueWei: "0",
      },
      hash: txHash,
      serialized: "0x01" as Hex,
    };
    await assert.rejects(
      repo.save(id, journal, 100n, 0n),
      /GROUP_GAS_BUDGET_EXCEEDED/,
    );
    assert.equal(await repo.load(id), undefined);
    await repo.save(id, journal, 100n, 1000000000000000000n);
    await assert.rejects(repo.save(id, journal, 100n, 1000000000000000000n));
    assert.deepEqual(await repo.load(id), journal);
    assert.equal(await repo.pendingOther(`0x${"c".repeat(64)}`), true);
    const state: GroupChainState = {
      policyHash: hash,
      blockNumber: "20",
      timestamp: Math.floor(Date.now() / 1000),
      registered: true,
      status: 2,
      approvals: 6,
      contributed: "60000000",
      spent: "45000000",
      refunded: "0",
      members: policy.participants.map((address) => ({
        address,
        contribution: "10000000",
      })),
      actor: address(1),
      balance: "0",
      allowance: "0",
      refund: "2500000",
    };
    const event = {
      kind: "PaymentExecuted",
      hash: txHash,
      blockNumber: "20",
      blockHash,
      logIndex: 1,
      merchant: policy.merchant,
      amount: "45000000",
    };
    await repo.record(id, state, blockHash, 0n, [event]);
    await repo.record(id, state, blockHash, 0n, [event]);
    await repo.status(id, "confirmed");
    const visible = await repo.history(group, address(1));
    assert.equal(visible.events.length, 1);
    assert.equal(visible.execution?.status, "confirmed");
    assert.equal(visible.snapshot?.state.spent, "45000000");
    assert.doesNotMatch(JSON.stringify(visible), /serialized|journal|0x01/);
    assert.deepEqual(await repo.history(group, address(2)), {
      snapshot: null,
      events: [],
      execution: null,
    });
    await repo.record(
      id,
      { ...state, status: 1, spent: "0" },
      blockHash,
      0n,
      [],
    );
    assert.equal((await repo.history(group, address(1))).events.length, 0);
    console.log(
      "PASS: Neon dev execution journal persistence, budget rejection, unique attempts, event replay, reorg replacement, member-scoped history and private journal omission.",
    );
  } finally {
    // Only this rehearsal's randomly identified rows are removed.
    for (const table of [
      "converge_group_chain_events",
      "converge_group_chain_snapshots",
      "converge_group_execution",
      "converge_group_policies",
    ])
      await pool.query(`DELETE FROM ${table} WHERE decision_id=$1`, [id]);
    await pool.query("DELETE FROM converge_evaluations WHERE id=$1", [
      evaluation,
    ]);
    await pool.query("DELETE FROM converge_participants WHERE group_id=$1", [
      group,
    ]);
    await pool.query("DELETE FROM converge_groups WHERE id=$1", [group]);
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Development execution persistence rehearsal failed; no credentials printed.",
  );
  process.exitCode = 1;
});
