import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import abiJson from "../src/lib/abi/convergeGroupWallet.json";
import {
  assertPaymentReceipt,
  GroupExecutionWorker,
  type ExecutionStore,
} from "../scripts/lib/group-execution-worker.js";
import type { ExecutionPolicy } from "../src/lib/db/group-execution.js";

const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const decisionId = `0x${"a".repeat(64)}` as const;
const policy = {
  groupId: "group",
  policyHash: `0x${"b".repeat(64)}`,
  createdAt: new Date().toISOString(),
  policy: {
    decisionId,
    verifyingContract: address(1),
    executor: address(2),
    merchant: address(3),
    paymentAmount: "45000000",
  },
} as ExecutionPolicy;
const topics = encodeEventTopics({
  abi: abiJson as Abi,
  eventName: "PaymentExecuted",
  args: {
    decisionId,
    executor: policy.policy.executor,
    merchant: policy.policy.merchant,
  },
});
const receipt = {
  status: "success",
  to: policy.policy.verifyingContract,
  from: policy.policy.executor,
  logs: [
    {
      address: policy.policy.verifyingContract,
      topics,
      data: encodeAbiParameters([{ type: "uint256" }], [45000000n]),
    },
  ],
} as TransactionReceipt;

test("payment reconciliation accepts only a successful matching receipt and event", () => {
  assert.doesNotThrow(() => assertPaymentReceipt(policy, receipt));
  assert.throws(
    () => assertPaymentReceipt(policy, { ...receipt, status: "reverted" }),
    /PAYMENT_RECEIPT_MISMATCH/,
  );
  assert.throws(
    () => assertPaymentReceipt(policy, { ...receipt, from: address(9) }),
    /PAYMENT_RECEIPT_MISMATCH/,
  );
  assert.throws(
    () => assertPaymentReceipt(policy, { ...receipt, logs: [] }),
    /PAYMENT_RECEIPT_MISMATCH/,
  );
  assert.throws(
    () =>
      assertPaymentReceipt(
        { ...policy, policy: { ...policy.policy, paymentAmount: "44000000" } },
        receipt,
      ),
    /PAYMENT_RECEIPT_MISMATCH/,
  );
  assert.throws(
    () =>
      assertPaymentReceipt(
        { ...policy, policy: { ...policy.policy, merchant: address(9) } },
        receipt,
      ),
    /PAYMENT_RECEIPT_MISMATCH/,
  );
});

test("restart recovers the saved payment without rebroadcasting", async () => {
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const saved = {
    ...policy,
    policy: {
      ...policy.policy,
      chainId: 11155111,
      executor: account.address,
      participants: [address(4)],
      expiry: 2000000000,
    },
  } as ExecutionPolicy;
  const mined = {
    ...receipt,
    from: account.address,
    transactionHash: `0x${"d".repeat(64)}`,
    blockNumber: 10n,
    blockHash: `0x${"c".repeat(64)}`,
    logs: [
      {
        ...receipt.logs[0]!,
        topics: encodeEventTopics({
          abi: abiJson as Abi,
          eventName: "PaymentExecuted",
          args: {
            decisionId,
            executor: account.address,
            merchant: saved.policy.merchant,
          },
        }),
      },
    ],
  } as TransactionReceipt;
  const statuses: string[] = [];
  const intent = {
    chainId: 11155111,
    from: account.address,
    to: saved.policy.verifyingContract,
    valueWei: "0",
    data: encodeFunctionData({
      abi: abiJson as Abi,
      functionName: "executePayment",
      args: [decisionId, saved.policy.merchant, 45000000n],
    }),
  };
  const store = {
    load: async () => ({ intent, hash: `0x${"d".repeat(64)}` }),
    status: async (_id: string, status: string) => {
      statuses.push(status);
    },
  } as unknown as ExecutionStore;
  let broadcasts = 0;
  const client = {
    getTransactionReceipt: async () => mined,
    getBlockNumber: async () => 12n,
    getBlock: async () => ({ hash: mined.blockHash }),
    sendRawTransaction: async () => {
      broadcasts++;
      throw new Error("unexpected broadcast");
    },
  } as unknown as PublicClient;
  const worker = new GroupExecutionWorker(
    client,
    http("http://127.0.0.1:1"),
    account,
    saved.policy,
    store,
    0n,
    1n,
  );
  worker.reconcile = async () =>
    ({
      blockNumber: "11",
      status: 2,
      spent: "45000000",
      registered: true,
      timestamp: 1900000000,
    }) as never;
  await worker.tick(saved);
  assert.deepEqual(statuses, ["confirmed"]);
  assert.equal(broadcasts, 0);
});
