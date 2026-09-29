import {
  DIAGNOSTIC_CODES,
  type DiagnosticCode,
  type DiagnosticSpec,
  type DiagnosticSeverity,
} from "./codes.js";

export type { DiagnosticSeverity } from "./codes.js";
export type Diagnostic = DiagnosticSpec & {
  code: DiagnosticCode;
  participant: string | null;
  revisionId: string | null;
  field: string | null;
};
export type PublicDiagnostic = Pick<
  Diagnostic,
  "code" | "severity" | "stage" | "retryable" | "remedy" | "title" | "guidance"
>;
export type DiagnosticSummary = {
  worst: DiagnosticSeverity | null;
  blocking: boolean;
  bySeverity: Record<DiagnosticSeverity, number>;
};
export type DiagnosticPayload = {
  diagnostics: PublicDiagnostic[];
  summary: DiagnosticSummary;
};

export function diagnostic(
  code: DiagnosticCode,
  attribution: Partial<
    Pick<Diagnostic, "participant" | "revisionId" | "field">
  > = {},
): Diagnostic {
  return {
    ...attribution,
    participant: attribution.participant ?? null,
    revisionId: attribution.revisionId ?? null,
    field: attribution.field ?? null,
    ...DIAGNOSTIC_CODES[code],
    code,
  };
}

const severityRank = { error: 2, warning: 1, info: 0 };

// Project before deduplicating AND summarizing. Even the number or severity of
// private conditions must not leak through aggregate counts (PR #6 refinement).
export function publicDiagnostics(list: Diagnostic[]): PublicDiagnostic[] {
  const unique = new Map<DiagnosticCode, PublicDiagnostic>();
  for (const entry of list) {
    const code = DIAGNOSTIC_CODES[entry.code].shareable
      ? entry.code
      : "SHR_PREFERENCE_UNRESOLVED";
    const { severity, stage, retryable, remedy, title, guidance } =
      DIAGNOSTIC_CODES[code];
    unique.set(code, {
      code,
      severity,
      stage,
      retryable,
      remedy,
      title,
      guidance,
    });
  }
  return [...unique.values()].sort(
    (a, b) =>
      severityRank[b.severity] - severityRank[a.severity] ||
      a.code.localeCompare(b.code),
  );
}

export function publicDiagnosticPayload(list: Diagnostic[]): DiagnosticPayload {
  const diagnostics = publicDiagnostics(list);
  const bySeverity = { info: 0, warning: 0, error: 0 };
  for (const entry of diagnostics) bySeverity[entry.severity]++;
  return {
    diagnostics,
    summary: {
      worst: diagnostics[0]?.severity ?? null,
      blocking: bySeverity.error > 0,
      bySeverity,
    },
  };
}
