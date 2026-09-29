import { formatUnits } from "viem";
import type { EvidenceRun } from "./published-evidence.js";

export type AcceptanceArtifact = {
  runId: string;
  scenario: string;
  status: string;
  groupId: string;
  model: string;
  policyHash: string;
  policy: { paymentAmount: string };
  changedConditions: {
    aliceBudgetCents: number;
    permittedRestaurantIds: readonly string[];
  };
  evaluation: { winnerId: string | null };
  rejection: { reason: string };
  receipts: {
    label: string;
    hash: string;
    status: string;
    blockNumber: string;
  }[];
  usage: {
    usage: {
      flow: string;
      attempts: number;
      inputTokens: number | null;
      outputTokens: number | null;
    }[];
  };
  finality: { allReceiptsFinalized: boolean; finalizedBlock: string };
  accessChecks: readonly string[];
  recovery: null | {
    recovered: boolean;
    restartedInDifferentProcess: boolean;
    originalHash: string;
    resumedHash: string;
  };
};

// Publish only the explicitly selected public fields, never input text or journals.
export function acceptanceEvidence(artifact: AcceptanceArtifact): EvidenceRun {
  const finalized =
    artifact.status === "finalized" && artifact.finality.allReceiptsFinalized;
  return {
    id: `${artifact.runId}-${artifact.scenario}`,
    title: `Live group: ${artifact.scenario.replaceAll("-", " ")}`,
    scope: "Ordinary-group live acceptance",
    completeness: finalized
      ? "Finalized live run"
      : "Confirmed; finality pending",
    scenarioCaption:
      "Outcome from live Kiln, authenticated group APIs and Sepolia settlement",
    summary:
      "Six separate wallet sessions submitted and confirmed synthetic preferences, reviewed one policy, contributed, and recovered their unused funds after a bounded agent payment.",
    limitation:
      "One test operator controlled six distinct keys through isolated authenticated HTTP clients. This does not establish six independent humans or a MacBook browser rehearsal. Energy was not measured. Receipts are saved verification records.",
    facts: [
      { label: "Group", value: artifact.groupId },
      { label: "Policy hash", value: artifact.policyHash },
      { label: "Model", value: artifact.model },
      {
        label: "Access and privacy checks",
        value: `${artifact.accessChecks.length} recorded checks across isolated sessions`,
      },
      ...(artifact.recovery?.recovered &&
      artifact.recovery.originalHash === artifact.recovery.resumedHash
        ? [
            {
              label: "Recovery",
              value: artifact.recovery.restartedInDifferentProcess
                ? "Separate process resumed the original payment hash; one payment and six refunds"
                : "Worker resumed the original payment hash; one payment and six refunds",
            },
          ]
        : []),
      {
        label: "Payment",
        value: `${formatUnits(BigInt(artifact.policy.paymentAmount), 6)} USDC`,
      },
      {
        label: "Rejected simulation",
        value: `${artifact.rejection.reason}; eth_call, no invalid transaction broadcast`,
      },
      {
        label: "Finalized height checked",
        value: artifact.finality.finalizedBlock,
      },
    ],
    transactions: artifact.receipts.map((receipt) => ({
      label: receipt.label,
      hash: receipt.hash,
      status: finalized
        ? "Success; finalized receipt verified"
        : "Success receipt recorded",
      block: receipt.blockNumber,
    })),
    usage: artifact.usage.usage.map((usage) => ({
      flow: usage.flow,
      calls: usage.attempts,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })),
    scenarios: [
      {
        id: artifact.scenario,
        condition: `First member budget $${(artifact.changedConditions.aliceBudgetCents / 100).toFixed(2)}; permitted restaurants ${artifact.changedConditions.permittedRestaurantIds.join(", ")}`,
        winner: artifact.evaluation.winnerId,
      },
    ],
  };
}
