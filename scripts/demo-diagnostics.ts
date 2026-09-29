import { writeFile } from "node:fs/promises";
import { getAddress } from "viem";
import { evaluateDecision } from "../src/lib/decision-engine.js";
import {
  analyzeEvaluation,
  evaluationReport,
  publicDiagnostics,
  summarizeDiagnostics,
} from "../src/lib/diagnostics/index.js";
import {
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_STAGES,
} from "../src/lib/diagnostics/codes.js";
import type { DiagnosticSeverity } from "../src/lib/diagnostics/index.js";
import { demoRolesSchema } from "../src/lib/demo-roles.js";
import { createRestaurantCatalog } from "../src/lib/fixtures/restaurants.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";
import type { EvaluationInput } from "../src/lib/schemas/decision.js";

// Credential-free diagnostics evidence. Mirrors `scripts/demo-decision.ts`: it
// exercises the pure functions only, so it can run in CI without a database, an
// RPC endpoint, or a provider key. It is NOT acceptance evidence for the
// decision application or the contract; see docs/DIAGNOSTICS.md.

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

type Scenario = {
  name: string;
  expectation: string;
  build: () => EvaluationInput;
};

const scenarios: Scenario[] = [
  {
    name: "baseline_clean_proposal",
    expectation:
      "A clean proposal reports no blocking reminder and no error severity.",
    build: () => baseline(),
  },
  {
    name: "lower_budget_no_match",
    expectation: "A budget that excludes every candidate names the blocker.",
    build: () => baseline(2300),
  },
  {
    name: "excluded_merchant",
    expectation:
      "An empty allowlist is reported at the merchant, not generically.",
    build: () => {
      const input = baseline();
      input.permittedMerchants = [];
      return input;
    },
  },
  {
    name: "unaffordable_deposit",
    expectation: "A deposit cap below every deposit is called out separately.",
    build: () => {
      const input = baseline();
      input.maxDeposit = "35000000";
      input.maxTotalSpend = "35000000";
      return input;
    },
  },
  {
    name: "missing_safety_metadata",
    expectation:
      "Unsupported non-negotiable metadata is reported as a catalog gap, not a user error.",
    build: () => {
      const input = baseline();
      for (const candidate of input.catalog.restaurants)
        candidate.wheelchairAccessible = "unknown";
      input.preferences[0]!.extraction.constraints.push({
        type: "non_negotiable",
        field: "wheelchair_accessible",
        value: true,
      });
      return input;
    },
  },
  {
    name: "open_clarification",
    expectation:
      "An open clarification blocks evaluation and suppresses eligibility noise.",
    build: () => {
      const input = baseline();
      input.preferences[0]!.extraction.clarifications = ["Which date exactly?"];
      return input;
    },
  },
  {
    name: "unconfirmed_revision",
    expectation: "A single unconfirmed member is attributed and reported once.",
    build: () => {
      const input = baseline();
      input.preferences[3]!.confirmedRevisionId = "older";
      return input;
    },
  },
  {
    name: "zero_soft_weights",
    expectation:
      "Zero soft weights are an informational note, never a blocker.",
    build: () => {
      const input = baseline();
      for (const revision of input.preferences)
        for (const constraint of revision.extraction.constraints)
          if (constraint.type === "soft") constraint.weight = 0;
      return input;
    },
  },
  {
    name: "narrow_margin",
    expectation: "A near-tie between the top two candidates is disclosed.",
    build: () => {
      const input = baseline();
      const a = input.catalog.restaurants.find((c) => c.id === "A")!;
      const b = input.catalog.restaurants.find((c) => c.id === "B")!;
      b.quiet = a.quiet;
      b.subwayDistanceMeters = a.subwayDistanceMeters;
      b.atmosphere = a.atmosphere - 1;
      return input;
    },
  },
  {
    name: "identical_scores",
    expectation: "Identical scores produce a tie and a tie-break reminder.",
    build: () => {
      const input = baseline();
      const a = input.catalog.restaurants.find((c) => c.id === "A")!;
      const b = input.catalog.restaurants.find((c) => c.id === "B")!;
      b.quiet = a.quiet;
      b.atmosphere = a.atmosphere;
      b.subwayDistanceMeters = a.subwayDistanceMeters;
      return input;
    },
  },
  {
    name: "all_unavailable",
    expectation: "A fully unavailable catalog reports the exclusion counts.",
    build: () => {
      const input = baseline();
      for (const candidate of input.catalog.restaurants)
        candidate.available = false;
      return input;
    },
  },
];

const results = scenarios.map((scenario) => {
  const input = scenario.build();
  const evaluation = evaluateDecision(input);
  const report = evaluationReport(evaluation, input);
  const internal = analyzeEvaluation(evaluation, input);
  return {
    name: scenario.name,
    expectation: scenario.expectation,
    synthetic: true,
    engineVersion: evaluation.engineVersion,
    fixtureVersion: evaluation.fixtureVersion,
    status: evaluation.status,
    winnerId: evaluation.winnerId,
    ranking: evaluation.ranking,
    summary: report.summary,
    // Internal form retains attribution so an operator can reproduce a report.
    internal: internal.map((entry) => ({
      code: entry.code,
      severity: entry.severity,
      stage: entry.stage,
      retryable: entry.retryable,
      remedy: entry.remedy,
      attributed: entry.participant !== null,
      field: entry.field,
      detail: entry.detail,
    })),
    // Shareable form is what a group member or the client would receive.
    shared: publicDiagnostics(internal),
  };
});

// Independence check: no internal code may leak into the shared projection when
// the registry marks it non-shareable.
const leaks: string[] = [];
for (const result of results)
  for (const entry of result.shared) {
    const spec = DIAGNOSTIC_CODES[entry.code as keyof typeof DIAGNOSTIC_CODES];
    if (spec && !spec.shareable) leaks.push(`${result.name}:${entry.code}`);
  }

const severityTotals: Record<DiagnosticSeverity, number> = {
  info: 0,
  warning: 0,
  error: 0,
};
for (const result of results)
  for (const entry of result.internal) severityTotals[entry.severity] += 1;

const stages = results.flatMap((result) =>
  result.internal.map((entry) => entry.stage),
);
const observedStages = DIAGNOSTIC_STAGES.filter((stage) =>
  stages.includes(stage),
);
const emittedCodes = new Set(
  results.flatMap((result) => result.internal.map((entry) => entry.code)),
);

const record = {
  purpose:
    "Credential-free diagnostics evidence. Synthetic inputs, no database, no RPC, no provider key.",
  generator: "scripts/demo-diagnostics.ts",
  synthetic: true,
  note: "The reservation timestamp in this record is explicitly synthetic, not a real booking or policy expiry. This record does not establish application or contract acceptance; see docs/DIAGNOSTICS.md.",
  registry: {
    codeCount: Object.keys(DIAGNOSTIC_CODES).length,
    stageCount: DIAGNOSTIC_STAGES.length,
    observedStageCount: observedStages.length,
  },
  coverage: {
    emittedCodeCount: emittedCodes.size,
    severityTotals,
    scenarios: results.length,
  },
  privacy: {
    checked: "no non-shareable code appears in a shared projection",
    leaks,
  },
  scenarios: results,
};

const output = new URL(
  "../docs/evidence/diagnostics-fixtures.json",
  import.meta.url,
);
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, "utf8");

const blocking = results.filter((result) => result.summary.blocking).length;
process.stdout.write(
  [
    `scenarios: ${results.length}`,
    `registered codes: ${record.registry.codeCount}`,
    `codes observed: ${record.coverage.emittedCodeCount}`,
    `stages observed: ${observedStages.length}/${DIAGNOSTIC_STAGES.length}`,
    `blocking scenarios: ${blocking}`,
    `privacy leaks: ${leaks.length}`,
    `wrote ${output.pathname}`,
  ].join("\n") + "\n",
);

if (leaks.length) process.exitCode = 1;
