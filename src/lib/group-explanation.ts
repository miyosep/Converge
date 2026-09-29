import { formatUnits } from "viem";
import { z } from "zod";
import { scorePercent, type SavedEvaluation } from "./group-view.js";
import type { KilnClient } from "./kiln/client.js";

export const EXPLANATION_PROMPT_VERSION = "public-explanation-v5";
const reasonSchema = z.enum(["ranking", "price", "deposit", "comparison"]);
export type ExplanationReason = z.infer<typeof reasonSchema>;
export const explanationSelectionSchema = z.strictObject({
  reasonIds: z
    .array(reasonSchema)
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length),
});
// Stored selections from earlier prompt versions remain readable.
const rankedSelectionSchema = explanationSelectionSchema.refine(
  ({ reasonIds }) => reasonIds.includes("ranking"),
  "Ranking is required",
);

export function publicExplanationFacts(evaluation: SavedEvaluation) {
  if (evaluation.status !== "PROPOSAL_READY" || !evaluation.winnerId)
    return null;
  const winner = evaluation.catalog.find(
    (candidate) => candidate.id === evaluation.winnerId,
  );
  if (!winner) return null;
  const eligible = evaluation.candidates.filter(
    (candidate) => candidate.eligible,
  ).length;
  const winnerScore = evaluation.candidates.find(
    (candidate) => candidate.id === winner.id,
  )?.scoreMicros;
  if (winnerScore === undefined || winnerScore === null) return null;
  const facts: Record<ExplanationReason, string> = {
    ranking: `${winner.name} ranks first among eligible candidates with a public score of ${scorePercent(winnerScore)}/100. Ties use lower per-person price, then candidate ID.`,
    price: `The synthetic catalog estimates $${(winner.mealPricePerPersonCents / 100).toFixed(2)} per ${winner.priceUnit ?? "person"}.`,
    deposit: `Its group reservation deposit is ${formatUnits(BigInt(winner.depositBaseUnits), 6)} USDC.`,
    comparison: `${eligible} of ${evaluation.candidates.length} sample candidates met the group's confirmed requirements.`,
  };
  return { winner: winner.name, facts };
}

export function renderPublicExplanation(
  evaluation: SavedEvaluation,
  reasonIds: readonly ExplanationReason[],
) {
  const publicFacts = publicExplanationFacts(evaluation);
  if (!publicFacts) throw new Error("No public proposal to explain");
  const selected = rankedSelectionSchema.parse({ reasonIds }).reasonIds;
  return selected.map((id) => publicFacts.facts[id]).join(" ");
}

export async function explainPublicEvaluation(
  client: KilnClient,
  evaluation: SavedEvaluation,
) {
  const publicFacts = publicExplanationFacts(evaluation);
  if (!publicFacts) throw new Error("No public proposal to explain");
  const selection = await client.complete({
    runId: evaluation.id,
    flow: "decision_explanation",
    promptVersion: EXPLANATION_PROMPT_VERSION,
    schema: rankedSelectionSchema,
    maxTokens: 2048,
    messages: [
      {
        role: "system",
        content: [
          "Select one to three fact IDs that best explain the public booking result.",
          "Always include ranking so the explanation identifies the selected candidate.",
          'Return only a JSON object with exactly one key, for example {"reasonIds":["ranking","price"]}.',
          "Allowed IDs: ranking, price, deposit, comparison. Do not repeat an ID or add prose, markdown, or other keys.",
          "Do not infer private preferences, identities, rejection reasons, allergies, or venue facts.",
          "The application renders approved fact sentences; you cannot write new claims.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          syntheticCatalog: evaluation.syntheticCatalog,
          publicFacts: publicFacts.facts,
        }),
      },
    ],
  });
  return {
    reasonIds: selection.reasonIds,
    text: renderPublicExplanation(evaluation, selection.reasonIds),
  };
}

export function fallbackPublicExplanation(evaluation: SavedEvaluation) {
  const reasonIds: ExplanationReason[] = ["ranking", "comparison", "deposit"];
  return { reasonIds, text: renderPublicExplanation(evaluation, reasonIds) };
}
