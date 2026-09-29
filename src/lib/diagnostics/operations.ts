import {
  diagnostic,
  sortDiagnostics,
  type Diagnostic,
  type DiagnosticInput,
} from "./types.js";
import type { DiagnosticCode } from "./codes.js";

export {
  PAYMENT_REJECT_REASONS,
  POLICY_ERRORS,
  diagnoseRejectReason,
  diagnoseChainError,
} from "./chain.js";
export type {
  ChainDiagnosticContext,
  PaymentRejectReason,
  PolicyErrorName,
} from "./chain.js";

// Every error string that can surface from the application layers, mapped to a
// diagnostic. This is the bridge that lets the API return actionable reminders
// instead of opaque codes.
//
// Covered sources:
//   WalletAuthError        src/lib/db/wallet-auth.ts
//   PreferenceRepositoryError / PreferenceError   src/lib/db/preferences.ts, src/lib/preferences.ts
//   ApiError               src/lib/server/api.ts
//   Kiln client            src/lib/kiln/client.ts
export const CONTRACT_ERROR_DIAGNOSTICS: Record<string, DiagnosticCode> = {
  // --- authentication and membership ---
  AUTH_REQUIRED: "INF_SESSION_EXPIRED",
  INVALID_SIGNATURE: "INF_SESSION_EXPIRED",
  INVALID_CHALLENGE: "INF_SESSION_EXPIRED",
  INVALID_INVITE: "PRF_STALE_REVISION",
  NOT_CREATOR: "DEC_MEMBER_SET_MISMATCH",
  NOT_MEMBER: "DEC_MEMBER_SET_MISMATCH",
  INVITE_EXHAUSTED: "DEC_MEMBER_SET_MISMATCH",
  GROUP_FULL: "DEC_MEMBER_SET_MISMATCH",
  ALREADY_MEMBER: "DEC_MEMBER_SET_MISMATCH",

  // --- preference lifecycle ---
  ACCESS_DENIED: "PRF_STALE_REVISION",
  PREFERENCES_LOCKED: "PRF_STALE_REVISION",
  STALE_REVISION: "PRF_STALE_REVISION",
  INVALID_TRANSITION: "PRF_STALE_REVISION",
  UNRESOLVED_REQUIREMENTS: "PRF_UNRESOLVED_REQUIREMENT_ALIAS",
  EXTRACTION_FAILED: "INF_KILN_UNAVAILABLE",

  // --- request-level ---
  INVALID_ORIGIN: "INF_RECONCILIATION_REQUIRED",
  JSON_REQUIRED: "DEC_INPUT_INVALID",
  INVALID_INPUT: "DEC_INPUT_INVALID",
  INTERNAL_ERROR: "INF_RECONCILIATION_REQUIRED",
  NOT_FOUND: "CHN_NOT_ACTIVE",
  RATE_LIMITED: "INF_RATE_LIMITED",

  // --- provider ---
  PROVIDER_ERROR: "INF_KILN_UNAVAILABLE",
  PROVIDER_TIMEOUT: "INF_KILN_TIMEOUT",
  USAGE_UNAVAILABLE: "INF_KILN_USAGE_UNKNOWN",
  VALIDATION_ERROR: "PRF_UNSUPPORTED_REQUIREMENT",
  SCHEMA_MISMATCH: "INF_KILN_UNAVAILABLE",

  // --- chain and persistence ---
  RPC_UNAVAILABLE: "INF_RPC_FAILURE",
  TX_REVERTED: "CHN_TX_REVERTED",
  DB_WRITE_FAILED: "INF_DB_WRITE_FAILED",
  DUPLICATE_EVENT: "INF_EVENT_REPLAY_DUPLICATE",
  RECONCILIATION_REQUIRED: "INF_RECONCILIATION_REQUIRED",
  AMOUNT_MISMATCH: "FUND_TRANSFER_AMOUNT_MISMATCH",
  ALLOWANCE_INSUFFICIENT: "FUND_ALLOWANCE_INSUFFICIENT",
  BALANCE_INSUFFICIENT: "FUND_BALANCE_INSUFFICIENT",
  ALREADY_APPROVED: "FUND_DUPLICATE_APPROVAL",
  REFUND_ALREADY_CLAIMED: "SET_REFUND_ALREADY_CLAIMED",
  NO_CONTRIBUTION: "SET_NO_CONTRIBUTION",
  REFUND_NOT_AVAILABLE: "SET_REFUND_NOT_AVAILABLE",
};

// `UNRESOLVED_REQUIREMENTS` from PreferenceError means a clarification or an
// unsupported requirement is outstanding; the two cases share a code path, so
// resolve to the clarification reminder and let the caller refine it.
const ALIASES: Record<string, DiagnosticCode> = {
  PRF_UNRESOLVED_REQUIREMENT_ALIAS: "PRF_UNRESOLVED_CLARIFICATION",
};

export function diagnoseErrorCode(code: string): Diagnostic | null {
  const mapped = CONTRACT_ERROR_DIAGNOSTICS[code];
  if (!mapped) return null;
  const resolved = ALIASES[mapped] ?? mapped;
  return diagnostic({ code: resolved, detail: { source: code } });
}

export type LifecycleContext = {
  status:
    | "COLLECTING_PREFERENCES"
    | "PARSING_CONSTRAINTS"
    | "AWAITING_CONFIRMATION"
    | "EVALUATING"
    | "PROPOSAL_READY"
    | "AWAITING_APPROVAL"
    | "AUTHORIZED"
    | "EXECUTING"
    | "COMPLETED"
    | "NO_MATCH"
    | "NEEDS_CLARIFICATION"
    | "RETRYABLE_ERROR"
    | "CANCELLED"
    | "EXPIRED";
  // Counts are supplied by the caller from persisted rows; this function does no
  // I/O so it stays usable in tests and in the evidence runner.
  submittedCount: number;
  confirmedCount: number;
  approvalCount: number;
  memberCount: number;
  // Seconds until policy expiry. Negative means already expired.
  secondsToExpiry: number | null;
  // Set when the chain has completed but persistence has not caught up.
  chainCompleted?: boolean;
  persistenceBehind?: boolean;
};

// A reminder is only useful when it tells the group what to do next. This maps
// the workflow status plus observed counts onto the conditions that actually
// block progress, rather than restating the status.
export function diagnoseLifecycle(context: LifecycleContext): Diagnostic[] {
  const output: DiagnosticInput[] = [];
  const missing = context.memberCount - context.confirmedCount;
  const missingApprovals = context.memberCount - context.approvalCount;

  if (context.persistenceBehind || context.chainCompleted)
    output.push({ code: "INF_RECONCILIATION_REQUIRED" });

  switch (context.status) {
    case "COLLECTING_PREFERENCES":
      if (missing > 0)
        output.push({
          code: "PRF_AWAITING_CONFIRMATION",
          detail: {
            submitted: String(context.submittedCount),
            confirmed: String(context.confirmedCount),
            memberCount: String(context.memberCount),
          },
        });
      break;
    case "PARSING_CONSTRAINTS":
      // Parsing in progress is a normal transient state, not a provider
      // outage. Reporting INF_KILN_UNAVAILABLE here would tell the group the
      // interpreter is down when nothing has failed at all.
      break;
    case "AWAITING_CONFIRMATION":
      if (missing > 0)
        output.push({
          code: "PRF_AWAITING_CONFIRMATION",
          detail: { missing: String(missing) },
        });
      break;
    case "NEEDS_CLARIFICATION":
      output.push({ code: "PRF_UNRESOLVED_CLARIFICATION" });
      break;
    case "NO_MATCH":
      output.push({ code: "DEC_NO_ELIGIBLE_CANDIDATE" });
      break;
    case "PROPOSAL_READY":
      output.push({ code: "DEC_SCORE_TIE" });
      break;
    case "AWAITING_APPROVAL":
      if (missingApprovals > 0)
        output.push({
          code: "PLN_AWAITING_APPROVAL",
          detail: {
            approvalCount: String(context.approvalCount),
            memberCount: String(context.memberCount),
          },
        });
      // The wallet activates only on the sixth valid contribution, and a
      // contribution does not count until its member approves. So funding is
      // incomplete whenever approvals are short, not only when confirmations
      // are. Reporting this only on the confirmation gap would let a group with
      // 3 of 6 approvals believe funding is settled.
      if (missing > 0 || missingApprovals > 0)
        output.push({
          code: "FUND_PARTIAL_FUNDING",
          detail: {
            missing: String(Math.max(missing, missingApprovals)),
          },
        });
      break;
    case "AUTHORIZED":
    case "EXECUTING":
      if (context.approvalCount < context.memberCount)
        output.push({ code: "CHN_INSUFFICIENT_APPROVALS" });
      break;
    case "RETRYABLE_ERROR":
      output.push({ code: "INF_RECONCILIATION_REQUIRED" });
      break;
    case "COMPLETED":
      output.push({ code: "SET_REMAINDER_DUST" });
      break;
    case "CANCELLED":
      output.push({ code: "FUND_CANCEL_VETO" });
      break;
    case "EXPIRED":
      output.push({ code: "SET_ALREADY_EXPIRED" });
      break;
    case "EVALUATING":
      break;
  }

  // Expiry is independent of status and is the most common cause of a payment
  // that "should" work failing at the last step. It is still suppressed once the
  // outcome is already terminal, because "expiry approaching" contradicts a
  // decision that has already completed, failed, or expired.
  const terminal =
    context.status === "EXPIRED" ||
    context.status === "COMPLETED" ||
    context.status === "CANCELLED";
  if (context.secondsToExpiry !== null && !terminal) {
    if (context.secondsToExpiry <= 0)
      output.push({ code: "SET_ALREADY_EXPIRED" });
    else if (context.secondsToExpiry <= 3600)
      output.push({
        code: "SET_EXPIRY_APPROACHING",
        detail: { secondsToExpiry: String(context.secondsToExpiry) },
      });
  }

  // Return a stable order so callers and snapshot tests see the same sequence
  // regardless of which branch fired.
  return sortDiagnostics(output.map((entry) => diagnostic(entry)));
}

export type { Diagnostic, DiagnosticInput };
