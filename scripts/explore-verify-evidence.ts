import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  decodeEventLog,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import walletAbiJson from "../src/lib/abi/convergeGroupWallet.json";
import { ExploreStore, walletId } from "../src/lib/explore/store.js";
import { hashPolicy, policySchema } from "../src/lib/policy.js";

async function main() {
  if (!process.env.RPC_URL) throw new Error("RPC_URL is required");
  const path = process.argv[2];
  if (!path || !/^docs\/evidence\/explore-live-[a-f0-9]{12}\.json$/.test(path))
    throw new Error("Pass the saved Explore evidence path");
  const evidence = JSON.parse(await readFile(path, "utf8")) as {
    chainId: number;
    runId: string;
    judge: Address;
    policy: unknown;
    policyHash: Hex;
    automatedParticipants: Address[];
    transactions: {
      label: string;
      hash: Hex;
      confirmed: boolean;
      failed?: boolean;
    }[];
    [key: string]: unknown;
  };
  assert.equal(evidence.chainId, sepolia.id);
  assert.equal(evidence.runId, walletId(evidence.judge));
  const policy = policySchema.parse(evidence.policy);
  assert.equal(hashPolicy(policy), evidence.policyHash);
  assert.deepEqual(
    policy.participants.slice(1),
    evidence.automatedParticipants,
  );
  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.RPC_URL, { timeout: 20000 }),
  });
  const abi = walletAbiJson as Abi;
  assert.equal(await client.getChainId(), sepolia.id);
  const run = await new ExploreStore().read(evidence.runId);
  assert.ok(run);
  assert.equal(run.phase, "completed");
  assert.equal(run.refunded, true);
  const receipts: {
    label: string;
    hash: Hex;
    blockNumber: string;
    blockHash: Hex;
    status: "success" | "reverted";
    logIndex: number[];
  }[] = [];
  const allTransactions = [
    ...evidence.transactions.filter((tx) => tx.label.startsWith("Judge ")),
    ...run.transactions,
  ];
  const seen = new Set<string>();
  let paymentEvents = 0;
  let paymentHash: Hex | undefined;
  let refundEvents = 0;
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  for (const tx of allTransactions) {
    if (seen.has(tx.hash.toLowerCase())) continue;
    seen.add(tx.hash.toLowerCase());
    assert.equal(tx.confirmed, true, `Unconfirmed transaction: ${tx.label}`);
    const receipt = await client.getTransactionReceipt({ hash: tx.hash });
    assert.equal(
      receipt.status,
      tx.failed ? "reverted" : "success",
      `Unexpected transaction status: ${tx.label}`,
    );
    assert.ok(
      latest >= receipt.blockNumber + 1n,
      `Need a second block for ${tx.label}`,
    );
    assert.equal(
      (await client.getBlock({ blockNumber: receipt.blockNumber })).hash,
      receipt.blockHash,
    );
    const logIndex: number[] = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== policy.verifyingContract.toLowerCase())
        continue;
      let event;
      try {
        event = decodeEventLog({ abi, data: log.data, topics: log.topics });
      } catch {
        continue;
      }
      const args = event.args as {
        decisionId?: Hex;
        merchant?: Address;
        amount?: bigint;
        participant?: Address;
      };
      if (args.decisionId !== policy.decisionId) continue;
      logIndex.push(log.logIndex);
      if (event.eventName === "PaymentExecuted") {
        assert.equal(
          args.merchant?.toLowerCase(),
          policy.merchant.toLowerCase(),
        );
        assert.equal(args.amount, BigInt(policy.paymentAmount));
        paymentEvents++;
        paymentHash = tx.hash;
      }
      if (event.eventName === "RefundClaimed") refundEvents++;
    }
    receipts.push({
      label: tx.label,
      hash: tx.hash,
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash,
      status: receipt.status,
      logIndex,
    });
  }
  assert.equal(paymentEvents, 1);
  if (run.reservation) {
    assert.equal(run.reservation.reference, policy.reservationReference);
    assert.equal(run.reservation.decisionId, policy.decisionId);
    assert.equal(run.reservation.status, "DEMO_CONFIRMED");
    assert.equal(run.reservation.paymentHash, paymentHash);
  }
  assert.equal(refundEvents, 6);
  const decision = (await client.readContract({
    address: policy.verifyingContract,
    abi,
    functionName: "getDecision",
    args: [policy.decisionId],
  })) as [Hex, number, bigint, bigint, bigint, bigint];
  assert.equal(decision[0], evidence.policyHash);
  assert.equal(decision[1], 2);
  assert.equal(decision[2], 6n);
  assert.equal(decision[3], 60_000_000n);
  assert.equal(decision[4], BigInt(policy.paymentAmount));
  assert.equal(decision[5], 60_000_000n - BigInt(policy.paymentAmount));
  for (const participant of policy.participants) {
    assert.equal(
      await client.readContract({
        address: policy.verifyingContract,
        abi,
        functionName: "refundClaimed",
        args: [policy.decisionId, participant],
      }),
      true,
    );
  }
  const updated = {
    ...evidence,
    ...(run.reservation ? { reservation: run.reservation } : {}),
    transactions: allTransactions,
    verification: {
      verifiedAt: new Date().toISOString(),
      chainId: sepolia.id,
      approvalCount: 6,
      totalContributed: String(decision[3]),
      paymentAmount: String(decision[4]),
      totalRefunded: String(decision[5]),
      allSixRefundsClaimed: true,
      paymentEvents,
      refundEvents,
      minimumConfirmations: 2,
      finalized: false,
      receipts,
    },
  };
  await writeFile(path, JSON.stringify(updated, null, 2) + "\n");
  console.log(
    `Verified ${receipts.length} unique Sepolia receipts, one policy payment, six contributions, and six refunds. Evidence updated: ${path}`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Evidence verification failed",
  );
  process.exitCode = 1;
});
