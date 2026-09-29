import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantPicker } from "../app/components/restaurant-picker.js";
import { groupEvaluationOptions } from "../src/lib/server/group-config.js";
import { createRestaurantCatalog } from "../src/lib/fixtures/restaurants.js";
import { demoRolesSchema } from "../src/lib/demo-roles.js";
import roles from "../contracts/deployments/demo-roles.11155111.json";
import { RESTAURANT_IDS } from "../src/lib/restaurant-options.js";
import { evaluateDecision } from "../src/lib/decision-engine.js";
import { permittedGroupMerchants } from "../src/lib/group-conditions.js";

test("ordinary catalog exposes forty selectable candidates while Explore retains five", () => {
  const options = groupEvaluationOptions("2030-01-05T10:00:00Z");
  assert.equal(options.catalog.restaurants.length, 40);
  assert.equal(
    new Set(options.catalog.restaurants.map((r) => r.merchant)).size,
    40,
  );
  assert.deepEqual(
    options.catalog.restaurants.map((r) => r.id),
    RESTAURANT_IDS,
  );
  assert.equal(
    createRestaurantCatalog(demoRolesSchema.parse(roles), [
      "2030-01-05T10:00:00Z",
    ]).restaurants.length,
    5,
  );
  const html = renderToStaticMarkup(
    createElement(RestaurantPicker, { selected: ["L"], onChange: () => {} }),
  );
  assert.match(html, /Plant Studio/);
  assert.match(html, /fictional samples/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 40);
});

test("a new dietary candidate can win and saved shortlists cannot be bypassed", () => {
  const options = groupEvaluationOptions("2030-01-05T10:00:00Z");
  const members = [1, 2, 3, 4].map(
    (n) => `0x${n.toString(16).padStart(40, "0")}`,
  );
  const input = {
    ...options,
    members,
    maxDeposit: "40000000",
    maxTotalSpend: "40000000",
    slot: { startsAt: "2030-01-05T10:00:00Z", timeZone: "Asia/Seoul" },
    preferences: members.map((participant) => ({
      participant,
      revisionId: participant,
      confirmedRevisionId: participant,
      extraction: {
        schemaVersion: 1,
        constraints: [
          {
            type: "non_negotiable",
            field: "dietary_requirement",
            value: "vegan",
          },
        ],
        clarifications: [],
        unsupportedRequirements: [],
      },
    })),
  };
  assert.equal(evaluateDecision(input).winnerId, "L");
  input.permittedMerchants = permittedGroupMerchants(
    ["A", "B"],
    options.catalog,
    options.permittedMerchants,
  );
  assert.equal(evaluateDecision(input).status, "NO_MATCH");
});
