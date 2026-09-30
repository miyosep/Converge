import assert from "node:assert/strict";
import test from "node:test";
import { type Address, type PublicClient } from "viem";
import { hashPolicy, policySchema } from "../src/lib/policy.js";
import {
  readGroupChain,
  groupChainTransaction,
  prepareGroupChainAction,
  type GroupChainState,
} from "../src/lib/group-chain.js";

const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const policy = policySchema.parse({
  policyVersion: 1,
  chainId: 11155111,
  verifyingContract: address(20),
  token: address(21),
  executor: address(22),
  merchant: address(23),
  participants: [1, 2, 3, 4, 5, 6].map(address),
  approvalThreshold: 6,
  decisionId: `0x${"a".repeat(64)}`,
  reservationReference: `0x${"b".repeat(64)}`,
  contributionPerParticipant: "10000000",
  paymentAmount: "45000000",
  maxDeposit: "60000000",
  maxTotalSpend: "60000000",
  expiry: 2000000000,
});
const saved = {
  policy,
  policyHash: hashPolicy(policy),
  createdAt: "2026-09-29T00:00:00Z",
};
const state: GroupChainState = {
  policyHash: saved.policyHash,
  blockNumber: "9",
  timestamp: 1900000000,
  registered: true,
  status: 0,
  approvals: 0,
  contributed: "0",
  spent: "0",
  refunded: "0",
  members: policy.participants.map((address) => ({
    address,
    contribution: "0",
  })),
  actor: address(1),
  balance: "10000000",
  allowance: "10000000",
  refund: "0",
};

test("server preflight simulates exact policy calldata and cannot submit transactions", async () => {
  const calls: unknown[] = [];
  const client = {
    getChainId: async () => 11155111,
    getBlockNumber: async () => 10n,
    getBlock: async () => ({ hash: "stable", timestamp: 1900000000n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "token") return policy.token;
      if (functionName === "getDecision")
        return [saved.policyHash, 0, 0n, 0n, 0n, 0n];
      if (functionName === "balanceOf") return 10000000n;
      return 0n;
    },
    estimateGas: async (tx: unknown) => {
      calls.push(tx);
      return 100000n;
    },
    call: async (tx: unknown) => {
      calls.push(tx);
      return {};
    },
    sendTransaction: async () => {
      assert.fail("preflight must never submit");
    },
  } as unknown as PublicClient;
  const prepared = await prepareGroupChainAction(
    client,
    saved,
    policy,
    address(1),
    "allowance",
  );
  const tx = groupChainTransaction(
    saved,
    policy,
    address(1),
    prepared.state,
    "allowance",
  );
  assert.equal(prepared.gas, "120000");
  assert.deepEqual(calls, [
    { ...tx, account: address(1) },
    { ...tx, account: address(1), gas: 120000n },
  ]);
  await assert.rejects(
    prepareGroupChainAction(client, saved, policy, address(99), "allowance"),
    /NOT_POLICY_PARTICIPANT/,
  );
  await assert.rejects(
    prepareGroupChainAction(
      { ...client, estimateGas: async () => 16000000n } as PublicClient,
      saved,
      policy,
      address(1),
      "allowance",
    ),
    /GAS_LIMIT_EXCEEDED/,
  );
  await assert.rejects(
    prepareGroupChainAction(
      {
        ...client,
        call: async () => {
          throw new Error("simulation failed");
        },
      } as unknown as PublicClient,
      saved,
      policy,
      address(1),
      "allowance",
    ),
    /simulation failed/,
  );
});

test("group transactions reject changed actors, deployment, expired policies and altered chain identity", () => {
  assert.throws(
    () => groupChainTransaction(saved, policy, address(2), state, "contribute"),
    /STALE_CHAIN_STATE/,
  );
  assert.throws(
    () =>
      groupChainTransaction(
        saved,
        { ...policy, token: address(99) },
        address(1),
        state,
        "allowance",
      ),
    /WRONG_DEPLOYMENT/,
  );
  assert.throws(
    () =>
      groupChainTransaction(
        saved,
        policy,
        address(1),
        { ...state, timestamp: policy.expiry },
        "contribute",
      ),
    /CONTRIBUTION_UNAVAILABLE/,
  );
  assert.throws(
    () =>
      groupChainTransaction(
        saved,
        policy,
        address(1),
        { ...state, policyHash: `0x${"0".repeat(64)}` },
        "contribute",
      ),
    /STALE_CHAIN_STATE/,
  );
});

test("RPC failures never become an unregistered policy or actionable balance", async () => {
  const client = {
    getChainId: async () => 11155111,
    getBlockNumber: async () => 10n,
    getBlock: async () => ({ hash: "block", timestamp: 1900000000n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "token") return policy.token;
      throw new Error("RPC_UNAVAILABLE");
    },
  } as unknown as PublicClient;
  await assert.rejects(
    readGroupChain(client, saved, policy, address(1), 2, 10n),
    /UNCONFIRMED_SNAPSHOT_BLOCK/,
  );
  await assert.rejects(
    readGroupChain(client, saved, policy, address(1)),
    /RPC_UNAVAILABLE/,
  );
  await assert.rejects(
    readGroupChain(
      { ...client, getChainId: async () => 1 } as PublicClient,
      saved,
      policy,
      address(1),
    ),
    /WRONG_CHAIN/,
  );
});

test("reorganized chain snapshots are rejected and every balance uses the same block", async () => {
  let blocks = 0;
  const client = {
    getChainId: async () => 11155111,
    getBlockNumber: async () => 10n,
    getBlock: async () => ({
      hash: ++blocks === 1 ? "old" : "new",
      timestamp: 1900000000n,
    }),
    readContract: async ({
      functionName,
      blockNumber,
    }: {
      functionName: string;
      blockNumber: bigint;
    }) => {
      assert.equal(blockNumber, 9n);
      if (functionName === "token") return policy.token;
      if (functionName === "getDecision")
        return [saved.policyHash, 0, 0n, 0n, 0n, 0n];
      return 0n;
    },
  } as unknown as PublicClient;
  await assert.rejects(
    readGroupChain(client, saved, policy, address(1)),
    /CHAIN_REORGANIZED/,
  );
});
