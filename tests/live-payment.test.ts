import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  buildLivePayment,
  livePaymentTermsSchema,
} from "../src/lib/discovery/live-payment";
import { LivePlanRepository } from "../src/lib/db/live-plans";
import { fundGroupMembers } from "../src/lib/jobs/group-test-funds";
import { createHash } from "node:crypto";
const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const members = [address(1), address(2), address(3)];
const terms = {
  recommendationRevision: "revision",
  placeId: "place",
  amount: "10",
  recipient: address(4),
  acknowledgeTestPayment: true as const,
};
const config = {
  chainId: 11155111,
  policyVersion: 2 as const,
  verifyingContract: address(10),
  token: address(11),
  executor: address(12),
};
const input = {
  terms,
  config,
  groupId: "group",
  members,
  startsAt: new Date(Date.now() + 7200000).toISOString(),
  nowSeconds: Math.floor(Date.now() / 1000),
};
test("live payment splits exact test amount without floating point loss; binds recipient and requires every member", () => {
  const saved = buildLivePayment(input);
  assert.equal(saved.policy.paymentAmount, "10000000");
  assert.equal(saved.policy.contributionPerParticipant, "3333334");
  assert.equal(saved.policy.maxTotalSpend, "10000002");
  assert.equal(saved.policy.approvalThreshold, 3);
  assert.notEqual(
    buildLivePayment({ ...input, terms: { ...terms, recipient: address(5) } })
      .policyHash,
    saved.policyHash,
  );
  for (const amount of ["", "0", "-1", "1e3", "1.0000001", "abc"])
    assert.equal(
      livePaymentTermsSchema.safeParse({ ...terms, amount }).success,
      false,
    );
  assert.throws(
    () =>
      buildLivePayment({
        ...input,
        terms: { ...terms, recipient: config.verifyingContract },
      }),
    /INVALID_PAYMENT_RECIPIENT/,
  );
  assert.throws(
    () => buildLivePayment({ ...input, config: { ...config, chainId: 1 } }),
    /TEST_PAYMENT_NOT_CONFIGURED/,
  );
});
function repository(mode: string) {
  const statements: string[] = [];
  const rows = members.map((wallet_address, i) => ({
    wallet_address,
    revision_id: `r${i}`,
    confirmed: true,
    extraction: { requirements: [], clarifications: [] },
  }));
  const preferenceRevision = createHash("sha256")
    .update(JSON.stringify(rows.map((r) => [r.wallet_address, r.revision_id])))
    .digest("hex");
  const client = {
    release() {},
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes("SELECT g.*"))
        return {
          rows: [
            {
              creator_wallet: address(1),
              target_member_count: 3,
              preferences_locked: false,
              reservation_starts_at: new Date(input.startsAt),
              snapshot: {
                places: [{ id: "place" }],
                recommendationReady: true,
                recommendationRevision: "revision",
                preferenceRevision:
                  mode === "stale" ? "old" : preferenceRevision,
              },
              votes: Object.fromEntries(
                members.map((a, i) => [
                  a,
                  mode === "split" && i === 2 ? "other" : "place",
                ]),
              ),
            },
          ],
        };
      if (sql.includes("SELECT policy,policy_hash")) return { rows: [] };
      if (sql.includes("SELECT p.wallet_address")) return { rows: rows };
      if (sql.includes("SELECT wallet_address"))
        return { rows: members.map((wallet_address) => ({ wallet_address })) };
      return { rows: [], rowCount: 1 };
    },
  };
  return {
    repo: new LivePlanRepository({
      connect: async () => client,
    } as unknown as Pool),
    statements,
  };
}
test("only organizer can freeze unanimous current preferences into immutable payment terms", async () => {
  for (const mode of ["other", "stale", "split"]) {
    const { repo, statements } = repository(mode);
    await assert.rejects(
      repo.prepare(
        "group",
        mode === "other" ? address(2) : address(1),
        config,
        terms,
      ),
      /NOT_CREATOR|STALE_RECOMMENDATION|UNANIMOUS_CHOICE_REQUIRED/,
    );
    assert.ok(
      !statements.some((s) =>
        s.startsWith("INSERT INTO converge_group_policies"),
      ),
    );
    assert.ok(statements.includes("ROLLBACK"));
  }
  const { repo, statements } = repository("valid");
  const saved = await repo.prepare("group", address(1), config, terms);
  assert.equal(saved.policy.approvalThreshold, 3);
  assert.ok(statements.some((s) => s.includes("preferences_locked=true")));
  assert.ok(statements.includes("COMMIT"));
});
test("group grants use actual member wallets and chosen shares, skip paid members and stop after completion", async () => {
  const saved = { ...buildLivePayment(input), groupId: "group" };
  const calls: unknown[][] = [];
  const worker = {
    ledger: {},
    deployer: { address: address(20) },
    transact: async () => {},
    provision: async (...args: unknown[]) => {
      calls.push(args);
      return true;
    },
  } as unknown as Parameters<typeof fundGroupMembers>[0];
  const chain = {
    registered: true,
    status: 0,
    members: members.map((address, i) => ({
      address,
      contribution: i === 0 ? "3333334" : "0",
      approved: i === 0,
    })),
  };
  await fundGroupMembers(worker, saved, async () => chain);
  assert.deepEqual(
    calls.map((c) => c[1]),
    members.slice(1),
  );
  assert.ok(calls.every((c) => c[5] === 3333334n));
  calls.length = 0;
  await fundGroupMembers(worker, saved, async () => ({ ...chain, status: 2 }));
  assert.equal(calls.length, 0);
});

test("server prepares group-sized test terms and rejects client-selected amounts or recipients", async () => {
  const { automaticGroupPaymentTerms } =
    await import("../src/lib/server/group-config");
  const request = {
    placeId: "place",
    recommendationRevision: "revision",
    acknowledgeTestPayment: true,
  };
  const prepared = automaticGroupPaymentTerms(request, 2, {});
  assert.equal(prepared.amount, "20");
  assert.equal(automaticGroupPaymentTerms(request, 3, {}).amount, "30");
  assert.equal(
    automaticGroupPaymentTerms(request, 3, {
      GROUP_TEST_PAYMENT_PER_PERSON_USDC: "2.5",
    }).amount,
    "7.5",
  );
  assert.throws(() =>
    automaticGroupPaymentTerms({ ...request, amount: "999" }, 2, {}),
  );
  assert.throws(() =>
    automaticGroupPaymentTerms({ ...request, recipient: address(9) }, 2, {}),
  );
  assert.throws(() =>
    automaticGroupPaymentTerms(request, 2, {
      GROUP_TEST_PAYMENT_PER_PERSON_USDC: "0",
    }),
  );
  const saved = buildLivePayment({
    ...input,
    members: members.slice(0, 2),
    terms: prepared,
  });
  assert.equal(saved.policy.contributionPerParticipant, "10000000");
  assert.equal(saved.policy.approvalThreshold, 2);
});
