import {
  evaluationInputSchema,
  type EvaluationInput,
  type Restaurant,
} from "./schemas/decision.js";
import type { Constraint } from "./schemas/constraints.js";

export type EvaluationStatus =
  | "PROPOSAL_READY"
  | "NO_MATCH"
  | "AWAITING_CONFIRMATION"
  | "NEEDS_CLARIFICATION";
type Violation = {
  code: string;
  participant: string | null;
  revisionId: string | null;
  field: string | null;
};
type CandidateResult = {
  id: string;
  eligible: boolean;
  scoreMicros: number | null;
  violations: Violation[];
};
export type Evaluation = {
  engineVersion: "decision-v1";
  fixtureVersion: "restaurants-v1";
  status: EvaluationStatus;
  winnerId: string | null;
  ranking: string[];
  candidates: CandidateResult[];
  revisions: { participant: string; revisionId: string }[];
};

function passes(
  candidate: Restaurant,
  constraint: Constraint,
  slot: string,
): boolean {
  if (constraint.type === "soft") return true;
  switch (constraint.field) {
    case "budget_per_person_cents":
      return candidate.mealPricePerPersonCents <= constraint.value;
    case "subway_distance_meters":
      return candidate.subwayDistanceMeters <= constraint.value;
    case "reservation_slot":
      return (
        constraint.value.startsAt === slot &&
        candidate.reservationSlots.includes(constraint.value.startsAt)
      );
    case "shellfish_safe":
      return candidate.shellfishSafe === "supported";
    case "wheelchair_accessible":
      return candidate.wheelchairAccessible === "supported";
    case "dietary_requirement":
      return candidate.dietary[constraint.value] === "supported";
  }
}

function score(candidate: Restaurant, input: EvaluationInput): number {
  const satisfaction = {
    quiet: candidate.quiet / 100,
    atmosphere: candidate.atmosphere / 100,
    subway_proximity: Math.max(0, 1 - candidate.subwayDistanceMeters / 1000),
  };
  const scores: number[] = [];
  for (const revision of input.preferences) {
    const weights = revision.extraction.constraints.filter(
      (constraint) => constraint.type === "soft" && constraint.weight > 0,
    );
    const maxWeight = Math.max(
      0,
      ...weights.map((constraint) =>
        constraint.type === "soft" ? constraint.weight : 0,
      ),
    );
    if (!maxWeight) continue;
    let numerator = 0;
    let denominator = 0;
    // Rescaling preserves relative weights and avoids underflow for tiny positive weights.
    for (const constraint of weights)
      if (constraint.type === "soft") {
        const weight = constraint.weight / maxWeight;
        numerator += weight * satisfaction[constraint.field];
        denominator += weight;
      }
    scores.push(numerator / denominator);
  }
  return scores.length
    ? Math.round(
        (scores.reduce((sum, value) => sum + value, 0) / scores.length) *
          1_000_000,
      )
    : 0;
}

export function evaluateDecision(value: unknown): Evaluation {
  const input = evaluationInputSchema.parse(value);
  const result: Evaluation = {
    engineVersion: "decision-v1",
    fixtureVersion: input.catalog.fixtureVersion,
    status: "NO_MATCH",
    winnerId: null,
    ranking: [],
    candidates: [],
    revisions: input.preferences.map((revision) => ({
      participant: revision.participant,
      revisionId: revision.revisionId,
    })),
  };
  if (
    input.preferences.some(
      (revision) =>
        revision.extraction.clarifications.length ||
        revision.extraction.unsupportedRequirements.length,
    )
  ) {
    return { ...result, status: "NEEDS_CLARIFICATION" };
  }
  if (
    input.preferences.some(
      (revision) => revision.confirmedRevisionId !== revision.revisionId,
    )
  ) {
    return { ...result, status: "AWAITING_CONFIRMATION" };
  }
  const permitted = new Set(
    input.permittedMerchants.map((address) => address.toLowerCase()),
  );
  for (const candidate of input.catalog.restaurants) {
    const violations: Violation[] = [];
    const general = (code: string) =>
      violations.push({
        code,
        participant: null,
        revisionId: null,
        field: null,
      });
    if (!candidate.available) general("UNAVAILABLE");
    if (!permitted.has(candidate.merchant.toLowerCase()))
      general("MERCHANT_NOT_PERMITTED");
    if (!candidate.reservationSlots.includes(input.slot.startsAt))
      general("SLOT_UNAVAILABLE");
    const deposit = BigInt(candidate.depositBaseUnits);
    if (
      deposit > BigInt(input.maxDeposit) ||
      deposit > BigInt(input.maxTotalSpend) ||
      deposit > BigInt(input.contributionPerParticipant) * 6n
    )
      general("DEPOSIT_UNAFFORDABLE");
    for (const revision of input.preferences)
      for (const constraint of revision.extraction.constraints) {
        if (!passes(candidate, constraint, input.slot.startsAt))
          violations.push({
            code: "CONSTRAINT_UNSATISFIED",
            participant: revision.participant,
            revisionId: revision.revisionId,
            field: constraint.field,
          });
      }
    result.candidates.push({
      id: candidate.id,
      eligible: !violations.length,
      scoreMicros: violations.length ? null : score(candidate, input),
      violations,
    });
  }
  const prices = new Map(
    input.catalog.restaurants.map((candidate) => [
      candidate.id,
      candidate.mealPricePerPersonCents,
    ]),
  );
  result.ranking = result.candidates
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => {
      const scoreDifference = b.scoreMicros! - a.scoreMicros!;
      const priceDifference = prices.get(a.id)! - prices.get(b.id)!;
      return (
        scoreDifference ||
        priceDifference ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
    })
    .map((candidate) => candidate.id);
  result.winnerId = result.ranking[0] ?? null;
  result.status = result.winnerId ? "PROPOSAL_READY" : "NO_MATCH";
  return result;
}

// Use this allowlist for shared group responses; internal violations and revisions stay private.
export function publicEvaluation(result: Evaluation) {
  return {
    engineVersion: result.engineVersion,
    fixtureVersion: result.fixtureVersion,
    status: result.status,
    winnerId: result.winnerId,
    ranking: [...result.ranking],
    candidates: result.candidates.map((candidate) => ({
      id: candidate.id,
      eligible: candidate.eligible,
      scoreMicros: candidate.scoreMicros,
    })),
  };
}
