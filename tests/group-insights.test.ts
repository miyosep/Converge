import assert from "node:assert/strict";
import test from "node:test";
import { createRestaurantCatalog } from "../src/lib/fixtures/restaurants.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";
import { evaluateDecision } from "../src/lib/decision-engine.js";
import { savedEvaluationView } from "../src/lib/group-view.js";
import {
  explainPublicEvaluation,
  explanationSelectionSchema,
  fallbackPublicExplanation,
  renderPublicExplanation,
} from "../src/lib/group-explanation.js";
import { createKilnClient } from "../src/lib/kiln/client.js";
import { usageRowsToFlows } from "../src/lib/db/group-insights.js";

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
  id: "evaluation-1",
  createdAt: "2026-09-29T00:00:00Z",
  result: evaluateDecision(input),
  catalog,
  contributionPerParticipant: input.contributionPerParticipant,
  maxDeposit: input.maxDeposit,
  maxTotalSpend: input.maxTotalSpend,
});

test("explanation model receives only public facts and cannot supply new prose", async () => {
  let requestBody = "";
  const client = createKilnClient({
    apiKey: "test-key",
    onAttempt: () => {},
    fetchImpl: async (_url, options) => {
      requestBody = String(options?.body);
      return Response.json({
        id: "response-1",
        model: "qwen3-32b",
        choices: [
          {
            message: {
              role: "assistant",
              content: '{"reasonIds":["ranking","deposit"]}',
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      });
    },
  });
  const result = await explainPublicEvaluation(client, evaluation);
  assert.deepEqual(result.reasonIds, ["ranking", "deposit"]);
  assert.match(result.text, /KAGAMI ranks first/);
  assert.match(result.text, /45 MockUSDC/);
  assert.doesNotMatch(
    requestBody,
    /rawText|extraction|revisionId|participant|Alice|Bob/,
  );
  for (const wallet of members) assert.ok(!requestBody.includes(wallet));
  assert.throws(
    () => renderPublicExplanation(evaluation, ["ranking", "ranking"]),
    /Invalid input/,
  );
  assert.equal(fallbackPublicExplanation(evaluation).reasonIds.length, 3);
  assert.throws(
    () => renderPublicExplanation(evaluation, ["price"]),
    /Ranking is required/,
  );
  assert.deepEqual(
    explanationSelectionSchema.parse({ reasonIds: ["price"] }).reasonIds,
    ["price"],
    "earlier stored selections remain readable",
  );
});

test("usage totals preserve missing metrics, retries, and application cache hits", () => {
  const rows = [
    {
      flow: "constraint_extraction",
      attempts: 2,
      successful_attempts: 1,
      retry_attempts: 1,
      unavailable_usage_attempts: 1,
      unknown_input: 1,
      unknown_output: 1,
      unknown_total: 1,
      unknown_cost: 2,
      unknown_cached: 2,
      unknown_reasoning: 2,
      input_tokens: "100",
      output_tokens: "40",
      total_tokens: "140",
      reported_cost_usd: null,
      cached_input_tokens: null,
      reasoning_tokens: null,
    },
    {
      flow: "decision_explanation",
      attempts: 1,
      successful_attempts: 1,
      retry_attempts: 0,
      unavailable_usage_attempts: 0,
      unknown_input: 0,
      unknown_output: 0,
      unknown_total: 0,
      unknown_cost: 0,
      unknown_cached: 1,
      unknown_reasoning: 1,
      input_tokens: "20",
      output_tokens: "8",
      total_tokens: "28",
      reported_cost_usd: "0.000002",
      cached_input_tokens: null,
      reasoning_tokens: null,
    },
  ];
  const flows = usageRowsToFlows(rows, 2);
  const extraction = flows.find(
    (flow) => flow.flow === "constraint_extraction",
  )!;
  assert.equal(extraction.attempts, 2);
  assert.equal(extraction.retryAttempts, 1);
  assert.equal(extraction.failedAttempts, 1);
  assert.equal(extraction.inputTokens, null);
  assert.equal(extraction.applicationCacheHits, 0);
  const explanation = flows.find(
    (flow) => flow.flow === "decision_explanation",
  )!;
  assert.equal(explanation.inputTokens, 20);
  assert.equal(explanation.reportedCostUsd, 0.000002);
  assert.equal(explanation.applicationCacheHits, 2);
  assert.equal(explanation.energyJoules, null);
  assert.equal(
    flows.find((flow) => flow.flow === "candidate_analysis")!.attempts,
    0,
  );
});
