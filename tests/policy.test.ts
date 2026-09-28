import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPolicy, policySchema } from "../src/lib/policy.js";

const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}`;

const policy = {
  policyVersion: 1,
  chainId: 11155111,
  verifyingContract: address(0x40),
  decisionId: `0x${"0".repeat(62)}a1`,
  token: address(0x10),
  merchant: address(0x20),
  executor: address(0x30),
  participants: [1, 2, 3, 4, 5, 6].map(address),
  approvalThreshold: 6,
  contributionPerParticipant: "10000000",
  paymentAmount: "45000000",
  maxDeposit: "60000000",
  maxTotalSpend: "60000000",
  expiry: 2_000_000_000,
  reservationReference: `0x${"0".repeat(62)}b2`,
};

test("policy v1 has the frozen ABI hash", () => {
  assert.equal(
    hashPolicy(policy),
    "0x27249362b6aa82ae82b8965184ed2a770fa09293dc4cdc6ff7fbd6552bb1fdda",
  );
});

test("every variable policy field changes the hash", () => {
  const flexible = {
    ...policy,
    maxDeposit: "50000000",
    maxTotalSpend: "55000000",
  };
  const original = hashPolicy(flexible);
  const variants = [
    { chainId: 1 },
    { verifyingContract: address(0x41) },
    { decisionId: `0x${"0".repeat(62)}a2` },
    { token: address(0x11) },
    { merchant: address(0x21) },
    { executor: address(0x31) },
    { participants: [2, 1, 3, 4, 5, 6].map(address) },
    { contributionPerParticipant: "11000000" },
    { paymentAmount: "44000000" },
    { maxDeposit: "51000000" },
    { maxTotalSpend: "56000000" },
    { expiry: policy.expiry + 1 },
    { reservationReference: `0x${"0".repeat(62)}b3` },
  ];
  for (const variant of variants) {
    const changed = { ...flexible, ...variant };
    assert.equal(policySchema.safeParse(changed).success, true);
    assert.notEqual(hashPolicy(changed), original);
  }
});

test("policy rejects unsupported version and threshold", () => {
  assert.equal(
    policySchema.safeParse({ ...policy, policyVersion: 2 }).success,
    false,
  );
  assert.equal(
    policySchema.safeParse({ ...policy, approvalThreshold: 5 }).success,
    false,
  );
});

test("policy rejects extra fields, invalid funding, and duplicate members", () => {
  assert.equal(
    policySchema.safeParse({ ...policy, note: "private" }).success,
    false,
  );
  assert.equal(
    policySchema.safeParse({ ...policy, paymentAmount: "61000000" }).success,
    false,
  );
  assert.equal(
    policySchema.safeParse({
      ...policy,
      participants: [1, 1, 3, 4, 5, 6].map(address),
    }).success,
    false,
  );
  assert.equal(
    policySchema.safeParse({ ...policy, decisionId: `0x${"0".repeat(64)}` })
      .success,
    false,
  );
  assert.equal(
    policySchema.safeParse({
      ...policy,
      contributionPerParticipant: ((1n << 256n) / 6n + 1n).toString(),
    }).success,
    false,
  );
  assert.equal(
    policySchema.safeParse({
      ...policy,
      merchant: policy.verifyingContract,
    }).success,
    false,
  );
});
