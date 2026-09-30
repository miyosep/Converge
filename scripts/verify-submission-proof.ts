import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPublicClient, decodeEventLog, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import {
  hashPolicy,
  policySchema,
  policyWalletAbi,
} from "../src/lib/signing-policy.js";

// Read-only verification: no database, signing keys, model calls or transactions.
async function main() {
  if (!process.env.RPC_URL) throw new Error("RPC_URL_REQUIRED");
  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.RPC_URL, { timeout: 15000, retryCount: 1 }),
  });
  assert.equal(await client.getChainId(), sepolia.id);
  const finalized = await client.getBlock({ blockTag: "finalized" });
  const flows = [];
  for (const scenario of ["baseline", "lower-budget", "merchant-excluded"]) {
    const source = `docs/evidence/group-acceptance-001-${scenario}.json`;
    const evidence = JSON.parse(await readFile(source, "utf8"));
    const policy = policySchema.parse(evidence.policy);
    assert.equal(hashPolicy(policy), evidence.policyHash);
    const recorded = evidence.receipts.find(
      (r: { events: { name: string }[] }) =>
        r.events.some((e) => e.name === "PaymentExecuted"),
    );
    assert.ok(recorded);
    const receipt = await client.getTransactionReceipt({
      hash: recorded.hash as Hex,
    });
    assert.equal(receipt.status, "success");
    assert.equal(
      receipt.to?.toLowerCase(),
      policy.verifyingContract.toLowerCase(),
    );
    assert.equal(receipt.blockHash, recorded.blockHash);
    assert.equal(
      (await client.getBlock({ blockNumber: receipt.blockNumber })).hash,
      receipt.blockHash,
    );
    const events = receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === policy.verifyingContract.toLowerCase(),
      )
      .map((log) =>
        decodeEventLog({
          abi: policyWalletAbi(policy),
          data: log.data,
          topics: log.topics,
        }),
      );
    const paid = events.filter(
      (event) => event.eventName === "PaymentExecuted",
    );
    assert.equal(paid.length, 1);
    const logged = recorded.events.find(
      (event: { name: string }) => event.name === "PaymentExecuted",
    );
    const args = JSON.parse(
      JSON.stringify(paid[0]!.args, (_, value) =>
        typeof value === "bigint" ? String(value) : value,
      ),
    );
    assert.deepEqual(args, logged.args);
    assert.equal(args.decisionId, policy.decisionId);
    assert.equal(args.merchant.toLowerCase(), policy.merchant.toLowerCase());
    assert.equal(args.executor.toLowerCase(), policy.executor.toLowerCase());
    assert.equal(args.amount, policy.paymentAmount);
    const kilnCalls = [
      ...evidence.extractionAttempts,
      ...evidence.explanationAttempts,
    ].map((attempt) => ({
      flow: attempt.usage.flow,
      requestId: attempt.usage.requestId,
      providerRequestId: attempt.usage.providerRequestId ?? null,
      status: attempt.usage.status,
      httpStatus: attempt.http_status,
      model: attempt.usage.model,
      inputTokens: attempt.usage.inputTokens,
      outputTokens: attempt.usage.outputTokens,
    }));
    assert.ok(
      kilnCalls.some(
        (call) =>
          call.flow === "constraint_extraction" && call.httpStatus === 200,
      ),
    );
    assert.ok(
      kilnCalls.some(
        (call) =>
          call.flow === "decision_explanation" && call.httpStatus === 200,
      ),
    );
    flows.push({
      scenario,
      source,
      paymentHash: receipt.transactionHash,
      blockNumber: String(receipt.blockNumber),
      canonical: true,
      finalized: receipt.blockNumber <= finalized.number!,
      paymentEvent: args,
      kilnCalls,
    });
  }
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        chainId: sepolia.id,
        scope:
          "Read-only recheck of three historical payment receipts and saved Kiln call metadata; not a rerun of current application flows or new Kiln calls.",
        flows,
      },
      null,
      2,
    ),
  );
}
main().catch(() => {
  // Provider errors can embed authenticated URLs. Never publish raw failures.
  console.error(
    "Submission proof verification failed. Check RPC access and the recorded artifacts; no transaction was submitted.",
  );
  process.exitCode = 1;
});
