import type { GroupOverview, SavedEvaluation } from "../group-view.js";
import {
  diagnostic,
  publicDiagnosticPayload,
  type Diagnostic,
} from "./types.js";

// Uses only the existing public evaluation projection, never private failures.
export function analyzeEvaluation(result: SavedEvaluation): Diagnostic[] {
  if (result.status === "NO_MATCH")
    return [diagnostic("DEC_NO_ELIGIBLE_CANDIDATE")];
  if (result.status === "NEEDS_CLARIFICATION")
    return [diagnostic("PRF_UNRESOLVED_CLARIFICATION")];
  if (result.status === "AWAITING_CONFIRMATION")
    return [diagnostic("PRF_AWAITING_CONFIRMATION")];
  const scores = result.candidates
    .filter((c) => c.eligible && c.scoreMicros !== null)
    .map((c) => c.scoreMicros!)
    .sort((a, b) => b - a);
  return scores.length > 1 && scores[0] === scores[1]
    ? [diagnostic("DEC_SCORE_TIE")]
    : [];
}

export function groupDiagnostics(
  overview: GroupOverview,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const { group, participants, evaluation, signingPolicy } = overview;
  const list: Diagnostic[] = [];
  if (signingPolicy) {
    // A saved policy does not prove chain activation, payment, or refunds.
    const remaining = signingPolicy.policy.expiry - nowSeconds;
    if (remaining <= 0) list.push(diagnostic("PLN_POLICY_EXPIRED"));
    else if (remaining <= 900) list.push(diagnostic("PLN_POLICY_EXPIRING"));
  } else {
    if (Date.parse(group.startsAt) <= (nowSeconds + 60) * 1000) {
      list.push(diagnostic("DEC_RESERVATION_PASSED"));
      return publicDiagnosticPayload(list);
    }
    if (participants.length < group.targetMemberCount) {
      list.push(diagnostic("GROUP_MEMBERS_MISSING"));
    } else if (participants.some((member) => !member.confirmed)) {
      list.push(diagnostic("PRF_AWAITING_CONFIRMATION"));
    } else if (!evaluation) {
      list.push(diagnostic("DEC_EVALUATION_PENDING"));
    }
    if (evaluation) list.push(...analyzeEvaluation(evaluation));
    if (evaluation?.status === "PROPOSAL_READY" && group.locked)
      list.push(diagnostic("PLN_POLICY_PENDING"));
  }
  return publicDiagnosticPayload(list);
}
