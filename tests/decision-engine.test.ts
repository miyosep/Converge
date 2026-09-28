import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import {
  evaluateDecision,
  publicEvaluation,
} from "../src/lib/decision-engine.js";
import { demoRolesSchema } from "../src/lib/demo-roles.js";
import { createRestaurantCatalog } from "../src/lib/fixtures/restaurants.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";
import type { EvaluationInput } from "../src/lib/schemas/decision.js";

const address = (value: number) =>
  getAddress(`0x${value.toString(16).padStart(40, "0")}`);
const roles = demoRolesSchema.parse({
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
});
const slot = { startsAt: "2030-01-05T10:00:00Z", timeZone: "Asia/Seoul" };
function baseline(budget = 3500): EvaluationInput {
  const members = [1, 2, 3, 4, 5, 6].map(address);
  return {
    members,
    preferences: createBaselinePreferences(members, budget),
    slot,
    permittedMerchants: Object.values(roles.merchants),
    contributionPerParticipant: "10000000",
    maxDeposit: "60000000",
    maxTotalSpend: "60000000",
    catalog: createRestaurantCatalog(roles, [slot.startsAt]),
  };
}

test("the specified baseline, lower-budget, and changed-merchant scenarios choose A/B/B", () => {
  const initial = evaluateDecision(baseline());
  assert.equal(initial.winnerId, "A");
  assert.deepEqual(initial.ranking, ["A", "B", "D"]);
  assert.equal(
    initial.candidates.find((candidate) => candidate.id === "A")?.scoreMicros,
    900000,
  );
  assert.equal(evaluateDecision(baseline(2500)).winnerId, "B");
  const changed = baseline();
  changed.permittedMerchants = changed.permittedMerchants.filter(
    (value) => value !== roles.merchants.A,
  );
  assert.equal(evaluateDecision(changed).winnerId, "B");
});

test("unknown safety and unsupported dietary metadata never satisfy non-negotiables", () => {
  const input = baseline();
  for (const candidate of input.catalog.restaurants)
    candidate.shellfishSafe = "unknown";
  assert.equal(evaluateDecision(input).status, "NO_MATCH");
  const accessible = baseline();
  accessible.preferences[0]!.extraction.constraints.push({
    type: "non_negotiable",
    field: "wheelchair_accessible",
    value: true,
  });
  assert.equal(evaluateDecision(accessible).status, "NO_MATCH");
  const dietary = baseline();
  dietary.preferences[0]!.extraction.constraints.push({
    type: "non_negotiable",
    field: "dietary_requirement",
    value: "vegan",
  });
  assert.equal(evaluateDecision(dietary).status, "NO_MATCH");
});

test("stale confirmation, clarification, and unsupported requirements block evaluation", () => {
  const input = baseline();
  input.preferences[0]!.confirmedRevisionId = "older";
  assert.equal(evaluateDecision(input).status, "AWAITING_CONFIRMATION");
  assert.deepEqual(evaluateDecision(input).candidates, []);
  input.preferences[0]!.extraction.clarifications = ["Confirm the date"];
  assert.equal(evaluateDecision(input).status, "NEEDS_CLARIFICATION");
  input.preferences[0]!.extraction.clarifications = [];
  input.preferences[0]!.extraction.unsupportedRequirements = ["Peanut allergy"];
  assert.equal(evaluateDecision(input).winnerId, null);
});

test("a missing member, outsider, or duplicate revision owner cannot authorize evaluation", () => {
  const duplicate = baseline();
  duplicate.preferences[1]!.participant = duplicate.members[0]!;
  assert.throws(() => evaluateDecision(duplicate));
  const outsider = baseline();
  outsider.preferences[0]!.participant = address(99);
  assert.throws(() => evaluateDecision(outsider));
  const missing = baseline();
  missing.preferences.pop();
  assert.throws(() => evaluateDecision(missing));
});

test("meal budgets and deposit affordability are enforced independently", () => {
  const input = baseline();
  input.maxDeposit = "40000000";
  assert.equal(evaluateDecision(input).winnerId, "B");
  input.maxDeposit = "35000000";
  assert.equal(evaluateDecision(input).status, "NO_MATCH");
  assert.equal(evaluateDecision(baseline(2300)).status, "NO_MATCH");
  const overflow = baseline();
  overflow.contributionPerParticipant = ((1n << 256n) / 6n + 1n).toString();
  assert.throws(() => evaluateDecision(overflow));
});

test("empty permissions, unsupported slots, and conflicting exact slots produce no match", () => {
  const input = baseline();
  input.permittedMerchants = [];
  assert.equal(evaluateDecision(input).status, "NO_MATCH");
  const wrongSlot = baseline();
  wrongSlot.slot = { ...slot, startsAt: "2030-01-06T10:00:00Z" };
  assert.equal(evaluateDecision(wrongSlot).status, "NO_MATCH");
  const conflict = baseline();
  conflict.preferences[0]!.extraction.constraints.push({
    type: "hard",
    field: "reservation_slot",
    operator: "eq",
    value: { ...slot, startsAt: "2030-01-06T10:00:00Z" },
  });
  assert.equal(evaluateDecision(conflict).status, "NO_MATCH");
});

test("zero weights keep mandatory constraints and use price then stable ID tie breaks", () => {
  const input = baseline();
  for (const revision of input.preferences)
    for (const constraint of revision.extraction.constraints)
      if (constraint.type === "soft") constraint.weight = 0;
  assert.equal(evaluateDecision(input).winnerId, "B");
  input.catalog.restaurants.find(
    (candidate) => candidate.id === "A",
  )!.mealPricePerPersonCents = 2400;
  assert.equal(evaluateDecision(input).winnerId, "A");
});

test("tiny positive weights are preserved and reordered catalog data does not change ranking", () => {
  const input = baseline();
  for (const revision of input.preferences)
    for (const constraint of revision.extraction.constraints)
      if (constraint.type === "soft") constraint.weight = Number.MIN_VALUE;
  assert.deepEqual(evaluateDecision(input).ranking, ["A", "B", "D"]);
  input.catalog.restaurants.reverse();
  assert.deepEqual(evaluateDecision(input).ranking, ["A", "B", "D"]);
});

test("group projection never carries participant identities, revision IDs, or failure fields", () => {
  const input = baseline();
  const internal = evaluateDecision(input);
  assert.ok(
    internal.candidates.find((candidate) => candidate.id === "C")!.violations
      .length,
  );
  const published = JSON.stringify(publicEvaluation(internal));
  for (const revision of input.preferences) {
    assert.equal(published.includes(revision.participant), false);
    assert.equal(published.includes(revision.revisionId), false);
  }
  assert.equal(published.includes("shellfish"), false);
  assert.equal(published.includes("violations"), false);
});
