import type { Evaluation, EvaluationStatus } from "../decision-engine.js";
import type { EvaluationInput } from "../schemas/decision.js";
import type { Constraint } from "../schemas/constraints.js";
import {
  dedupeDiagnostics,
  diagnostic,
  sortDiagnostics,
  summarizeDiagnostics,
  type Diagnostic,
  type DiagnosticInput,
} from "./types.js";

// A margin below one percent of the scoring range means the group is choosing
// between near-identical options. 1_000_000 micros is the full range because
// satisfaction is `max(0, 1 - distance / 1000)` normalized to [0, 1].
const NARROW_MARGIN_MICROS = 10_000;
const TAXONOMY_LIMIT = 12;

function constraintKey(constraint: Constraint): string {
  return constraint.field === "dietary_requirement"
    ? `${constraint.field}:${constraint.value}`
    : constraint.field;
}

// The engine reports one violation per (candidate, constraint) pair. Turn that
// into "who is blocking what": a constraint that fails for every candidate is a
// group-level conflict, while one that fails for a single candidate is noise.
function eligibilityDiagnostics(
  result: Evaluation,
  input: EvaluationInput,
): DiagnosticInput[] {
  const general = new Map<string, number>();
  const perConstraint = new Map<
    string,
    {
      failures: number;
      participant: string | null;
      revisionId: string | null;
      field: string | null;
    }
  >();
  const total = result.candidates.length;

  for (const candidate of result.candidates) {
    for (const violation of candidate.violations) {
      if (violation.participant === null) {
        general.set(violation.code, (general.get(violation.code) ?? 0) + 1);
        continue;
      }
      const key = `${violation.participant.toLowerCase()}|${violation.field ?? violation.code}`;
      const existing = perConstraint.get(key);
      if (existing) existing.failures += 1;
      else
        perConstraint.set(key, {
          failures: 1,
          participant: violation.participant,
          revisionId: violation.revisionId,
          field: violation.field,
        });
    }
  }

  const output: DiagnosticInput[] = [];
  for (const [code, count] of general) {
    if (count === 0) continue;
    const stage: Record<string, DiagnosticInput["code"]> = {
      UNAVAILABLE: "DEC_CANDIDATE_UNAVAILABLE",
      MERCHANT_NOT_PERMITTED: "DEC_MERCHANT_NOT_PERMITTED",
      SLOT_UNAVAILABLE: "DEC_SLOT_UNAVAILABLE",
      DEPOSIT_UNAFFORDABLE: "DEC_DEPOSIT_UNAFFORDABLE",
    };
    const mapped = stage[code];
    if (mapped)
      output.push({
        code: mapped,
        detail: { candidates: String(count), total: String(total) },
      });
  }
  for (const entry of perConstraint.values()) {
    // A constraint that failed for every candidate is the group's real blocker.
    if (entry.failures < total) continue;
    // The field is carried as a structured key so the operator can see which
    // condition is unsatisfiable without parsing the message. The code is
    // non-shareable, so this never reaches the group.
    output.push({
      code: "DEC_CONSTRAINT_UNSATISFIED",
      participant: entry.participant,
      revisionId: entry.revisionId,
      field: entry.field,
      detail: { candidates: String(entry.failures), total: String(total) },
    });
  }

  // Every candidate rejected by some participant, but no single constraint
  // failing everywhere: the group's requirements are mutually unsatisfiable.
  const allIneligible =
    total > 0 && result.candidates.every((candidate) => !candidate.eligible);
  if (
    allIneligible &&
    !output.some((entry) => entry.code === "DEC_CONSTRAINT_UNSATISFIED")
  )
    output.push({ code: "DEC_PARTICIPANT_ONESIDED" });

  if (allIneligible)
    output.push({
      code: "DEC_NO_ELIGIBLE_CANDIDATE",
      detail: { candidates: String(total) },
    });
  return output;
}

// Non-negotiables are the only constraints that fail closed on missing
// metadata, and the catalog's `restaurants-v1` entries deliberately report
// unknown wheelchair and dietary support. Flag that explicitly so the missing
// metadata is never mistaken for a group disagreement.
function nonNegotiableDiagnostics(input: EvaluationInput): DiagnosticInput[] {
  const required = new Set<string>();
  for (const revision of input.preferences)
    for (const constraint of revision.extraction.constraints)
      if (constraint.type === "non_negotiable")
        required.add(constraintKey(constraint));
  if (!required.size) return [];

  const catalog = input.catalog.restaurants.filter(
    (candidate) => candidate.available,
  );
  const unknown: string[] = [];
  const check: Record<string, boolean> = {
    shellfish_safe: catalog.every((c) => c.shellfishSafe !== "supported"),
    wheelchair_accessible: catalog.every(
      (c) => c.wheelchairAccessible !== "supported",
    ),
    vegetarian: catalog.every((c) => c.dietary.vegetarian !== "supported"),
    vegan: catalog.every((c) => c.dietary.vegan !== "supported"),
    halal: catalog.every((c) => c.dietary.halal !== "supported"),
    gluten_free: catalog.every((c) => c.dietary.gluten_free !== "supported"),
  };
  for (const key of required) if (check[key]) unknown.push(key);
  if (!unknown.length) return [];
  return [
    {
      code: "DEC_NONNEGOTIABLE_UNKNOWN",
      field: unknown.sort().slice(0, TAXONOMY_LIMIT).join(","),
      detail: { requirements: unknown.join(",") },
    },
  ];
}

function rankingDiagnostics(result: Evaluation): DiagnosticInput[] {
  const ranked = result.candidates
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => (b.scoreMicros ?? 0) - (a.scoreMicros ?? 0));
  const output: DiagnosticInput[] = [];
  if (ranked.length >= 2) {
    const [first, second] = ranked;
    if (first!.scoreMicros === second!.scoreMicros)
      output.push({
        code: "DEC_SCORE_TIE",
        detail: {
          candidates: [first!.id, second!.id].join(","),
          scoreMicros: String(first!.scoreMicros),
        },
      });
    else {
      const margin = first!.scoreMicros! - second!.scoreMicros!;
      if (margin <= NARROW_MARGIN_MICROS)
        output.push({
          code: "DEC_NARROW_MARGIN",
          detail: {
            candidates: [first!.id, second!.id].join(","),
            marginMicros: String(margin),
          },
        });
    }
  }
  // The winner is decided by a tie-break when it shares the top score but is
  // not the first candidate by ordinal ID or is chosen on price.
  const eligible = result.candidates.filter((candidate) => candidate.eligible);
  const topScore = eligible.reduce<number | null>(
    (best, candidate) =>
      best === null || (candidate.scoreMicros ?? -1) > best
        ? (candidate.scoreMicros ?? -1)
        : best,
    null,
  );
  if (topScore !== null) {
    const leaders = eligible.filter(
      (candidate) => candidate.scoreMicros === topScore,
    );
    if (leaders.length >= 2)
      output.push({
        code: "DEC_WINNER_BY_TIEBREAK",
        detail: {
          candidates: leaders.map((candidate) => candidate.id).join(","),
          winner: result.winnerId ?? "",
        },
      });
  }
  return output;
}

function weightDiagnostics(input: EvaluationInput): DiagnosticInput[] {
  const positive = input.preferences.some((revision) =>
    revision.extraction.constraints.some(
      (constraint) => constraint.type === "soft" && constraint.weight > 0,
    ),
  );
  return positive ? [] : [{ code: "PRF_ZERO_WEIGHT_TOTAL" }];
}

const STATUS_DIAGNOSTIC: Record<EvaluationStatus, DiagnosticInput["code"]> = {
  PROPOSAL_READY: "DEC_SCORE_TIE",
  NO_MATCH: "DEC_NO_ELIGIBLE_CANDIDATE",
  AWAITING_CONFIRMATION: "PRF_AWAITING_CONFIRMATION",
  NEEDS_CLARIFICATION: "PRF_UNRESOLVED_CLARIFICATION",
};

// Explain an evaluation. `evaluateDecision` answers "which candidate wins"; this
// answers "if nobody should book yet, why, whose input is responsible, and what
// unblocks it". It is a pure function of the same input plus the engine result,
// so it can run in tests and in evidence generation without I/O.
export function analyzeEvaluation(
  result: Evaluation,
  input: EvaluationInput,
): Diagnostic[] {
  const collected: DiagnosticInput[] = [];

  // Clarifications and unsupported requirements are the earliest blockers and
  // suppress candidate evaluation entirely, so report them and stop.
  for (const revision of input.preferences) {
    const { clarifications, unsupportedRequirements } = revision.extraction;
    if (clarifications.length)
      collected.push({
        code: "PRF_UNRESOLVED_CLARIFICATION",
        participant: revision.participant,
        revisionId: revision.revisionId,
        detail: { count: String(clarifications.length) },
      });
    if (unsupportedRequirements.length)
      collected.push({
        code: "PRF_UNSUPPORTED_REQUIREMENT",
        participant: revision.participant,
        revisionId: revision.revisionId,
        detail: { count: String(unsupportedRequirements.length) },
      });
  }

  if (result.status === "NEEDS_CLARIFICATION") {
    if (!collected.length)
      collected.push({ code: STATUS_DIAGNOSTIC.NEEDS_CLARIFICATION });
  } else if (result.status === "AWAITING_CONFIRMATION") {
    for (const revision of input.preferences)
      if (revision.confirmedRevisionId !== revision.revisionId)
        collected.push({
          code: "PRF_AWAITING_CONFIRMATION",
          participant: revision.participant,
          revisionId: revision.revisionId,
        });
  } else {
    collected.push(...weightDiagnostics(input));
    collected.push(...nonNegotiableDiagnostics(input));
    collected.push(...eligibilityDiagnostics(result, input));
    if (result.status === "PROPOSAL_READY")
      collected.push(...rankingDiagnostics(result));
  }

  if (result.status === "PROPOSAL_READY" && !collected.length)
    collected.push({ code: STATUS_DIAGNOSTIC.PROPOSAL_READY });

  return sortDiagnostics(dedupeDiagnostics(collected.map(diagnostic)));
}

export type EvaluationReport = {
  status: EvaluationStatus;
  diagnostics: Diagnostic[];
  summary: ReturnType<typeof summarizeDiagnostics>;
};

// The group API only ever sees `publicEvaluation`, which keeps `status` but drops
// the per-revision detail `analyzeEvaluation` needs to attribute a blocker. This
// narrower entry point reports what the status alone justifies, so the read
// endpoints can surface a reminder without widening what crosses the boundary.
// It deliberately says nothing about *why* candidates were ineligible, because
// the projected ranking no longer carries that attribution.
export function analyzeEvaluationStatus(result: {
  status: EvaluationStatus;
}): Diagnostic[] {
  return sortDiagnostics([
    diagnostic({ code: STATUS_DIAGNOSTIC[result.status] }),
  ]);
}

export function evaluationReport(
  result: Evaluation,
  input: EvaluationInput,
): EvaluationReport {
  const list = analyzeEvaluation(result, input);
  return {
    status: result.status,
    diagnostics: list,
    summary: summarizeDiagnostics(list),
  };
}
