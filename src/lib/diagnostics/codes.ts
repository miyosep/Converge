// Stable diagnostic codes shared by the decision engine, the API layer, the
// contract layer, and the web client.
//
// Codes are a permanent public contract: they appear in API responses, evidence
// files, and client i18n keys. Never rename or reuse one. Add a new code and
// retire the old one instead.
//
// Prefixes:
//   DEC_  decision-engine eligibility, ranking, and input problems
//   PRF_  preference lifecycle and confirmation problems
//   PLN_  policy construction and approval readiness problems
//   FUND_ funding and approval progress problems
//   CHN_  on-chain rejection and execution problems
//   INF_  infrastructure failures (database, Kiln, RPC, reconciliation)

export const DIAGNOSTIC_SEVERITIES = ["info", "warning", "error"] as const;
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

// A diagnostic is a *condition to act on*, not a log line. The stage tells the
// client where in the decision lifecycle the condition blocks progress, so the
// UI can attach the reminder to the right step instead of showing a global banner.
export const DIAGNOSTIC_STAGES = [
  "input", // malformed or unauthorized evaluation input
  "preference", // a participant's revision is not usable yet
  "eligibility", // candidate filtering
  "ranking", // ranking and tie-breaking
  "approval", // policy readiness and member approvals
  "funding", // contributions
  "execution", // payment submission and on-chain effects
  "settlement", // refunds and expiry
  "infrastructure", // non-deterministic external failures
] as const;
export type DiagnosticStage = (typeof DIAGNOSTIC_STAGES)[number];

// Remediation class drives what the UI offers. `user` means the participant can
// fix it themselves; `operator` means only an operator or the group can; `none`
// means the condition is a valid terminal outcome and needs no action.
export const DIAGNOSTIC_REMEDIES = [
  "user", // participant edits or reconfirms something
  "group", // needs another member or a group-level action
  "operator", // needs an operator, migration, or manual reconciliation
  "none", // valid outcome or already-terminal state
] as const;
export type DiagnosticRemedy = (typeof DIAGNOSTIC_REMEDIES)[number];

export type DiagnosticCodeSpec = {
  stage: DiagnosticStage;
  severity: DiagnosticSeverity;
  remedy: DiagnosticRemedy;
  // Retrying identical input cannot succeed. The UI must not offer "Try again".
  retryable: boolean;
  // Safe to show to every group member without leaking any participant's
  // constraints, identities, or revision identifiers.
  shareable: boolean;
  title: string;
  // Written for the participant who hit the condition. Keep it free of
  // participant-specific values so it can be shared as-is when `shareable`.
  guidance: string;
};

export const DIAGNOSTIC_CODES = {
  // ---- decision-engine input -------------------------------------------------
  DEC_INPUT_INVALID: {
    stage: "input",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: false,
    title: "Evaluation input rejected",
    guidance:
      "The evaluation input failed validation. Rebuild it from persisted server state; do not retry the same payload.",
  },
  DEC_INPUT_MAX_SAFE_INTEGER: {
    stage: "input",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: false,
    title: "Evaluation number outside safe range",
    guidance:
      "A numeric field exceeded Number.MAX_SAFE_INTEGER and cannot be compared reliably. Keep money and token fields as base-unit strings.",
  },
  DEC_PARTICIPANT_ONESIDED: {
    // This is an eligibility outcome, not malformed input: it is produced by
    // `eligibilityDiagnostics` after candidate filtering. Filing it under
    // `input` also made the group-visible projection report "this step could
    // not start" instead of the real condition.
    stage: "eligibility",
    severity: "error",
    // A mutually-unsatisfiable constraint set is resolved by the group relaxing
    // a requirement, not by an operator editing state.
    remedy: "group",
    retryable: true,
    // The group must be told their combined requirements cannot all be met.
    // Naming it reveals no individual's constraint.
    shareable: true,
    title: "Voting is one-sided",
    guidance:
      "Every candidate was rejected by the same participants and no candidate was acceptable to all. Treat this as a constraint conflict, not a catalog problem.",
  },
  DEC_MEMBER_SET_MISMATCH: {
    stage: "input",
    severity: "error",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Preference set does not match the group",
    guidance:
      "There must be exactly one confirmed revision from each of the six members. Ask the group to resubmit before evaluating.",
  },

  // ---- preference lifecycle --------------------------------------------------
  PRF_UNRESOLVED_CLARIFICATION: {
    stage: "preference",
    severity: "warning",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Open clarification",
    guidance:
      "A participant's requirements still contain open questions. Answer them, then re-interpret and confirm.",
  },
  PRF_UNSUPPORTED_REQUIREMENT: {
    stage: "preference",
    severity: "error",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Requirement cannot be verified",
    guidance:
      "A requirement cannot be checked against the current catalog. Replace it with a requirement the catalog can answer, or remove it.",
  },
  PRF_AWAITING_CONFIRMATION: {
    stage: "preference",
    severity: "warning",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Revision not confirmed",
    guidance:
      "A participant has not confirmed their current interpreted revision. Confirm it, then evaluate.",
  },
  PRF_STALE_REVISION: {
    stage: "preference",
    severity: "warning",
    remedy: "user",
    retryable: false,
    shareable: false,
    title: "Revision is out of date",
    guidance:
      "This revision was replaced by a newer one. Reload the group before acting; do not resubmit the old revision.",
  },
  PRF_ZERO_WEIGHT_TOTAL: {
    stage: "preference",
    severity: "info",
    remedy: "none",
    retryable: false,
    shareable: false,
    title: "No soft preferences",
    guidance:
      "No participant expressed a positive soft weight. Mandatory constraints still apply and ranking uses price, then candidate ID.",
  },

  // ---- eligibility -----------------------------------------------------------
  DEC_NO_ELIGIBLE_CANDIDATE: {
    stage: "eligibility",
    severity: "error",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "No candidate meets every requirement",
    guidance:
      "Every candidate failed at least one mandatory condition or was excluded. No match is a valid outcome; relax a requirement or widen the merchant allowlist, then evaluate again.",
  },
  DEC_MERCHANT_NOT_PERMITTED: {
    stage: "eligibility",
    severity: "warning",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "Merchant not in the allowlist",
    guidance:
      "Candidates were excluded because their merchant is not on the approved list. Update the allowlist through the group flow if this is intentional.",
  },
  DEC_DEPOSIT_UNAFFORDABLE: {
    stage: "eligibility",
    severity: "warning",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "Deposit exceeds the approved cap",
    guidance:
      "Candidates were excluded because their deposit exceeds the approved deposit or spending cap. Raise the cap deliberately or choose another candidate.",
  },
  DEC_SLOT_UNAVAILABLE: {
    stage: "eligibility",
    severity: "warning",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Reservation slot unavailable",
    guidance:
      "Candidates were excluded because the requested start time is not offered. Pick a different time and re-interpret.",
  },
  DEC_CANDIDATE_UNAVAILABLE: {
    stage: "eligibility",
    severity: "info",
    remedy: "none",
    retryable: false,
    shareable: true,
    title: "Candidate marked unavailable",
    guidance:
      "Some candidates are flagged unavailable in the catalog and were skipped before ranking.",
  },
  DEC_CONSTRAINT_UNSATISFIED: {
    stage: "eligibility",
    severity: "warning",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Mandatory condition unsatisfied",
    guidance:
      "A candidate failed a mandatory condition. Safety, accessibility, and dietary conditions require explicit support; unknown never counts as support.",
  },
  DEC_NONNEGOTIABLE_UNKNOWN: {
    stage: "eligibility",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Safety metadata missing",
    guidance:
      "A non-negotiable requirement failed because the catalog reports unknown metadata. Do not treat unknown as support; the catalog needs an explicit value.",
  },

  // ---- ranking ---------------------------------------------------------------
  DEC_SCORE_TIE: {
    stage: "ranking",
    severity: "info",
    remedy: "none",
    retryable: false,
    shareable: true,
    title: "Scores tied",
    guidance:
      "Two or more eligible candidates scored identically. Ranking uses lower meal price, then ordinal candidate ID, so the result is deterministic.",
  },
  DEC_WINNER_BY_TIEBREAK: {
    stage: "ranking",
    severity: "info",
    remedy: "none",
    retryable: false,
    shareable: true,
    title: "Winner decided by tie-break",
    guidance:
      "The winner did not lead on score alone and was chosen by the documented tie-breakers. This is expected behaviour, not an error.",
  },
  DEC_NARROW_MARGIN: {
    stage: "ranking",
    severity: "info",
    remedy: "none",
    retryable: false,
    shareable: true,
    title: "Narrow winning margin",
    guidance:
      "The top two candidates are within a small margin. Mention this to the group so the proposal is not presented as a clear preference.",
  },

  // ---- policy and approval ---------------------------------------------------
  PLN_POLICY_INVALID: {
    stage: "approval",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Policy rejected",
    guidance:
      "The constructed policy violates the documented invariants (payment <= deposit <= total spend <= funding). Fix the inputs; the chain will reject it otherwise.",
  },
  PLN_POLICY_HASH_MISMATCH: {
    stage: "approval",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Policy hash mismatch",
    guidance:
      "The off-chain policy hash does not match the hash the contract computes. Do not approve; regenerate the policy and the hash together.",
  },
  PLN_POLICY_EXPIRY_OUT_OF_WINDOW: {
    stage: "approval",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Expiry outside the allowed window",
    guidance:
      "The policy expiry is in the past or beyond the contract's maximum lifetime. Set an expiry inside the allowed window before approving.",
  },
  PLN_AWAITING_APPROVAL: {
    stage: "approval",
    severity: "warning",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "Approvals incomplete",
    guidance:
      "Payment requires six separate member approvals. Ask the remaining members to approve with the expected policy hash.",
  },
  PLN_APPROVAL_HASH_MISMATCH: {
    stage: "approval",
    severity: "error",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Approval used the wrong hash",
    guidance:
      "The approval referenced a different policy hash than the contract holds. Cancel this approval and approve the current hash.",
  },
  PLN_PARTICIPANT_ONESHIDED: {
    stage: "approval",
    severity: "warning",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "One member is blocking",
    guidance:
      "A single member declined and is sufficient to veto before payment. The group should resolve the objection rather than re-running the vote.",
  },

  // ---- funding ---------------------------------------------------------------
  FUND_PARTIAL_FUNDING: {
    stage: "funding",
    severity: "warning",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "Funding incomplete",
    guidance:
      "The wallet is still collecting contributions. It activates only on the sixth valid contribution.",
  },
  FUND_ALLOWANCE_INSUFFICIENT: {
    stage: "funding",
    severity: "error",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Token allowance too low",
    guidance:
      "Your token allowance is below the required contribution. Increase the allowance, then contribute again. No state changed.",
  },
  FUND_BALANCE_INSUFFICIENT: {
    stage: "funding",
    severity: "error",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Token balance too low",
    guidance:
      "Your token balance cannot cover the contribution. Top up and retry. No state changed.",
  },
  FUND_TRANSFER_AMOUNT_MISMATCH: {
    stage: "funding",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Token receipt did not match",
    guidance:
      "The received amount differed from the requested amount, so the contribution reverted. A fee-on-transfer or rebasing token is not supported.",
  },
  FUND_DUPLICATE_APPROVAL: {
    stage: "funding",
    severity: "warning",
    remedy: "none",
    retryable: false,
    shareable: false,
    title: "Already approved",
    guidance:
      "This wallet already approved and contributed. The second attempt was rejected without changing state.",
  },
  FUND_ALREADY_ACTIVE: {
    stage: "funding",
    severity: "warning",
    remedy: "none",
    retryable: false,
    shareable: true,
    title: "Wallet already active",
    guidance:
      "The wallet has already activated and no longer accepts contributions.",
  },
  FUND_CANCEL_VETO: {
    stage: "funding",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Decision cancelled by a member",
    guidance:
      "A participant cancelled before payment. This veto is final and the decision cannot be reactivated; refunds become available.",
  },

  // ---- execution -------------------------------------------------------------
  CHN_NOT_EXECUTOR: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Caller is not the executor",
    guidance:
      "Only the policy executor can submit the payment. Rebuild and re-approve the decision if the executor changed.",
  },
  CHN_NOT_ACTIVE: {
    stage: "execution",
    severity: "error",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Decision not active",
    guidance:
      "The decision is not in the active state, so payment is blocked. Check whether it is still funding, or already completed, cancelled, or expired.",
  },
  CHN_EXPIRED: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Decision expired",
    guidance:
      "The policy expiry has passed. Payment is permanently blocked; the group must settle refunds instead.",
  },
  CHN_MERCHANT_NOT_ALLOWED: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Merchant not allowed",
    guidance:
      "The payment target does not match the merchant fixed in the policy. A new decision is required; the payee cannot be substituted.",
  },
  CHN_AMOUNT_NOT_APPROVED: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Amount does not match the approved policy",
    guidance:
      "One payment per decision and the amount must equal the approved payment exactly. The MVP does not support partial or variable payments.",
  },
  CHN_MAX_DEPOSIT_EXCEEDED: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Deposit cap exceeded",
    guidance:
      "The amount exceeds the approved maximum deposit. Reduce the amount to the approved deposit or create a new decision.",
  },
  CHN_MAX_TOTAL_SPEND_EXCEEDED: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Cumulative spend cap exceeded",
    guidance:
      "The amount would push cumulative spend past the approved total spend cap. The contract enforces this per call and cumulatively.",
  },
  CHN_INSUFFICIENT_DECISION_BALANCE: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Decision balance too low",
    guidance:
      "The wallet holds less than the requested amount after prior spending and refunds. Do not retry; reconcile contributions first.",
  },
  CHN_ZERO_AMOUNT: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Zero payment amount",
    guidance: "A zero-amount payment is rejected by the contract.",
  },
  CHN_DUPLICATE_PAYMENT: {
    stage: "execution",
    severity: "error",
    remedy: "none",
    retryable: false,
    shareable: true,
    title: "Payment already executed",
    guidance:
      "This decision has already paid out. The MVP permits exactly one payment, so a second payment is rejected without changing state.",
  },
  CHN_INSUFFICIENT_APPROVALS: {
    stage: "execution",
    severity: "error",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "Approvals or funding insufficient",
    guidance:
      "The decision lacks all six approvals or enough contributed balance to pay. Collect the missing approvals first.",
  },
  CHN_TX_REVERTED: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Transaction reverted on-chain",
    guidance:
      "The transaction reverted with an unrecognised reason. Do not retry blindly; inspect the receipt and the contract state first.",
  },
  CHN_SIMULATION_FAILED: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: true,
    shareable: false,
    title: "Pre-flight simulation failed",
    guidance:
      "The call was expected to revert, so it was not submitted. Nothing was spent; fix the reported condition before retrying.",
  },
  CHN_REENTRANCY_BLOCKED: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Reentrant call blocked",
    guidance:
      "A reentrant call was rejected. A duplicate payment or claim cannot be produced this way; treat this as a safety stop.",
  },

  // ---- settlement ------------------------------------------------------------
  SET_EXPIRY_APPROACHING: {
    stage: "settlement",
    severity: "warning",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Expiry approaching",
    guidance:
      "The policy expires soon. Payments are rejected exactly at and after expiry, so execute before then or plan to refund.",
  },
  SET_ALREADY_EXPIRED: {
    stage: "settlement",
    severity: "info",
    // Expiry is final for payment but not for the group's money: contributions
    // stay locked until expiry is finalized on-chain. A `none` remedy would say
    // "nothing to do", which is false while funds are still escrowed.
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Already expired",
    guidance:
      "The decision is already expired. Expiry finalization enables refunds; no further payment is possible.",
  },
  SET_REFUND_NOT_AVAILABLE: {
    stage: "settlement",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Refund not yet available",
    guidance:
      "Refunds are available only after completion, cancellation, or expiry. Wait for a terminal state before claiming.",
  },
  SET_REFUND_ALREADY_CLAIMED: {
    stage: "settlement",
    severity: "warning",
    remedy: "none",
    retryable: false,
    shareable: false,
    title: "Refund already claimed",
    guidance:
      "This wallet already claimed its refund. A second claim is rejected without changing state.",
  },
  SET_NO_CONTRIBUTION: {
    stage: "settlement",
    severity: "warning",
    remedy: "none",
    retryable: false,
    shareable: false,
    title: "No contribution recorded",
    guidance:
      "This wallet never contributed to the decision, so there is nothing to refund.",
  },
  SET_REMAINDER_DUST: {
    stage: "settlement",
    severity: "info",
    remedy: "none",
    retryable: false,
    shareable: true,
    title: "Refund remainder distributed by ordinal",
    guidance:
      "The remainder does not divide evenly across six members. The lowest-ordinal participants receive one extra base unit, so total entitlements equal the remaining balance exactly.",
  },
  SET_SETTLEMENT_UNBALANCED: {
    stage: "settlement",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Settlement does not balance",
    guidance:
      "Spent plus refunded exceeds contributions, or entitlements do not sum to the remainder. Halt settlement and reconcile before any further transfer.",
  },

  // ---- infrastructure --------------------------------------------------------
  INF_DB_WRITE_FAILED: {
    stage: "infrastructure",
    severity: "error",
    remedy: "operator",
    retryable: true,
    shareable: false,
    title: "Database write failed",
    guidance:
      "The chain transaction succeeded but the database write failed. Reconcile from the chain receipt before retrying so the success is not duplicated.",
  },
  INF_KILN_UNAVAILABLE: {
    stage: "infrastructure",
    severity: "error",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Preference parsing unavailable",
    guidance:
      "The parsing provider is unavailable. Your text was saved. Retry the interpretation; nothing was confirmed and no transaction occurred.",
  },
  INF_KILN_TIMEOUT: {
    stage: "infrastructure",
    severity: "error",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Preference parsing timed out",
    guidance:
      "The provider did not respond in time. Retry; a timeout is counted separately from a provider error.",
  },
  INF_KILN_USAGE_UNKNOWN: {
    stage: "infrastructure",
    severity: "warning",
    remedy: "operator",
    retryable: false,
    shareable: false,
    title: "Provider usage unknown",
    guidance:
      "The provider did not report token usage. Unknown usage stays unknown and must not be recorded as zero.",
  },
  INF_RPC_FAILURE: {
    stage: "infrastructure",
    severity: "error",
    remedy: "operator",
    retryable: true,
    shareable: false,
    title: "Chain RPC unavailable",
    guidance:
      "The chain could not be read or written through the current RPC endpoint. The on-chain state is unchanged; retry once the endpoint recovers.",
  },
  INF_EVENT_REPLAY_DUPLICATE: {
    stage: "infrastructure",
    severity: "warning",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "Duplicate chain event ignored",
    guidance:
      "A chain event was replayed and was rejected as a duplicate. Approvals, contributions, and refunds are not counted twice.",
  },
  INF_RECONCILIATION_REQUIRED: {
    stage: "infrastructure",
    severity: "error",
    remedy: "operator",
    retryable: true,
    shareable: false,
    title: "Manual reconciliation required",
    guidance:
      "Chain and database records disagree. Run reconciliation and treat chain state as authoritative before any new action.",
  },
  INF_SESSION_EXPIRED: {
    stage: "infrastructure",
    severity: "warning",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Session expired",
    guidance: "Your session expired. Reconnect your wallet to continue.",
  },
  INF_RATE_LIMITED: {
    stage: "infrastructure",
    severity: "warning",
    remedy: "user",
    retryable: true,
    shareable: false,
    title: "Too many requests",
    guidance: "Too many attempts. Wait briefly before retrying.",
  },

  // ---- group-visible stand-ins ----------------------------------------------
  //
  // These are the ONLY codes the group may receive in place of a private one.
  // They exist as a separate family for one reason: a stand-in must describe the
  // *stage* and never the condition. Reusing a real condition code as a fallback
  // (for example substituting PRF_AWAITING_CONFIRMATION for an unresolved
  // clarification) both reveals which condition occurred and states something
  // false, because the group was never awaiting a confirmation.
  //
  // Every `SHR_` code is shareable, generic, and carries no attribution. The
  // analyzer never emits one directly; only `publicDiagnostic` substitutes them.
  SHR_INPUT_UNAVAILABLE: {
    stage: "input",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "This step could not start",
    guidance:
      "The request could not be prepared from the current state. Try again shortly; if it persists, contact the operator.",
  },
  SHR_PREFERENCE_UNRESOLVED: {
    stage: "preference",
    severity: "warning",
    remedy: "user",
    retryable: true,
    shareable: true,
    title: "A preference is still open",
    guidance:
      "At least one member's preference is not ready to use. Whoever has an open item can resolve it in their own view.",
  },
  SHR_ELIGIBILITY_BLOCKED: {
    stage: "eligibility",
    severity: "error",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "No candidate satisfies every requirement",
    guidance:
      "The group's requirements cannot all be met at once. Revisit the mandatory conditions and relax one.",
  },
  SHR_RANKING_INCONCLUSIVE: {
    stage: "ranking",
    severity: "info",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Ranking was not decisive",
    guidance:
      "The leading options scored identically or nearly so. Review the proposal before approving.",
  },
  SHR_APPROVAL_INCOMPLETE: {
    stage: "approval",
    severity: "warning",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "Approvals outstanding",
    guidance:
      "The policy is not fully approved yet. The remaining members can approve against the expected policy hash.",
  },
  SHR_FUNDING_INCOMPLETE: {
    stage: "funding",
    severity: "warning",
    remedy: "group",
    retryable: true,
    shareable: true,
    title: "Contributions outstanding",
    guidance:
      "The wallet has not reached its full contributed balance and has not activated.",
  },
  SHR_EXECUTION_FAILED: {
    stage: "execution",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "The payment did not go through",
    guidance:
      "The on-chain payment failed. No spend occurred unless a receipt says otherwise; the operator can confirm the chain state.",
  },
  SHR_SETTLEMENT_ISSUE: {
    stage: "settlement",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Settlement needs attention",
    guidance:
      "Refund or expiry handling needs review. Funds remain in escrow until settlement is finalized.",
  },
  SHR_INFRASTRUCTURE_ISSUE: {
    stage: "infrastructure",
    severity: "error",
    remedy: "operator",
    retryable: true,
    shareable: true,
    title: "A system dependency is unavailable",
    guidance:
      "An external dependency failed. The group's data and funds are unaffected; retry once the operator confirms recovery.",
  },
} as const satisfies Record<string, DiagnosticCodeSpec>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;

export function diagnosticSpec(code: DiagnosticCode): DiagnosticCodeSpec {
  return DIAGNOSTIC_CODES[code];
}

export function isDiagnosticCode(value: string): value is DiagnosticCode {
  return Object.hasOwn(DIAGNOSTIC_CODES, value);
}
