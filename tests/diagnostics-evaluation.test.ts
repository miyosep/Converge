import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { evaluateDecision } from "../src/lib/decision-engine.js";
import {
  analyzeEvaluation,
  evaluationReport,
  publicDiagnostics,
  summarizeDiagnostics,
} from "../src/lib/diagnostics/index.js";
import type { DiagnosticCode } from "../src/lib/diagnostics/index.js";
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
const codes = (input: EvaluationInput) =>
  analyzeEvaluation(evaluateDecision(input), input).map((entry) => entry.code);

test("a clean proposal reports no blocking reminder", () => {
  const input = baseline();
  const report = evaluationReport(evaluateDecision(input), input);
  assert.equal(report.status, "PROPOSAL_READY");
  assert.equal(report.summary.blocking, false);
  assert.equal(
    report.diagnostics.some((entry) => entry.severity === "error"),
    false,
  );
  assert.ok(
    report.diagnostics.length > 0,
    "a winner still explains its margin",
  );
});

test("a no-match outcome names the eligibility blocker and stays actionable", () => {
  const input = baseline();
  for (const candidate of input.catalog.restaurants)
    candidate.shellfishSafe = "unsupported";
  // The baseline preferences do not require shellfish safety, so state the
  // requirement here rather than relying on an incidental fixture detail. Every
  // restaurant reports unsupported, so this can only end in no-match.
  for (const revision of input.preferences)
    revision.extraction.constraints.push({
      type: "non_negotiable",
      field: "shellfish_safe",
      value: true,
    });
  const report = evaluationReport(evaluateDecision(input), input);
  assert.equal(report.status, "NO_MATCH");
  assert.equal(report.summary.blocking, true);
  assert.ok(
    report.diagnostics.some(
      (entry) => entry.code === "DEC_NO_ELIGIBLE_CANDIDATE",
    ),
  );
  const noMatch = report.diagnostics.find(
    (entry) => entry.code === "DEC_NO_ELIGIBLE_CANDIDATE",
  )!;
  // No match is a valid outcome, so the reminder must not imply a system fault.
  assert.equal(noMatch.retryable, true);
  assert.equal(noMatch.remedy, "group");
  assert.equal(noMatch.severity, "error");
});

test("an unpermitted merchant is reported at the merchant, not as a generic no-match", () => {
  const input = baseline();
  input.permittedMerchants = [];
  const list = analyzeEvaluation(evaluateDecision(input), input);
  const merchant = list.find(
    (entry) => entry.code === "DEC_MERCHANT_NOT_PERMITTED",
  );
  assert.ok(merchant, "merchant exclusion is named explicitly");
  assert.equal(merchant!.stage, "eligibility");
  assert.equal(merchant!.detail?.candidates, "5");
  assert.equal(merchant!.detail?.total, "5");
});

test("an unaffordable deposit is distinguished from an impossible budget", () => {
  const input = baseline();
  input.maxDeposit = "35000000";
  input.maxTotalSpend = "35000000";
  const deposit = analyzeEvaluation(evaluateDecision(input), input).find(
    (entry) => entry.code === "DEC_DEPOSIT_UNAFFORDABLE",
  );
  assert.ok(deposit, "deposit cap is called out separately");
  assert.equal(deposit!.severity, "warning");

  const budget = baseline(2300);
  const list = analyzeEvaluation(evaluateDecision(budget), budget);
  assert.ok(
    list.some(
      (entry) =>
        entry.code === "DEC_CONSTRAINT_UNSATISFIED" ||
        entry.code === "DEC_NO_ELIGIBLE_CANDIDATE",
    ),
    "a budget that excludes everything still yields a named blocker",
  );
});

test("unsupported non-negotiable metadata is flagged as missing data, not disagreement", () => {
  const input = baseline();
  for (const candidate of input.catalog.restaurants) {
    candidate.wheelchairAccessible = "unknown";
    candidate.dietary.vegan = "unknown";
  }
  // The analyzer only reports a missing-metadata reminder for a requirement the
  // group actually stated, so the constraint has to exist for this to be
  // meaningful. Without it nothing fails and the round is simply ready.
  for (const revision of input.preferences)
    revision.extraction.constraints.push({
      type: "non_negotiable",
      field: "wheelchair_accessible",
      value: true,
    });
  const report = evaluationReport(evaluateDecision(input), input);
  assert.equal(report.status, "NO_MATCH");
  const list = analyzeEvaluation(evaluateDecision(input), input);
  const unknown = list.find(
    (entry) => entry.code === "DEC_NONNEGOTIABLE_UNKNOWN",
  );
  assert.ok(unknown, "missing metadata is called out");
  // The catalog reports unknown wheelchair access for restaurants-v1, so a group
  // requiring it always lands here. This is a catalog problem, not a user error.
  assert.equal(unknown!.remedy, "operator");
  assert.equal(unknown!.retryable, false);
  assert.equal(unknown!.field, "wheelchair_accessible");
});

test("unresolved clarifications block evaluation and suppress engineering noise", () => {
  const input = baseline();
  input.preferences[0]!.extraction.clarifications = ["Which date exactly?"];
  const report = evaluationReport(evaluateDecision(input), input);
  assert.equal(report.status, "NEEDS_CLARIFICATION");
  assert.ok(
    report.diagnostics.some(
      (entry) => entry.code === "PRF_UNRESOLVED_CLARIFICATION",
    ),
  );
  // Candidate evaluation was skipped, so eligibility reminders must not appear.
  assert.equal(
    report.diagnostics.some((entry) => entry.stage === "eligibility"),
    false,
  );
  const clarification = report.diagnostics.find(
    (entry) => entry.code === "PRF_UNRESOLVED_CLARIFICATION",
  )!;
  assert.equal(clarification.remedy, "user");
  assert.equal(clarification.retryable, true);
  assert.equal(
    clarification.participant,
    input.preferences[0]!.participant.toLowerCase(),
  );
});

test("an unsupported requirement is distinguished from an open clarification", () => {
  const input = baseline();
  input.preferences[2]!.extraction.unsupportedRequirements = ["Peanut allergy"];
  const list = analyzeEvaluation(evaluateDecision(input), input);
  const unsupported = list.find(
    (entry) => entry.code === "PRF_UNSUPPORTED_REQUIREMENT",
  );
  assert.ok(unsupported);
  assert.equal(unsupported!.severity, "error");
  assert.equal(
    unsupported!.field,
    null,
    "the raw requirement text is never echoed",
  );
});

test("an unconfirmed revision is reported per participant with attribution", () => {
  const input = baseline();
  input.preferences[3]!.confirmedRevisionId = "older";
  const report = evaluationReport(evaluateDecision(input), input);
  assert.equal(report.status, "AWAITING_CONFIRMATION");
  const entry = report.diagnostics.find(
    (each) => each.code === "PRF_AWAITING_CONFIRMATION",
  )!;
  assert.equal(
    entry.participant,
    input.preferences[3]!.participant.toLowerCase(),
  );
  assert.equal(entry.revisionId, input.preferences[3]!.revisionId);
  // Exactly one member is at fault, so exactly one reminder is emitted.
  assert.equal(
    report.diagnostics.filter(
      (each) => each.code === "PRF_AWAITING_CONFIRMATION",
    ).length,
    1,
  );
});

test("zero soft weights are reported as a note, never as a blocker", () => {
  const input = baseline();
  for (const revision of input.preferences)
    for (const constraint of revision.extraction.constraints)
      if (constraint.type === "soft") constraint.weight = 0;
  const report = evaluationReport(evaluateDecision(input), input);
  const entry = report.diagnostics.find(
    (each) => each.code === "PRF_ZERO_WEIGHT_TOTAL",
  );
  assert.ok(entry);
  assert.equal(entry!.severity, "info");
  assert.equal(entry!.remedy, "none");
  assert.equal(report.summary.blocking, false);
});

test("a tie and a tie-break win are both surfaced as informational reminders", () => {
  const input = baseline();
  // Give A and B identical satisfaction across every weighted dimension.
  const a = input.catalog.restaurants.find(
    (candidate) => candidate.id === "A",
  )!;
  const b = input.catalog.restaurants.find(
    (candidate) => candidate.id === "B",
  )!;
  b.quiet = a.quiet;
  b.atmosphere = a.atmosphere;
  b.subwayDistanceMeters = a.subwayDistanceMeters;
  const list = analyzeEvaluation(evaluateDecision(input), input);
  assert.ok(list.some((entry) => entry.code === "DEC_SCORE_TIE"));
  const tieBreak = list.find(
    (entry) => entry.code === "DEC_WINNER_BY_TIEBREAK",
  );
  assert.ok(
    tieBreak,
    "the group must be told the winner was not a clear winner",
  );
  assert.equal(tieBreak!.severity, "info");
  assert.equal(tieBreak!.retryable, false);
});

test("a narrow margin is reported while an overwhelming winner is not", () => {
  const close = baseline();
  const a = close.catalog.restaurants.find(
    (candidate) => candidate.id === "A",
  )!;
  const b = close.catalog.restaurants.find(
    (candidate) => candidate.id === "B",
  )!;
  // Equalize every dimension except one, leaving a margin far below one percent.
  b.quiet = a.quiet;
  b.subwayDistanceMeters = a.subwayDistanceMeters;
  b.atmosphere = a.atmosphere - 1;
  assert.ok(
    analyzeEvaluation(evaluateDecision(close), close).some(
      (entry) => entry.code === "DEC_NARROW_MARGIN",
    ),
    "a near-tie must be disclosed",
  );

  const wide = baseline();
  assert.equal(
    analyzeEvaluation(evaluateDecision(wide), wide).some(
      (entry) => entry.code === "DEC_NARROW_MARGIN",
    ),
    false,
  );
});

test("the same condition always classifies identically regardless of candidate order", () => {
  const input = baseline();
  const first = analyzeEvaluation(evaluateDecision(input), input);
  input.catalog.restaurants.reverse();
  const second = analyzeEvaluation(evaluateDecision(input), input);
  assert.deepEqual(
    first.map((entry) => `${entry.code}:${entry.severity}:${entry.stage}`),
    second.map((entry) => `${entry.code}:${entry.severity}:${entry.stage}`),
  );
});

test("diagnostics are deterministic: identical input yields identical output", () => {
  const input = baseline(2500);
  const once = JSON.stringify(
    analyzeEvaluation(evaluateDecision(input), input),
  );
  const twice = JSON.stringify(
    analyzeEvaluation(evaluateDecision(input), input),
  );
  assert.equal(once, twice);
});

test("severe reminders sort before informational ones", () => {
  const input = baseline(2300);
  const list = analyzeEvaluation(evaluateDecision(input), input);
  const rank: Record<string, number> = { error: 0, warning: 1, info: 2 };
  for (let index = 1; index < list.length; index += 1)
    assert.ok(
      rank[list[index - 1]!.severity]! <= rank[list[index]!.severity]!,
      "severity order must be descending",
    );
});

test("the shareable projection drops attribution, field names, and private codes", () => {
  const input = baseline();
  input.preferences[0]!.extraction.clarifications = ["Which date exactly?"];
  const internal = analyzeEvaluation(evaluateDecision(input), input);
  assert.ok(internal.some((entry) => entry.participant !== null));
  const published = publicDiagnostics(internal);
  assert.ok(
    published.length > 0,
    "the projection must not silently drop everything",
  );

  // Assert on the projected shape rather than on substrings of the serialized
  // output: a guidance string is free to contain the word "field" without that
  // being a leak, and key-name checks catch real regressions precisely.
  const allowed = new Set([
    "code",
    "severity",
    "stage",
    "retryable",
    "title",
    "guidance",
  ]);
  for (const entry of published) {
    const keys = Object.keys(entry);
    for (const key of keys)
      assert.ok(allowed.has(key), `projected entry leaked key ${key}`);
    assert.equal(
      Object.hasOwn(entry, "participant") ||
        Object.hasOwn(entry, "revisionId") ||
        Object.hasOwn(entry, "field") ||
        Object.hasOwn(entry, "detail"),
      false,
      "attribution keys must not survive the projection",
    );
  }
  const text = JSON.stringify(published);
  for (const revision of input.preferences) {
    assert.equal(text.includes(revision.participant.toLowerCase()), false);
    assert.equal(text.includes(revision.participant), false);
    assert.equal(text.includes(revision.revisionId), false);
  }
  assert.equal(text.includes("Which date exactly?"), false);
});

test("a private code is replaced by a stage-level stand-in when shared", () => {
  const input = baseline();
  input.preferences[0]!.extraction.clarifications = ["Which date exactly?"];
  const internal = analyzeEvaluation(evaluateDecision(input), input);
  const published = publicDiagnostics(internal);
  // PRF_UNRESOLVED_CLARIFICATION is not shareable, so the group sees a generic
  // preference-stage reminder instead of the exact condition.
  assert.equal(
    published.some((entry) => entry.code === "PRF_UNRESOLVED_CLARIFICATION"),
    false,
  );
  assert.ok(published.some((entry) => entry.stage === "preference"));
});

test("a shareable code survives the projection unchanged", () => {
  const input = baseline();
  input.permittedMerchants = [];
  const internal = analyzeEvaluation(evaluateDecision(input), input);
  const published = publicDiagnostics(internal);
  const merchant = published.find(
    (entry) => entry.code === "DEC_MERCHANT_NOT_PERMITTED",
  );
  assert.ok(merchant, "group-level conditions stay identifiable");
  assert.equal(merchant!.severity, "warning");
  assert.equal(merchant!.title.length > 0, true);
});

test("the shared projection never exposes more than one reminder per code", () => {
  const input = baseline();
  // Two different members hit different constraints on the same candidate set.
  input.preferences[0]!.extraction.constraints.push({
    type: "hard",
    field: "subway_distance_meters",
    operator: "lte",
    value: 10,
  });
  input.preferences[1]!.extraction.constraints.push({
    type: "hard",
    field: "subway_distance_meters",
    operator: "lte",
    value: 20,
  });
  const internal = analyzeEvaluation(evaluateDecision(input), input);
  const published = publicDiagnostics(internal);
  const keys = published.map((entry) => entry.code);
  assert.equal(
    new Set(keys).size,
    keys.length,
    "codes are deduplicated after projection",
  );
});

test("every emitted code is registered and its summary counts agree", () => {
  const inputs = [baseline(), baseline(2300), baseline(2500)];
  const broken = baseline();
  for (const candidate of broken.catalog.restaurants)
    candidate.available = false;
  inputs.push(broken);

  for (const input of inputs) {
    const list = analyzeEvaluation(evaluateDecision(input), input);
    const summary = summarizeDiagnostics(list);
    const counted =
      summary.bySeverity.error +
      summary.bySeverity.warning +
      summary.bySeverity.info;
    assert.equal(
      counted,
      list.length,
      "severity counts must cover every reminder",
    );
    assert.equal(
      Object.values(summary.byStage).reduce(
        (sum, value) => sum + (value ?? 0),
        0,
      ),
      list.length,
      "stage counts must cover every reminder",
    );
    const expectedWorst = list.some((entry) => entry.severity === "error")
      ? "error"
      : list.some((entry) => entry.severity === "warning")
        ? "warning"
        : list.length
          ? "info"
          : null;
    assert.equal(summary.worst, expectedWorst);
    assert.equal(
      summary.blocking,
      list.some((entry) => entry.severity === "error"),
    );
  }
});

test("the report wrapper agrees with the raw analyzer", () => {
  const input = baseline(2500);
  const result = evaluateDecision(input);
  const report = evaluationReport(result, input);
  assert.equal(report.status, result.status);
  assert.deepEqual(
    report.diagnostics.map((entry) => entry.code),
    analyzeEvaluation(result, input).map((entry) => entry.code),
  );
});

test("reminder codes are a stable public contract", () => {
  const input = baseline();
  input.permittedMerchants = [];
  const list = analyzeEvaluation(evaluateDecision(input), input);
  const expected: DiagnosticCode[] = [
    ...list.map((entry) => entry.code),
  ].sort();
  // Snapshot the set so a rename is caught rather than silently shipped.
  //
  // Forbidding every merchant excludes all candidates on three separate
  // grounds at once, and the analyzer names each: the allowance itself
  // (DEC_MERCHANT_NOT_PERMITTED), candidate E being unavailable
  // (DEC_CANDIDATE_UNAVAILABLE), no candidate surviving the joint constraint set
  // (DEC_NO_ELIGIBLE_CANDIDATE), and the group-level conflict where every
  // participant rejects something (DEC_PARTICIPANT_ONESIDED).
  assert.deepEqual(expected, [
    "DEC_CANDIDATE_UNAVAILABLE",
    "DEC_MERCHANT_NOT_PERMITTED",
    "DEC_NO_ELIGIBLE_CANDIDATE",
    "DEC_PARTICIPANT_ONESIDED",
  ]);
});
