import {
  createWalletClient,
  decodeEventLog,
  TransactionReceiptNotFoundError,
  type Abi,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
  type TransactionReceipt,
} from "viem";
import { sepolia } from "viem/chains";
import abiJson from "../../src/lib/abi/convergeGroupWallet.json";
import { readGroupChain } from "../../src/lib/group-chain.js";
import {
  groupPaymentIntent,
  type GroupChainEvent,
} from "../../src/lib/group-execution.js";
import type { GroupPolicyConfig } from "../../src/lib/group-policy.js";
import type {
  ExecutionPolicy,
  GroupExecutionRepository,
} from "../../src/lib/db/group-execution.js";
import {
  assertMatchingIntent,
  executeJournaled,
} from "./transaction-journal.js";

export type ExecutionStore = Pick<
  GroupExecutionRepository,
  "checkpoint" | "record" | "load" | "save" | "pendingOther" | "status"
>;
const abi = abiJson as Abi;
const kinds = new Set([
  "DecisionCreated",
  "ParticipantApproved",
  "WalletActivated",
  "PaymentExecuted",
  "DecisionCompleted",
  "DecisionCancelled",
  "DecisionExpired",
  "RefundClaimed",
]);
export class GroupExecutionWorker {
  constructor(
    readonly client: PublicClient,
    readonly transport: Transport,
    readonly account: LocalAccount,
    readonly config: GroupPolicyConfig,
    readonly store: ExecutionStore,
    readonly startBlock: bigint,
    readonly gasCap: bigint,
    readonly guard?: () => Promise<void>,
  ) {}

  async reconcile(saved: ExecutionPolicy) {
    const state = await readGroupChain(
      this.client,
      saved,
      this.config,
      saved.policy.participants[0]!,
    );
    const target = BigInt(state.blockNumber);
    const targetHash = (await this.client.getBlock({ blockNumber: target }))
      .hash;
    const checkpoint = await this.store.checkpoint(saved.policy.decisionId);
    let from = this.startBlock;
    if (
      checkpoint &&
      BigInt(checkpoint.blockNumber) <= target &&
      (
        await this.client.getBlock({
          blockNumber: BigInt(checkpoint.blockNumber),
        })
      ).hash === checkpoint.blockHash
    )
      from = BigInt(checkpoint.blockNumber) + 1n;
    const events: GroupChainEvent[] = [];
    const receipts = new Map<Hex, TransactionReceipt>();
    for (let cursor = from; cursor <= target; cursor += 2000n) {
      const toBlock = cursor + 1999n < target ? cursor + 1999n : target;
      const logs = await this.client.getContractEvents({
        address: saved.policy.verifyingContract,
        abi,
        fromBlock: cursor,
        toBlock,
      });
      for (const log of logs) {
        const event = log as unknown as {
          eventName: string;
          args: {
            decisionId?: string;
            participant?: string;
            merchant?: string;
            executor?: string;
            amount?: bigint;
            contribution?: bigint;
          };
          transactionHash: Hex;
          blockNumber: bigint;
          blockHash: Hex;
          logIndex: number;
        };
        if (
          event.args.decisionId !== saved.policy.decisionId ||
          !kinds.has(event.eventName)
        )
          continue;
        let receipt = receipts.get(event.transactionHash);
        if (!receipt) {
          receipt = await this.client.getTransactionReceipt({
            hash: event.transactionHash,
          });
          if (
            receipt.status !== "success" ||
            receipt.blockHash !== event.blockHash ||
            receipt.blockNumber !== event.blockNumber
          )
            throw new Error("EVENT_RECEIPT_MISMATCH");
          receipts.set(event.transactionHash, receipt);
        }
        if (
          !receipt.logs.some(
            (item) =>
              item.logIndex === event.logIndex &&
              item.address.toLowerCase() ===
                saved.policy.verifyingContract.toLowerCase() &&
              item.blockHash === event.blockHash &&
              item.data === log.data &&
              JSON.stringify(item.topics) === JSON.stringify(log.topics),
          )
        )
          throw new Error("EVENT_RECEIPT_MISMATCH");
        if (
          event.eventName === "DecisionCreated" &&
          (event.args as { policyHash?: string }).policyHash?.toLowerCase() !==
            saved.policyHash.toLowerCase()
        )
          throw new Error("CREATION_EVENT_MISMATCH");
        if (
          event.args.participant &&
          !saved.policy.participants.some(
            (member) =>
              member.toLowerCase() === event.args.participant!.toLowerCase(),
          )
        )
          throw new Error("PARTICIPANT_EVENT_MISMATCH");
        if (
          event.eventName === "PaymentExecuted" &&
          (event.args.merchant?.toLowerCase() !==
            saved.policy.merchant.toLowerCase() ||
            event.args.executor?.toLowerCase() !==
              saved.policy.executor.toLowerCase() ||
            event.args.amount !== BigInt(saved.policy.paymentAmount))
        )
          throw new Error("PAYMENT_EVENT_MISMATCH");
        const amount = event.args.amount ?? event.args.contribution;
        events.push({
          kind: event.eventName,
          hash: event.transactionHash,
          blockNumber: String(event.blockNumber),
          blockHash: event.blockHash,
          logIndex: event.logIndex,
          ...(event.args.participant
            ? { participant: event.args.participant }
            : {}),
          ...(event.args.merchant ? { merchant: event.args.merchant } : {}),
          ...(amount === undefined ? {} : { amount: String(amount) }),
        });
      }
    }
    if (
      (await this.client.getBlock({ blockNumber: target })).hash !== targetHash
    )
      throw new Error("CHAIN_REORGANIZED");
    await this.store.record(
      saved.policy.decisionId,
      state,
      targetHash,
      from,
      events,
    );
    return state;
  }

  async tick(saved: ExecutionPolicy, execute = true) {
    const state = await this.reconcile(saved);
    const id = saved.policy.decisionId;
    const existing = await this.store.load(id);
    if (!execute) return;
    if (
      !existing &&
      (!state.registered ||
        state.status !== 1 ||
        state.timestamp >= saved.policy.expiry)
    )
      return;
    const wallet = createWalletClient({
      account: this.account,
      chain: sepolia,
      transport: this.transport,
    });
    // A previously signed intent is immutable, even when the decision became terminal meanwhile.
    const intent = existing
      ? {
          chainId: saved.policy.chainId,
          from: saved.policy.executor,
          to: saved.policy.verifyingContract,
          data: groupPaymentData(saved),
          valueWei: "0",
        }
      : groupPaymentIntent(saved, this.config, state, this.account.address);
    if (
      this.account.address.toLowerCase() !== saved.policy.executor.toLowerCase()
    )
      throw new Error("WRONG_EXECUTOR");
    if (existing) assertMatchingIntent(existing.intent, intent);
    let reserved = 0n;
    const findReceipt = async (
      hash: Hex,
    ): Promise<TransactionReceipt | undefined> => {
      let receipt;
      try {
        receipt = await this.client.getTransactionReceipt({ hash });
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return undefined;
        throw error;
      }
      if (receipt.transactionHash !== hash)
        throw new Error("TRANSACTION_RECEIPT_MISMATCH");
      if (
        (await this.client.getBlockNumber({ cacheTime: 0 })) <
          receipt.blockNumber + 1n ||
        (await this.client.getBlock({ blockNumber: receipt.blockNumber }))
          .hash !== receipt.blockHash
      )
        return undefined;
      return receipt;
    };
    if (existing) {
      const mined = await findReceipt(existing.hash);
      if (mined) {
        if (mined.status === "reverted") {
          await this.store.status(id, "reverted", "TRANSACTION_REVERTED");
          return;
        }
        await this.confirmPayment(saved, mined);
        return;
      }
      // A different payment or cancellation may have landed while this hash was pending.
      if (state.status !== 1 || state.timestamp >= saved.policy.expiry) {
        await this.store.status(
          id,
          "pending",
          "EXECUTION_AWAITING_RECONCILIATION",
        );
        return;
      }
    }
    try {
      const result = await executeJournaled<TransactionReceipt | null>({
        intent,
        load: () => this.store.load(id),
        prepare: async () => {
          await this.guard?.();
          if (await this.store.pendingOther(id))
            throw new Error("WAITING_FOR_OTHER_TRANSACTION");
          const latest = await readGroupChain(
            this.client,
            saved,
            this.config,
            saved.policy.participants[0]!,
            1,
          );
          assertMatchingIntent(
            groupPaymentIntent(
              saved,
              this.config,
              latest,
              this.account.address,
            ),
            intent,
          );
          await this.client.call({
            account: this.account.address,
            to: saved.policy.verifyingContract,
            data: intent.data,
          });
          const request = await wallet.prepareTransactionRequest({
            account: this.account,
            to: saved.policy.verifyingContract,
            data: intent.data,
            value: 0n,
          });
          if (request.gas === undefined)
            throw new Error("GAS_ESTIMATE_UNAVAILABLE");
          request.gas += request.gas / 4n;
          const fee = request.maxFeePerGas ?? request.gasPrice;
          if (fee === undefined) throw new Error("GAS_ESTIMATE_UNAVAILABLE");
          reserved = request.gas * fee;
          return wallet.signTransaction(request);
        },
        save: (entry) => this.store.save(id, entry, reserved, this.gasCap),
        findReceipt,
        broadcast: async (serialized) => {
          await this.guard?.();
          return this.client.sendRawTransaction({
            serializedTransaction: serialized,
          });
        },
        waitReceipt: async () => null,
      });
      if (result.receipt) {
        if (result.receipt.status === "reverted")
          await this.store.status(id, "reverted", "TRANSACTION_REVERTED");
        else await this.confirmPayment(saved, result.receipt);
      }
    } catch (error) {
      if (await this.store.load(id))
        await this.store.status(
          id,
          "pending",
          "EXECUTION_AWAITING_RECONCILIATION",
        );
      throw error;
    }
  }

  private async confirmPayment(
    saved: ExecutionPolicy,
    receipt: TransactionReceipt,
  ) {
    const id = saved.policy.decisionId;
    assertPaymentReceipt(saved, receipt);
    const state = await this.reconcile(saved);
    if (
      BigInt(state.blockNumber) < receipt.blockNumber ||
      state.status !== 2 ||
      state.spent !== saved.policy.paymentAmount
    )
      throw new Error("PAYMENT_AWAITING_CANONICAL_STATE");
    await this.store.status(id, "confirmed");
  }
}

export function assertPaymentReceipt(
  saved: ExecutionPolicy,
  receipt: TransactionReceipt,
) {
  const id = saved.policy.decisionId;
  if (
    receipt.status !== "success" ||
    receipt.to?.toLowerCase() !==
      saved.policy.verifyingContract.toLowerCase() ||
    receipt.from.toLowerCase() !== saved.policy.executor.toLowerCase()
  )
    throw new Error("PAYMENT_RECEIPT_MISMATCH");
  const payments = receipt.logs
    .filter(
      (log) =>
        log.address.toLowerCase() ===
        saved.policy.verifyingContract.toLowerCase(),
    )
    .flatMap((log) => {
      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        });
        return decoded.eventName === "PaymentExecuted"
          ? [
              decoded.args as unknown as {
                decisionId: Hex;
                executor: string;
                merchant: string;
                amount: bigint;
              },
            ]
          : [];
      } catch {
        return [];
      }
    });
  if (
    payments.length !== 1 ||
    payments[0]!.decisionId !== id ||
    payments[0]!.executor.toLowerCase() !==
      saved.policy.executor.toLowerCase() ||
    payments[0]!.merchant.toLowerCase() !==
      saved.policy.merchant.toLowerCase() ||
    payments[0]!.amount !== BigInt(saved.policy.paymentAmount)
  )
    throw new Error("PAYMENT_RECEIPT_MISMATCH");
}

import { encodeFunctionData } from "viem";
function groupPaymentData(saved: ExecutionPolicy) {
  return encodeFunctionData({
    abi,
    functionName: "executePayment",
    args: [
      saved.policy.decisionId,
      saved.policy.merchant,
      BigInt(saved.policy.paymentAmount),
    ],
  });
}
