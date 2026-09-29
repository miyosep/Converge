import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiagnosticsList } from "../app/components/diagnostics.js";
import {
  diagnostic,
  publicDiagnosticPayload,
} from "../src/lib/diagnostics/types.js";
import {
  groupDiagnostics,
  analyzeEvaluation,
} from "../src/lib/diagnostics/group.js";
import { errorDiagnostics } from "../src/lib/diagnostics/errors.js";
import { api, ApiError } from "../src/lib/server/api.js";
import { buildGroupPolicy } from "../src/lib/group-policy.js";
import {
  groupEvaluationOptions,
  groupPolicyConfig,
} from "../src/lib/server/group-config.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";
import { evaluateDecision } from "../src/lib/decision-engine.js";
import {
  savedEvaluationView,
  type GroupOverview,
} from "../src/lib/group-view.js";

const now = 1790651770;
const startsAt = new Date((now + 7200) * 1000)
  .toISOString()
  .replace(/\.\d{3}Z$/, "Z");
const members = [101, 102, 103, 104, 105, 106].map(
  (value) => `0x${value.toString(16).padStart(40, "0")}` as `0x${string}`,
);
const snapshot = {
  ...groupEvaluationOptions(startsAt),
  slot: { startsAt, timeZone: "Asia/Seoul" },
  members,
  preferences: createBaselinePreferences(members),
};
const evaluation = savedEvaluationView({
  ...snapshot,
  id: "eval",
  createdAt: new Date(now * 1000).toISOString(),
  result: evaluateDecision(snapshot),
});
function overview(size = 6): GroupOverview {
  return {
    group: {
      id: "group",
      name: "Dinner",
      startsAt,
      timeZone: "Asia/Seoul",
      locked: false,
      memberCount: size,
      targetMemberCount: size,
      confirmedCount: size,
    },
    participants: Array.from({ length: size }, (_, i) => ({
      walletAddress: String(i),
      displayName: `Member ${i}`,
      submitted: true,
      confirmed: true,
    })),
    evaluation: null,
    signingPolicy: null,
  };
}
const codes = (input: GroupOverview, time = now) =>
  groupDiagnostics(input, time).diagnostics.map((item) => item.code);

test("diagnostics use target size and distinguish missing members, confirmations, and unevaluated groups", () => {
  for (const size of [2, 4, 6, 100]) {
    const input = overview(size);
    assert.deepEqual(codes(input), ["DEC_EVALUATION_PENDING"]);
    input.participants[0]!.confirmed = false;
    assert.deepEqual(codes(input), ["PRF_AWAITING_CONFIRMATION"]);
    input.participants.pop();
    input.group.memberCount--;
    assert.deepEqual(codes(input), ["GROUP_MEMBERS_MISSING"]);
  }
});

test("a saved proposal is not automatically a tie; only equal top eligible scores count", () => {
  const base = { ...evaluation, status: "PROPOSAL_READY" as const };
  assert.deepEqual(
    analyzeEvaluation({
      ...base,
      candidates: [
        { id: "A", eligible: true, scoreMicros: 900000 },
        { id: "B", eligible: true, scoreMicros: 800000 },
        { id: "C", eligible: false, scoreMicros: 900000 },
      ],
    }),
    [],
  );
  assert.equal(
    analyzeEvaluation({
      ...base,
      candidates: [
        { id: "A", eligible: true, scoreMicros: 900000 },
        { id: "B", eligible: true, scoreMicros: 900000 },
      ],
    })[0]?.code,
    "DEC_SCORE_TIE",
  );
  assert.equal(
    analyzeEvaluation({ ...base, status: "NO_MATCH" })[0]?.code,
    "DEC_NO_ELIGIBLE_CANDIDATE",
  );
});

test("policy diagnostics use the actual shorter expiry, without inferring payment or refund outcomes", () => {
  const input = overview();
  input.signingPolicy = buildGroupPolicy({
    groupId: "group",
    evaluationId: "eval",
    decisionNonce: "nonce",
    snapshot,
    expectedWinner: "A",
    config: groupPolicyConfig,
    nowSeconds: now,
  });
  assert.equal(input.signingPolicy.policy.expiry, now + 3600);
  assert.deepEqual(codes(input), []);
  assert.deepEqual(codes(input, now + 2700), ["PLN_POLICY_EXPIRING"]);
  assert.deepEqual(codes(input, now + 3600), ["PLN_POLICY_EXPIRED"]);
  const result = groupDiagnostics(input, now + 3600);
  assert.equal(result.summary.blocking, false);
  assert.match(result.diagnostics[0]!.guidance, /check the actual outcome/);
});

test("elapsed or imminent reservations do not tell members to evaluate or prepare an unusable policy", () => {
  assert.deepEqual(codes(overview(), now + 7140), ["DEC_RESERVATION_PASSED"]);
  assert.deepEqual(
    codes(
      {
        ...overview(),
        evaluation,
        group: { ...overview().group, locked: true },
      },
      now + 7200,
    ),
    ["DEC_RESERVATION_PASSED"],
  );
});

test("public diagnostics and summary do not disclose private counts, severity, or attribution", () => {
  const one = publicDiagnosticPayload([
    diagnostic("PRF_UNRESOLVED_CLARIFICATION", {
      participant: "private-wallet",
      field: "allergy",
      revisionId: "private-revision",
    }),
  ]);
  const many = publicDiagnosticPayload([
    diagnostic("PRF_UNRESOLVED_CLARIFICATION"),
    diagnostic("PRF_UNSUPPORTED_REQUIREMENT"),
    diagnostic("PRF_UNSUPPORTED_REQUIREMENT", { participant: "other" }),
  ]);
  assert.deepEqual(one, many);
  assert.deepEqual(one.summary, {
    worst: "warning",
    blocking: false,
    bySeverity: { info: 0, warning: 1, error: 0 },
  });
  assert.doesNotMatch(
    JSON.stringify(one),
    /private-wallet|allergy|private-revision|participant|revisionId|field/,
  );
});

test("API errors retain their code and HTTP status and add safe, uncached guidance", async () => {
  const response = await api(async () => {
    throw new ApiError(409, "UNRESOLVED_REQUIREMENTS");
  });
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "UNRESOLVED_REQUIREMENTS",
    ...errorDiagnostics("UNRESOLVED_REQUIREMENTS"),
  });
  assert.equal(
    errorDiagnostics("unexpected secret provider text").diagnostics[0]?.code,
    "INF_REQUEST_FAILED",
  );
});

test("guidance is accessible, actionable, and empty results do not claim all checks passed", () => {
  assert.equal(
    renderToStaticMarkup(createElement(DiagnosticsList, { diagnostics: [] })),
    "",
  );
  const html = renderToStaticMarkup(
    createElement(DiagnosticsList, groupDiagnostics(overview(), now)),
  );
  assert.match(html, /aria-label="Group guidance"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Next step:/);
  assert.match(html, /Open Results/);
  assert.doesNotMatch(html, /DEC_EVALUATION_PENDING|Retry will not help/);
});
