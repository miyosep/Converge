import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantPicker } from "../app/components/restaurant-picker.js";
import {
  CATEGORY_IDS,
  catalogOptions,
  categories,
  optionsForCategory,
  type Category,
} from "../src/lib/catalog-options.js";
import {
  groupEvaluationOptions,
  currentGroupPolicyConfig,
} from "../src/lib/server/group-config.js";
import { evaluateDecision } from "../src/lib/decision-engine.js";
import {
  permittedRestaurantIdsSchema,
  permittedGroupMerchants,
} from "../src/lib/group-conditions.js";
import {
  extractionSchema,
  type Constraint,
} from "../src/lib/schemas/constraints.js";
import { buildGroupPolicy } from "../src/lib/group-policy.js";
import { savedEvaluationView } from "../src/lib/group-view.js";
import { renderPublicExplanation } from "../src/lib/group-explanation.js";
import { extractPreferences } from "../src/lib/kiln/extraction.js";
import { createKilnClient } from "../src/lib/kiln/client.js";

const startsAt = "2030-01-05T10:00:00Z";
function inputFor(
  category: Category,
  constraints: Constraint[] = [],
  count = 4,
) {
  const members = Array.from(
    { length: count },
    (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`,
  );
  const cap = String(Math.min(count * 10, 60) * 1_000_000);
  return {
    ...groupEvaluationOptions(startsAt, category),
    members,
    maxDeposit: cap,
    maxTotalSpend: cap,
    slot: { startsAt, timeZone: "Asia/Seoul" },
    preferences: members.map((participant) => ({
      participant,
      revisionId: participant,
      confirmedRevisionId: participant,
      extraction: {
        schemaVersion: 1,
        constraints,
        clarifications: [],
        unsupportedRequirements: [],
      },
    })),
  };
}

test("five categories have twenty distinct selectable examples and stable unique merchants", () => {
  assert.equal(catalogOptions.length, 100);
  assert.equal(new Set(catalogOptions.map((item) => item.id)).size, 100);
  const merchants: string[] = [];
  for (const category of CATEGORY_IDS) {
    const options = optionsForCategory(category);
    assert.equal(options.length, 20);
    assert.ok(
      permittedRestaurantIdsSchema.safeParse(options.map((item) => item.id))
        .success,
    );
    const input = inputFor(category);
    assert.equal(input.catalog.restaurants.length, 20);
    merchants.push(...input.permittedMerchants);
    const html = renderToStaticMarkup(
      createElement(RestaurantPicker, {
        category,
        selected: options.map((item) => item.id),
        onChange: () => {},
        onCategoryChange: () => {},
      }),
    );
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 20);
    assert.match(html, /fictional samples/);
    assert.ok(html.includes(categories[category].priceUnit));
    assert.ok(html.includes('aria-pressed="true"'));
    assert.equal(evaluateDecision(input).status, "PROPOSAL_READY");
  }
  assert.equal(
    new Set(merchants.map((value) => value.toLowerCase())).size,
    100,
  );
  for (const ids of [
    ["A", "stay-01"],
    ["stay-01", "space-01"],
    ["class-21"],
    ["sport-01", "sport-01"],
  ])
    assert.equal(permittedRestaurantIdsSchema.safeParse(ids).success, false);
});

test("capacity, beds and every required facility are enforced before ranking", () => {
  const input = inputFor(
    "stay",
    [
      { type: "hard", field: "minimum_beds", operator: "gte", value: 4 },
      {
        type: "non_negotiable",
        field: "facility_requirement",
        value: "parking",
      },
      {
        type: "non_negotiable",
        field: "facility_requirement",
        value: "pet_friendly",
      },
    ],
    6,
  );
  const result = evaluateDecision(input);
  assert.equal(result.status, "PROPOSAL_READY");
  for (const id of result.ranking) {
    const candidate = input.catalog.restaurants.find((item) => item.id === id)!;
    assert.ok(candidate.beds! >= 4);
    assert.ok(candidate.capacity! >= 6);
    assert.ok(
      candidate.facilities!.includes("parking") &&
        candidate.facilities!.includes("pet_friendly"),
    );
  }
  assert.ok(
    result.candidates
      .find((item) => item.id === "stay-06")!
      .violations.some((item) => item.code === "INSUFFICIENT_CAPACITY"),
  );
  input.permittedMerchants = permittedGroupMerchants(
    ["stay-06"],
    input.catalog,
    input.permittedMerchants,
  );
  assert.equal(evaluateDecision(input).status, "NO_MATCH");
  const missing = inputFor("stay", [
    { type: "hard", field: "minimum_beds", operator: "gte", value: 1 },
  ]);
  missing.catalog.restaurants.forEach((candidate) => {
    delete candidate.beds;
  });
  assert.equal(evaluateDecision(missing).status, "NO_MATCH");
  for (const category of ["space", "sport", "class"] as const) {
    const facility =
      category === "space"
        ? "projector"
        : category === "sport"
          ? "equipment_rental"
          : "beginner_friendly";
    const scenario = inputFor(category, [
      {
        type: "non_negotiable",
        field: "facility_requirement",
        value: facility,
      },
    ]);
    const evaluated = evaluateDecision(scenario);
    assert.ok(evaluated.ranking.length > 0);
    for (const id of evaluated.ranking)
      assert.ok(
        scenario.catalog.restaurants
          .find((item) => item.id === id)!
          .facilities!.includes(facility),
      );
    scenario.catalog.restaurants.forEach((candidate) => {
      delete candidate.facilities;
    });
    assert.equal(evaluateDecision(scenario).status, "NO_MATCH");
  }
});

test("new categories preserve shortlists, public units and exact policy recipient and deposit", () => {
  for (const category of ["stay", "space", "sport", "class"] as const) {
    const input = inputFor(category);
    input.permittedMerchants = permittedGroupMerchants(
      [`${category}-01`],
      input.catalog,
      input.permittedMerchants,
    );
    const result = evaluateDecision(input);
    assert.equal(result.winnerId, `${category}-01`);
    const winner = input.catalog.restaurants[0]!;
    const policy = buildGroupPolicy({
      groupId: "test-group",
      evaluationId: "test-evaluation",
      decisionNonce: "test-nonce",
      snapshot: input,
      expectedWinner: result.winnerId,
      config: currentGroupPolicyConfig(),
      nowSeconds: Math.floor(Date.parse(startsAt) / 1000) - 86400,
    });
    assert.equal(policy.policy.merchant, winner.merchant);
    assert.equal(policy.policy.paymentAmount, winner.depositBaseUnits);
    assert.equal(policy.policy.approvalThreshold, 4);
    const view = savedEvaluationView({
      id: "test-evaluation",
      createdAt: startsAt,
      result,
      catalog: input.catalog,
      contributionPerParticipant: input.contributionPerParticipant,
      maxDeposit: input.maxDeposit,
      maxTotalSpend: input.maxTotalSpend,
    });
    const explanation = renderPublicExplanation(view, ["ranking", "price"]);
    assert.ok(explanation.includes(categories[category].priceUnit));
    assert.equal(explanation.includes("meal price"), false);
    assert.equal(JSON.stringify(view).includes("violations"), false);
  }
});

test("extraction preserves multiple facilities, rejects duplicates and supplies category price context", async () => {
  const extraction = {
    schemaVersion: 1,
    constraints: [
      {
        type: "non_negotiable",
        field: "facility_requirement",
        value: "parking",
      },
      { type: "non_negotiable", field: "facility_requirement", value: "wifi" },
    ],
    clarifications: [],
    unsupportedRequirements: [],
  };
  assert.ok(extractionSchema.safeParse(extraction).success);
  assert.equal(
    extractionSchema.safeParse({
      ...extraction,
      constraints: [...extraction.constraints, extraction.constraints[0]],
    }).success,
    false,
  );
  const client = createKilnClient({
    apiKey: "synthetic-test-key",
    onAttempt: () => {},
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.match(body.messages[0].content, /Booking category: Stays/);
      assert.match(body.messages[0].content, /person \/ night/);
      assert.match(body.messages[0].content, /Multiple nights/);
      return Response.json({
        id: "test-response",
        model: "qwen3-32b",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify(extraction) },
            finish_reason: "stop",
          },
        ],
      });
    },
  });
  assert.deepEqual(
    await extractPreferences(client, {
      runId: "test-run",
      text: "A stay with parking and Wi-Fi",
      category: "stay",
    }),
    extraction,
  );
});
