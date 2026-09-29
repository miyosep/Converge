import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  keccak256,
  type Abi,
  type Hex,
  type Address,
} from "viem";
import { sepolia } from "viem/chains";
import deploymentV2 from "../contracts/deployments/11155111-v2.json";
import tokenJson from "../src/lib/abi/mockUSDC.json";
import deployment from "../contracts/deployments/11155111.json";
import {
  hashPolicy,
  policySchema,
  toContractPolicy,
  policyWalletAbi,
} from "../src/lib/signing-policy.js";
import { atomicJson } from "../src/lib/explore/store.js";

const runId = process.argv[2] || "group-acceptance-001";
const waitFinality = process.argv.includes("--wait-finality");
if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(runId)) throw new Error("Invalid run ID");
type Artifact = {
  runId: string;
  scenario: string;
  status: string;
  groupId: string;
  policy: unknown;
  policyHash: Hex;
  evaluation: { id: string; winnerId: string };
  model: string;
  inputs: {
    groupId: string;
    participant: Address;
    revisionId: string;
    status: string;
  }[];
  receipts: {
    label: string;
    hash: Hex;
    status: string;
    blockNumber: string;
    blockHash: Hex;
  }[];
  rejection: {
    merchant: Address;
    amount: string;
    blockNumber: string;
    blockHash: Hex;
    reasonCode: number;
    transactionSubmitted: boolean;
  };
  extractionAttempts: {
    revision_id: string;
    usage: { runId: string; model: string; flow: string; status: string };
  }[];
  explanationAttempts: {
    evaluation_id: string;
    usage: { runId: string; model: string; flow: string; status: string };
  }[];
  history: {
    events: { kind: string; hash: Hex; logIndex: number }[];
    execution: { hash: Hex; status: string };
  };
  accessChecks: string[];
  recovery: null | {
    originalHash: Hex;
    resumedHash: Hex;
    paymentEventCount: number;
    refundEventCount: number;
    duplicateEventsAfterReplay: number;
    recovered: boolean;
    interruptedProcessId: number;
    resumedProcessId: number;
    restartedInDifferentProcess: boolean;
  };
  finality: {
    requiredThroughBlock: string;
    finalizedBlock: string;
    finalizedBlockHash: Hex;
    allReceiptsFinalized: boolean;
  };
  checkedAt: string;
};

async function main() {
  if (!process.env.RPC_URL)
    throw new Error(
      "RPC_URL is required; no signer or database credentials are used",
    );
  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.RPC_URL, { timeout: 20000, retryCount: 2 }),
  });
  assert.equal(await client.getChainId(), 11155111);
  assert.equal(
    (await client.getBlock({ blockNumber: 0n })).hash,
    "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9",
  );
  for (const contract of [deployment.mockUSDC, deployment.convergeGroupWallet])
    assert.equal(
      keccak256(
        (await client.getBytecode({ address: contract.address as Address }))!,
      ),
      contract.deployedCodeHash,
    );
  const ids = new Set<string>();
  for (const scenario of ["baseline", "lower-budget", "merchant-excluded"]) {
    const path = `docs/evidence/${runId}-${scenario}.json`;
    const evidence = JSON.parse(await readFile(path, "utf8")) as Artifact;
    assert.equal(evidence.runId, runId);
    assert.equal(evidence.scenario, scenario);
    assert.equal(evidence.model, "qwen3-32b");
    const policy = policySchema.parse(evidence.policy);
    const abi = policyWalletAbi(policy);
    const walletDeployment =
      policy.policyVersion === 1
        ? deployment.convergeGroupWallet
        : deploymentV2.convergeGroupWallet;
    assert.equal(
      keccak256(
        (await client.getBytecode({
          address: walletDeployment.address as Address,
        }))!,
      ),
      walletDeployment.deployedCodeHash,
    );
    assert.equal(
      policy.verifyingContract.toLowerCase(),
      walletDeployment.address.toLowerCase(),
    );
    assert.equal(
      policy.token.toLowerCase(),
      deployment.mockUSDC.address.toLowerCase(),
    );
    assert.equal(hashPolicy(policy), evidence.policyHash);
    assert.equal(ids.has(policy.decisionId), false);
    ids.add(policy.decisionId);
    assert.equal(evidence.inputs.length, 6);
    assert.equal(
      new Set(evidence.inputs.map((input) => input.participant.toLowerCase()))
        .size,
      6,
    );
    for (const input of evidence.inputs) {
      assert.equal(input.groupId, evidence.groupId);
      assert.equal(input.status, "CONFIRMED");
      assert.ok(
        policy.participants.some(
          (address) =>
            address.toLowerCase() === input.participant.toLowerCase(),
        ),
      );
      assert.ok(
        evidence.extractionAttempts.some(
          (attempt) =>
            attempt.revision_id === input.revisionId &&
            attempt.usage.runId === input.revisionId &&
            attempt.usage.model === "qwen3-32b" &&
            attempt.usage.flow === "constraint_extraction" &&
            attempt.usage.status === "success",
        ),
      );
    }
    assert.ok(
      evidence.explanationAttempts.some(
        (attempt) =>
          attempt.evaluation_id === evidence.evaluation.id &&
          attempt.usage.runId === evidence.evaluation.id &&
          attempt.usage.model === "qwen3-32b" &&
          attempt.usage.flow === "decision_explanation" &&
          attempt.usage.status === "success",
      ),
    );
    const expectedPayment = scenario === "baseline" ? 45000000n : 36000000n;
    const expectedRefund = (60000000n - expectedPayment) / 6n;
    assert.equal(BigInt(policy.paymentAmount), expectedPayment);
    assert.equal(
      evidence.evaluation.winnerId,
      scenario === "baseline" ? "A" : "B",
    );
    const eventIds = new Set<string>();
    const contributions = new Map<string, bigint>(),
      refunds = new Map<string, bigint>();
    let payments = 0,
      creations = 0,
      maximum = 0n;
    assert.equal(
      new Set(evidence.receipts.map((receipt) => receipt.hash)).size,
      evidence.receipts.length,
    );
    for (const entry of evidence.receipts) {
      const receipt = await client.getTransactionReceipt({ hash: entry.hash });
      assert.equal(receipt.status, "success");
      assert.equal(entry.status, "success");
      assert.equal(String(receipt.blockNumber), entry.blockNumber);
      assert.equal(receipt.blockHash, entry.blockHash);
      assert.equal(
        (await client.getBlock({ blockNumber: receipt.blockNumber })).hash,
        receipt.blockHash,
      );
      maximum = receipt.blockNumber > maximum ? receipt.blockNumber : maximum;
      const tx = await client.getTransaction({ hash: entry.hash });
      assert.equal(tx.chainId, 11155111);
      assert.equal(tx.value, 0n);
      if (entry.label.endsWith("-payment")) {
        assert.equal(tx.from.toLowerCase(), policy.executor.toLowerCase());
        assert.equal(
          tx.to?.toLowerCase(),
          policy.verifyingContract.toLowerCase(),
        );
        assert.equal(
          tx.input,
          encodeFunctionData({
            abi,
            functionName: "executePayment",
            args: [policy.decisionId, policy.merchant, expectedPayment],
          }),
        );
        assert.equal(evidence.history.execution.hash, entry.hash);
      } else {
        const match = entry.label.match(
          /-(register|allowance|contribute|refund)-(\d)$/,
        );
        assert.ok(match);
        const address = evidence.inputs[Number(match[2])]!.participant;
        assert.equal(tx.from.toLowerCase(), address.toLowerCase());
        const kind = match[1];
        const functionName =
          kind === "register"
            ? "createDecision"
            : kind === "allowance"
              ? "approve"
              : kind === "contribute"
                ? "approveAndContribute"
                : "claimRefund";
        const args =
          kind === "register"
            ? [toContractPolicy(policy)]
            : kind === "allowance"
              ? [policy.verifyingContract, 10000000n]
              : kind === "contribute"
                ? [policy.decisionId, evidence.policyHash]
                : [policy.decisionId];
        assert.equal(
          tx.to?.toLowerCase(),
          (kind === "allowance"
            ? policy.token
            : policy.verifyingContract
          ).toLowerCase(),
        );
        assert.equal(
          tx.input,
          encodeFunctionData({
            abi: kind === "allowance" ? (tokenJson as Abi) : abi,
            functionName,
            args,
          }),
        );
      }
      for (const log of receipt.logs)
        if (
          log.address.toLowerCase() === policy.verifyingContract.toLowerCase()
        ) {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          });
          const args = decoded.args as unknown as {
            decisionId: Hex;
            policyHash?: Hex;
            participant?: Address;
            merchant?: Address;
            amount?: bigint;
            contribution?: bigint;
          };
          assert.equal(args.decisionId, policy.decisionId);
          eventIds.add(`${entry.hash}:${log.logIndex}:${decoded.eventName}`);
          if (decoded.eventName === "DecisionCreated") {
            creations++;
            assert.equal(args.policyHash, evidence.policyHash);
          }
          if (decoded.eventName === "PaymentExecuted") {
            payments++;
            assert.equal(args.amount, expectedPayment);
            assert.equal(
              args.merchant?.toLowerCase(),
              policy.merchant.toLowerCase(),
            );
          }
          if (decoded.eventName === "ParticipantApproved") {
            assert.equal(
              contributions.has(args.participant!.toLowerCase()),
              false,
            );
            contributions.set(
              args.participant!.toLowerCase(),
              args.contribution!,
            );
          }
          if (decoded.eventName === "RefundClaimed") {
            assert.equal(refunds.has(args.participant!.toLowerCase()), false);
            refunds.set(args.participant!.toLowerCase(), args.amount!);
          }
        }
    }
    assert.equal(creations, 1);
    assert.equal(payments, 1);
    assert.equal(contributions.size, 6);
    assert.equal(refunds.size, 6);
    for (const address of policy.participants) {
      assert.equal(contributions.get(address.toLowerCase()), 10000000n);
      assert.equal(refunds.get(address.toLowerCase()), expectedRefund);
    }
    assert.equal(evidence.history.execution.status, "confirmed");
    assert.equal(new Set(evidence.accessChecks).size, 12);
    if (scenario !== "merchant-excluded") {
      const recovery = evidence.recovery;
      assert.ok(recovery?.recovered);
      assert.equal(recovery.originalHash, evidence.history.execution.hash);
      assert.equal(recovery.resumedHash, recovery.originalHash);
      assert.equal(recovery.paymentEventCount, 1);
      assert.equal(recovery.refundEventCount, 6);
      assert.equal(recovery.duplicateEventsAfterReplay, 0);
      if (recovery.restartedInDifferentProcess)
        assert.notEqual(
          recovery.interruptedProcessId,
          recovery.resumedProcessId,
        );
    }
    assert.equal(evidence.history.events.length, eventIds.size);
    for (const event of evidence.history.events)
      assert.ok(eventIds.has(`${event.hash}:${event.logIndex}:${event.kind}`));
    const rejection = evidence.rejection;
    assert.equal(rejection.transactionSubmitted, false);
    assert.equal(
      rejection.reasonCode,
      scenario === "merchant-excluded" ? 6 : 8,
    );
    assert.equal(
      (await client.getBlock({ blockNumber: BigInt(rejection.blockNumber) }))
        .hash,
      rejection.blockHash,
    );
    assert.deepEqual(
      await client.readContract({
        address: policy.verifyingContract,
        abi,
        functionName: "validatePayment",
        args: [
          policy.decisionId,
          policy.executor,
          rejection.merchant,
          BigInt(rejection.amount),
        ],
        blockNumber: BigInt(rejection.blockNumber),
      }),
      [false, rejection.reasonCode],
    );
    const finalState = (await client.readContract({
      address: policy.verifyingContract,
      abi,
      functionName: "getDecision",
      args: [policy.decisionId],
      blockNumber: maximum,
    })) as [Hex, number, bigint, bigint, bigint, bigint];
    assert.deepEqual(finalState, [
      evidence.policyHash,
      2,
      6n,
      60000000n,
      expectedPayment,
      expectedRefund * 6n,
    ]);
    let finalized = await client.getBlock({ blockTag: "finalized" });
    const finalityDeadline = Date.now() + 20 * 60 * 1000;
    while (waitFinality && finalized.number < maximum) {
      console.log(
        `${scenario}: verified receipts; awaiting finalized block ${maximum} (currently ${finalized.number})`,
      );
      if (Date.now() >= finalityDeadline)
        throw new assert.AssertionError({
          message: "Finality wait timed out; rerun verification later",
        });
      await sleep(30000);
      finalized = await client.getBlock({ blockTag: "finalized" });
    }
    assert.ok(
      finalized.number >= maximum,
      `Finality pending for ${scenario}: ${finalized.number} < ${maximum}`,
    );
    // Finality may take minutes: check canonical hashes again after the wait.
    const recordedBlocks = new Map(
      [...evidence.receipts, evidence.rejection].map((entry) => [
        entry.blockNumber,
        entry.blockHash,
      ]),
    );
    for (const [number, hash] of recordedBlocks)
      assert.equal(
        (await client.getBlock({ blockNumber: BigInt(number) })).hash,
        hash,
      );
    evidence.status = "finalized";
    evidence.checkedAt = new Date().toISOString();
    evidence.finality = {
      requiredThroughBlock: String(maximum),
      finalizedBlock: String(finalized.number),
      finalizedBlockHash: finalized.hash,
      allReceiptsFinalized: true,
    };
    await atomicJson(path, evidence);
    console.log(
      `${scenario}: ${evidence.receipts.length} finalized receipts, matching calldata, 6 contributions, 1 payment, 6 refunds, historical rejection and correlated Kiln records verified`,
    );
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message.slice(0, 250)
      : "Evidence verification failed; no secrets printed.",
  );
  process.exitCode = 1;
});
