import baseline from "../../docs/evidence/baseline-001.json";
import fixtures from "../../docs/evidence/decision-engine-fixtures.json";
import kiln from "../../docs/evidence/kiln-smoke.json";
import { formatUnits } from "viem";

const flows = [
  "constraint_extraction",
  "decision_explanation",
  "candidate_analysis",
  "clarification",
] as const;
export type EvidenceRun = {
  id: string;
  title: string;
  scope: string;
  summary: string;
  limitation: string;
  facts: { label: string; value: string }[];
  transactions: {
    label: string;
    hash: string;
    status: string;
    block: string;
  }[];
  usage: {
    flow: string;
    calls: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
  }[];
  scenarios: { id: string; condition: string; winner: string | null }[];
};

const unknownUsage = () =>
  flows.map((flow) => ({
    flow,
    calls: null,
    inputTokens: null,
    outputTokens: null,
  }));

// Explicitly published, synthetic artifacts only. Never enumerate private evidence or .demo.
// Deliberately omit calldata, original preferences, extractions and private journal fields.
export const publishedEvidence: EvidenceRun[] = [
  {
    id: baseline.runId,
    title: "Sepolia baseline",
    scope: "Blockchain-only rehearsal",
    summary:
      "A single operator exercised policy creation, contributions, payment and refunds with test wallets.",
    limitation:
      "This is not a six-person application run. Live AI usage is not part of this record. Receipts below are saved evidence, not a fresh finality check.",
    facts: [
      {
        label: "Network",
        value: `Ethereum Sepolia (${baseline.policy.chainId})`,
      },
      {
        label: "Recorded payment",
        value: `${formatUnits(BigInt(baseline.policy.paymentAmount), 6)} MockUSDC`,
      },
      {
        label: "Rejected request",
        value: `${formatUnits(BigInt(baseline.rejection.amount), 6)} MockUSDC · ${baseline.rejection.reason}`,
      },
      {
        label: "Rejection evidence",
        value:
          "Read-only eth_call simulation. No rejection transaction submitted.",
      },
    ],
    transactions: Object.entries(baseline.transactions).map(
      ([label, transaction]) => ({
        label: label.replaceAll("-", " "),
        hash: transaction.hash,
        status:
          transaction.receipt.status === "success"
            ? "Success receipt recorded"
            : "Reverted receipt recorded",
        block: transaction.receipt.blockNumber,
      }),
    ),
    usage: unknownUsage(),
    scenarios: [],
  },
  {
    id: "kiln-smoke",
    title: "Live AI extraction",
    scope: "AI smoke test",
    summary:
      "Recorded provider usage from live extraction requests using synthetic inputs.",
    limitation:
      "These calls are separate from the blockchain baseline. No participant confirmation, group policy or payment is proven by this test. Energy usage is unavailable.",
    facts: [
      { label: "Model", value: kiln.model },
      { label: "Recorded at", value: kiln.checkedAt },
    ],
    transactions: [],
    scenarios: [],
    usage: flows.map((flow) => {
      const attempts = kiln.attempts.filter(
        (attempt) => attempt.usage.flow === flow,
      );
      return {
        flow,
        calls: attempts.length || null,
        inputTokens: attempts.length
          ? attempts.reduce(
              (sum, attempt) => sum + attempt.usage.inputTokens,
              0,
            )
          : null,
        outputTokens: attempts.length
          ? attempts.reduce(
              (sum, attempt) => sum + attempt.usage.outputTokens,
              0,
            )
          : null,
      };
    }),
  },
  {
    id: "decision-fixtures",
    title: "Condition changes",
    scope: "Deterministic fixture test",
    summary:
      "Compare the baseline, a lower budget, and an excluded merchant using the recorded decision-engine fixtures.",
    limitation:
      "Synthetic confirmations only. These scenarios contain no live AI calls or on-chain transactions and do not complete end-to-end acceptance.",
    facts: [
      { label: "Restaurant data", value: "Synthetic catalog" },
      { label: "Confirmations", value: "Synthetic" },
    ],
    transactions: [],
    usage: unknownUsage(),
    scenarios: fixtures.results.map(({ scenario, result }) => ({
      id: scenario.id,
      condition: scenario.excludeA
        ? "Merchant A excluded"
        : `Meal budget $${(scenario.budget / 100).toFixed(2)} / person`,
      winner: result.winnerId,
    })),
  },
];
