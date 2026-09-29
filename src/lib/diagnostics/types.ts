import { z } from "zod";
import { addressSchema, idSchema } from "../schemas/primitives.js";
import {
  DIAGNOSTIC_SEVERITIES,
  DIAGNOSTIC_STAGES,
  DIAGNOSTIC_CODES,
  diagnosticSpec,
  isDiagnosticCode,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type DiagnosticStage,
} from "./codes.js";

export const diagnosticSeverityRank: Record<DiagnosticSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

// Internal diagnostics carry participant-level attribution so an operator can
// reproduce a failure. They must never be returned to the group: see
// `publicDiagnostic` and `publicDiagnostics` for the shareable projection.
export const diagnosticSchema = z.strictObject({
  code: z
    .string()
    .refine(isDiagnosticCode, "Unknown diagnostic code")
    .transform((value) => value as DiagnosticCode),
  severity: z.enum(DIAGNOSTIC_SEVERITIES),
  stage: z.enum(DIAGNOSTIC_STAGES),
  retryable: z.boolean(),
  // Who can act on this. Derived from the code registry, never caller-supplied.
  remedy: z.enum(["user", "group", "operator", "none"]),
  title: z.string().min(1).max(200),
  guidance: z.string().min(1).max(500),
  participant: addressSchema.nullable(),
  revisionId: idSchema.nullable(),
  field: z.string().min(1).max(64).nullable(),
  // Bounded, non-sensitive values for operator tooling. Never put raw
  // preference text, clarification strings, or token amounts here.
  detail: z.record(z.string().min(1).max(64), z.string().max(200)).nullable(),
});

export type Diagnostic = z.infer<typeof diagnosticSchema>;

export type DiagnosticInput = {
  code: DiagnosticCode;
  participant?: string | null;
  revisionId?: string | null;
  field?: string | null;
  detail?: Record<string, string> | null;
};

// The registry is the single source of truth for severity, stage, retryability,
// and remedy. Callers choose only the code plus attribution, which keeps the
// same condition classified identically everywhere it is reported.
export function diagnostic(input: DiagnosticInput): Diagnostic {
  const spec = diagnosticSpec(input.code);
  return diagnosticSchema.parse({
    code: input.code,
    severity: spec.severity,
    stage: spec.stage,
    retryable: spec.retryable,
    remedy: spec.remedy,
    title: spec.title,
    guidance: spec.guidance,
    participant: input.participant ?? null,
    revisionId: input.revisionId ?? null,
    field: input.field ?? null,
    detail: input.detail ?? null,
  });
}

export function diagnostics(inputs: DiagnosticInput[]): Diagnostic[] {
  return inputs.map(diagnostic);
}

function bySeverityThenStage(a: Diagnostic, b: Diagnostic): number {
  return (
    diagnosticSeverityRank[b.severity] - diagnosticSeverityRank[a.severity] ||
    DIAGNOSTIC_STAGES.indexOf(a.stage) - DIAGNOSTIC_STAGES.indexOf(b.stage) ||
    (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
  );
}

// Highest severity first, then lifecycle order, then code. Deterministic so
// evidence files and snapshots do not churn.
export function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  return [...list].sort(bySeverityThenStage);
}

export function dedupeDiagnostics(list: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const output: Diagnostic[] = [];
  for (const entry of list) {
    const key = [entry.code, entry.participant ?? "", entry.field ?? ""].join(
      "|",
    );
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

export function worstSeverity(list: Diagnostic[]): DiagnosticSeverity | null {
  let worst: DiagnosticSeverity | null = null;
  for (const entry of list)
    if (
      worst === null ||
      diagnosticSeverityRank[entry.severity] > diagnosticSeverityRank[worst]
    )
      worst = entry.severity;
  return worst;
}

export function hasBlockingDiagnostic(list: Diagnostic[]): boolean {
  return list.some((entry) => entry.severity === "error");
}

// Shareable projection: code, severity, stage, retryable, title, guidance.
// Attribution, field names, and detail values are dropped, and codes the
// registry marks non-shareable are replaced with a stage-level stand-in so that
// merely observing which error occurred cannot leak a participant's preference.
//
// The stand-ins are a dedicated `SHR_` family, deliberately NOT reused condition
// codes. Substituting a real code (for example PRF_AWAITING_CONFIRMATION for an
// unresolved clarification) would both disclose which condition occurred and
// assert something untrue, because no confirmation was ever outstanding.
export const SHARED_FALLBACK_CODES: Record<DiagnosticStage, DiagnosticCode> = {
  input: "SHR_INPUT_UNAVAILABLE",
  preference: "SHR_PREFERENCE_UNRESOLVED",
  eligibility: "SHR_ELIGIBILITY_BLOCKED",
  ranking: "SHR_RANKING_INCONCLUSIVE",
  approval: "SHR_APPROVAL_INCOMPLETE",
  funding: "SHR_FUNDING_INCOMPLETE",
  execution: "SHR_EXECUTION_FAILED",
  settlement: "SHR_SETTLEMENT_ISSUE",
  infrastructure: "SHR_INFRASTRUCTURE_ISSUE",
};

export function publicDiagnostic(entry: Diagnostic) {
  const spec = DIAGNOSTIC_CODES[entry.code];
  if (spec.shareable)
    return {
      code: entry.code,
      severity: entry.severity,
      stage: entry.stage,
      retryable: entry.retryable,
      title: entry.title,
      guidance: entry.guidance,
    };
  const fallback = diagnosticSpec(SHARED_FALLBACK_CODES[entry.stage]);
  return {
    code: SHARED_FALLBACK_CODES[entry.stage],
    severity: fallback.severity,
    stage: entry.stage,
    retryable: fallback.retryable,
    title: fallback.title,
    guidance: fallback.guidance,
  };
}

export function publicDiagnostics(list: Diagnostic[]) {
  // Two private codes in the same stage collapse to the same stand-in, so
  // collapse duplicates after projecting rather than before.
  const seen = new Set<string>();
  const output: ReturnType<typeof publicDiagnostic>[] = [];
  for (const entry of sortDiagnostics(list)) {
    const projected = publicDiagnostic(entry);
    if (seen.has(projected.code)) continue;
    seen.add(projected.code);
    output.push(projected);
  }
  return output;
}

export type DiagnosticSummary = {
  worst: DiagnosticSeverity | null;
  blocking: boolean;
  bySeverity: Record<DiagnosticSeverity, number>;
  byStage: Partial<Record<DiagnosticStage, number>>;
};

export function summarizeDiagnostics(list: Diagnostic[]): DiagnosticSummary {
  const bySeverity: Record<DiagnosticSeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
  };
  const byStage: Partial<Record<DiagnosticStage, number>> = {};
  for (const entry of list) {
    bySeverity[entry.severity] += 1;
    byStage[entry.stage] = (byStage[entry.stage] ?? 0) + 1;
  }
  return {
    worst: worstSeverity(list),
    blocking: hasBlockingDiagnostic(list),
    bySeverity,
    byStage,
  };
}
