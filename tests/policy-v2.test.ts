import test from "node:test";
import assert from "node:assert/strict";
import { policySchema, hashPolicy } from "../src/lib/policy-v2.js";
import {
  hashPolicy as hashAny,
  toContractPolicy,
} from "../src/lib/signing-policy.js";
import { decodeFunctionData } from "viem";
import { policyWalletAbi } from "../src/lib/signing-policy.js";
import {
  groupChainTransaction,
  type GroupChainState,
} from "../src/lib/group-chain.js";
const address = (value: number) =>
  `0x${value.toString(16).padStart(40, "0")}` as `0x${string}`;
const fixture = {
  policyVersion: 2,
  chainId: 11155111,
  verifyingContract: address(0x40),
  decisionId: `0x${"a1".padStart(64, "0")}`,
  token: address(0x10),
  merchant: address(0x20),
  executor: address(0x30),
  participants: [1, 2, 3, 4].map(address),
  approvalThreshold: 4,
  contributionPerParticipant: "10000000",
  paymentAmount: "36000000",
  maxDeposit: "40000000",
  maxTotalSpend: "40000000",
  expiry: 2000000000,
  reservationReference: `0x${"b2".padStart(64, "0")}`,
};
test("v2 dynamic policy has the Solidity hash and encodes all members in registration", () => {
  const policy = policySchema.parse(fixture);
  assert.equal(
    hashPolicy(policy),
    "0xa9c8275283b0c6c73b34f016e76ec581def91cdb789e79dfa80f57503ac83a84",
  );
  assert.equal(hashAny(policy), hashPolicy(policy));
  const saved = {
    policy,
    policyHash: hashPolicy(policy),
    createdAt: "2026-09-29T00:00:00Z",
  };
  const state: GroupChainState = {
    policyHash: saved.policyHash,
    blockNumber: "1",
    timestamp: 1,
    registered: false,
    status: null,
    approvals: 0,
    contributed: "0",
    spent: "0",
    refunded: "0",
    members: policy.participants.map((member) => ({
      address: member,
      contribution: "0",
    })),
    actor: address(1),
    balance: "0",
    allowance: "0",
    refund: "0",
  };
  const tx = groupChainTransaction(
    saved,
    policy,
    address(1),
    state,
    "register",
  );
  const decoded = decodeFunctionData({
    abi: policyWalletAbi(policy),
    data: tx.data,
  });
  assert.equal(decoded.functionName, "createDecision");
  assert.deepEqual(decoded.args?.[0], toContractPolicy(policy));
});
test("v2 enforces all-member approval, capacity, unique wallets and bounded funding", () => {
  for (const changed of [
    { approvalThreshold: 3 },
    { participants: [address(1)] },
    { participants: [...fixture.participants, address(1)] },
    { paymentAmount: "41000000" },
    { policyVersion: 1 },
  ])
    assert.equal(
      policySchema.safeParse({ ...fixture, ...changed }).success,
      false,
    );
  for (const count of [2, 8, 100]) {
    const policy = {
      ...fixture,
      participants: Array.from({ length: count }, (_, i) => address(i + 100)),
      approvalThreshold: count,
      paymentAmount: "1",
      maxDeposit: "1",
      maxTotalSpend: "1",
    };
    assert.equal(policySchema.safeParse(policy).success, true);
    assert.notEqual(hashPolicy(policy), hashPolicy(fixture));
  }
});
