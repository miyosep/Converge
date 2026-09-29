// Selected and adapted from PR #6. Codes describe observed conditions;
// a workflow status alone must not imply a payment, failure, or score tie.
export type DiagnosticSeverity = "info" | "warning" | "error";
export type DiagnosticStage =
  "membership" | "preference" | "evaluation" | "policy" | "infrastructure";
export type DiagnosticSpec = {
  stage: DiagnosticStage;
  severity: DiagnosticSeverity;
  remedy: "user" | "group" | "operator" | "none";
  retryable: boolean;
  shareable: boolean;
  title: string;
  guidance: string;
};

export const DIAGNOSTIC_CODES = {
  GROUP_INCOMPLETE: {
    stage: "membership",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "The group is not ready to evaluate",
    guidance:
      "Everyone in the chosen group size must join and confirm their preferences. Refresh to check the latest progress.",
  },
  GROUP_MEMBERS_MISSING: {
    stage: "membership",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Waiting for group members",
    guidance:
      "Invite the remaining members. Everyone in the chosen group size must join before evaluation.",
  },
  PRF_AWAITING_CONFIRMATION: {
    stage: "preference",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Preferences still need confirmation",
    guidance:
      "Each member needs to submit, review, and confirm their own preferences before evaluation.",
  },
  PRF_UNRESOLVED_CLARIFICATION: {
    stage: "preference",
    severity: "warning",
    remedy: "user",
    retryable: false,
    shareable: false,
    title: "Requirements need clarification",
    guidance:
      "Review and resolve your outstanding requirements before confirming.",
  },
  PRF_UNSUPPORTED_REQUIREMENT: {
    stage: "preference",
    severity: "error",
    remedy: "user",
    retryable: false,
    shareable: false,
    title: "Requirement cannot be verified",
    guidance: "Review the unsupported requirement in your private preferences.",
  },
  SHR_PREFERENCE_UNRESOLVED: {
    stage: "preference",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Preferences need review",
    guidance:
      "A member needs to review their private preferences before the group can continue.",
  },
  PRF_STALE_REVISION: {
    stage: "preference",
    severity: "warning",
    remedy: "user",
    retryable: false,
    shareable: true,
    title: "Preferences changed",
    guidance:
      "Refresh the group and review the latest saved preferences before submitting again.",
  },
  DEC_EVALUATION_PENDING: {
    stage: "evaluation",
    severity: "info",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Ready to compare candidates",
    guidance:
      "Everyone has confirmed. Open Results and evaluate the group to find a match.",
  },
  DEC_NO_ELIGIBLE_CANDIDATE: {
    stage: "evaluation",
    severity: "error",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "No candidate meets every requirement",
    guidance:
      "Members can review their private requirements, confirm any changes, and evaluate again. A different candidate shortlist requires a new group.",
  },
  DEC_SCORE_TIE: {
    stage: "evaluation",
    severity: "info",
    remedy: "none",
    retryable: false,
    shareable: true,
    title: "Top candidates have the same score",
    guidance:
      "The saved recommendation uses per-person price, then candidate ID, to break the tie.",
  },
  PLN_POLICY_PENDING: {
    stage: "policy",
    severity: "info",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "Spending policy has not been prepared",
    guidance:
      "Open Policy & approval to prepare and review the spending terms. Preference confirmation does not approve a payment.",
  },
  PLN_POLICY_EXPIRING: {
    stage: "policy",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "The saved policy expires soon",
    guidance:
      "Check the latest on-chain status before acting. The contract rejects payments at or after the policy expiry.",
  },
  PLN_POLICY_EXPIRED: {
    stage: "policy",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "The saved policy's payment window has ended",
    guidance:
      "No new payment can use this policy. Open Execution to check the actual outcome and any refund eligibility.",
  },
  GROUP_LOCKED: {
    stage: "membership",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "This proposal is locked",
    guidance:
      "Membership and preferences are fixed for this proposal. Create a new group to use different participants or requirements.",
  },
  GROUP_ACCESS_REQUIRED: {
    stage: "membership",
    severity: "error",
    remedy: "user",
    retryable: false,
    shareable: true,
    title: "Group access is required",
    guidance:
      "Use a member wallet or ask the group organizer for a valid invitation.",
  },
  GROUP_INVITE_UNAVAILABLE: {
    stage: "membership",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "This invitation cannot be used",
    guidance:
      "Ask the organizer to check available places and create a new invitation.",
  },
  GROUP_ORGANIZER_REQUIRED: {
    stage: "membership",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "The organizer needs to do this",
    guidance: "Ask the current group organizer to create the invitation.",
  },
  DEC_RESERVATION_PASSED: {
    stage: "evaluation",
    severity: "warning",
    remedy: "group",
    retryable: false,
    shareable: true,
    title: "The reservation time is too close or has passed",
    guidance:
      "Create a new group with a future reservation time to prepare a new decision.",
  },
  INF_SESSION_EXPIRED: {
    stage: "infrastructure",
    severity: "warning",
    remedy: "user",
    retryable: false,
    shareable: true,
    title: "Connect your wallet again",
    guidance: "Sign in with your group wallet, then return to this step.",
  },
  INF_KILN_UNAVAILABLE: {
    stage: "infrastructure",
    severity: "warning",
    remedy: "user",
    retryable: true,
    shareable: true,
    title: "Preferences could not be interpreted",
    guidance:
      "Refresh to load the saved revision, then submit your preferences again. Your input has not been confirmed automatically.",
  },
  INF_CHAIN_UNAVAILABLE: {
    stage: "infrastructure",
    severity: "warning",
    remedy: "operator",
    retryable: true,
    shareable: true,
    title: "On-chain status could not be verified",
    guidance:
      "Refresh the chain status when the connection is available. Do not assume a pending payment failed or submit it again.",
  },
  INF_NOT_CONFIGURED: {
    stage: "infrastructure",
    severity: "error",
    remedy: "operator",
    retryable: false,
    shareable: true,
    title: "This service is not configured",
    guidance:
      "The service operator needs to finish setup before this action is available.",
  },
  INF_REQUEST_FAILED: {
    stage: "infrastructure",
    severity: "warning",
    remedy: "user",
    retryable: false,
    shareable: true,
    title: "The request could not be completed",
    guidance:
      "Refresh to check the saved state before trying the action again.",
  },
} as const satisfies Record<string, DiagnosticSpec>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;
