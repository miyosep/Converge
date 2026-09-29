import assert from "node:assert/strict";
import { createRestaurantCatalog } from "../src/lib/fixtures/restaurants.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";
import { evaluateDecision } from "../src/lib/decision-engine.js";
import { savedEvaluationView } from "../src/lib/group-view.js";
import { explainPublicEvaluation } from "../src/lib/group-explanation.js";
import { createKilnClient, type KilnAttempt } from "../src/lib/kiln/client.js";

const key = process.env.KILN_API_KEY;
if (!key) throw new Error("KILN_API_KEY is required");
const address = (value: number) =>
  `0x${value.toString(16).padStart(40, "0")}` as `0x${string}`;
const members = [1, 2, 3, 4, 5, 6].map(address);
const catalog = createRestaurantCatalog(
  {
    schemaVersion: 1,
    chainId: 11155111,
    mode: "single-operator-demo",
    executor: address(20),
    merchants: {
      A: address(21),
      B: address(22),
      C: address(23),
      D: address(24),
      E: address(25),
    },
  },
  ["2030-01-05T10:00:00Z"],
);
const input = {
  members,
  catalog,
  preferences: createBaselinePreferences(members),
  slot: { startsAt: "2030-01-05T10:00:00Z", timeZone: "Asia/Seoul" },
  permittedMerchants: catalog.restaurants.map(
    (restaurant) => restaurant.merchant,
  ),
  contributionPerParticipant: "10000000",
  maxDeposit: "60000000",
  maxTotalSpend: "60000000",
};
const evaluation = savedEvaluationView({
  id: "synthetic-public-explanation-check",
  createdAt: "2026-09-29T00:00:00Z",
  result: evaluateDecision(input),
  catalog,
  contributionPerParticipant: input.contributionPerParticipant,
  maxDeposit: input.maxDeposit,
  maxTotalSpend: input.maxTotalSpend,
});
assert.equal(evaluation.status, "PROPOSAL_READY");
const attempts: KilnAttempt[] = [];
const client = createKilnClient({
  apiKey: key,
  onAttempt: (attempt) => {
    attempts.push(attempt);
  },
});
const explanation = await explainPublicEvaluation(client, evaluation);
assert.ok(explanation.text.includes("KAGAMI"));
console.log(
  JSON.stringify({
    synthetic: true,
    flow: "decision_explanation",
    status: "passed",
    reasonIds: explanation.reasonIds,
    attempts: attempts.map((attempt) => ({
      status: attempt.usage.status,
      inputTokens: attempt.usage.inputTokens,
      outputTokens: attempt.usage.outputTokens,
      totalTokens: attempt.usage.totalTokens,
      errorCode: attempt.errorCode,
    })),
  }),
);
