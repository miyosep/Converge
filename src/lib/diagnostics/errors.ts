import type { DiagnosticCode } from "./codes.js";
import { diagnostic, publicDiagnosticPayload } from "./types.js";

const ERROR_CODES: Record<string, DiagnosticCode> = {
  AUTH_REQUIRED: "INF_SESSION_EXPIRED",
  INVALID_SIGNATURE: "INF_SESSION_EXPIRED",
  INVALID_CHALLENGE: "INF_SESSION_EXPIRED",
  INVALID_SESSION: "INF_SESSION_EXPIRED",
  NOT_MEMBER: "GROUP_ACCESS_REQUIRED",
  GROUP_NOT_FOUND: "GROUP_ACCESS_REQUIRED",
  NOT_CREATOR: "GROUP_ORGANIZER_REQUIRED",
  INVALID_INVITE: "GROUP_INVITE_UNAVAILABLE",
  GROUP_FULL: "GROUP_INVITE_UNAVAILABLE",
  GROUP_LOCKED: "GROUP_LOCKED",
  PREFERENCES_LOCKED: "GROUP_LOCKED",
  STALE_REVISION: "PRF_STALE_REVISION",
  INVALID_TRANSITION: "PRF_STALE_REVISION",
  UNRESOLVED_REQUIREMENTS: "PRF_UNRESOLVED_CLARIFICATION",
  INCOMPLETE_GROUP: "GROUP_INCOMPLETE",
  EXTRACTION_FAILED: "INF_KILN_UNAVAILABLE",
  CHAIN_UNAVAILABLE: "INF_CHAIN_UNAVAILABLE",
  CHAIN_VERIFICATION_FAILED: "INF_CHAIN_UNAVAILABLE",
  PAYMENT_NOT_CONFIGURED: "INF_NOT_CONFIGURED",
  KILN_NOT_CONFIGURED: "INF_NOT_CONFIGURED",
  NO_POLICY: "PLN_POLICY_PENDING",
  RESERVATION_PASSED: "DEC_RESERVATION_PASSED",
};

export function errorDiagnostics(code: string) {
  return publicDiagnosticPayload([
    diagnostic(ERROR_CODES[code] ?? "INF_REQUEST_FAILED"),
  ]);
}

// Shared by older clients that only read the stable `error` field.
export function diagnosticMessage(code: string): string | null {
  const mapped = ERROR_CODES[code];
  if (!mapped) return null;
  const entry = errorDiagnostics(code).diagnostics[0]!;
  return `${entry.title}. ${entry.guidance}`;
}
