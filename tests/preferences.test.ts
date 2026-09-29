import assert from "node:assert/strict";
import test from "node:test";
import {
  submitPreference,
  completePreferenceExtraction,
  failPreferenceExtraction,
  correctPreference,
  confirmPreference,
  preferenceProgress,
  toEvaluationRevision,
  preferenceStateSchema,
  PreferenceError,
  type PreferenceContext,
} from "../src/lib/preferences.js";
import type { Extraction } from "../src/lib/schemas/constraints.js";

const context: PreferenceContext = {
  groupId: "group-one",
  participant: "0x1111111111111111111111111111111111111111",
  preferencesLocked: false,
};
const extraction: Extraction = {
  schemaVersion: 1,
  constraints: [{ type: "soft", field: "quiet", weight: 1 }],
  clarifications: [],
  unsupportedRequirements: [],
};
const now = "2030-01-01T00:00:00Z";
const submitted = () =>
  submitPreference(context, null, {
    text: "I prefer quiet.",
    expectedRevisionId: null,
  });
const ready = () => {
  const record = submitted();
  return completePreferenceExtraction(
    context,
    record,
    record.revisionId,
    extraction,
  );
};
const rejects = (operation: () => unknown, code: PreferenceError["code"]) =>
  assert.throws(
    operation,
    (error) => error instanceof PreferenceError && error.code === code,
  );

test("extraction never auto-confirms a preference; explicit confirmation enables evaluation", () => {
  const input = submitted();
  assert.equal(input.status, "PARSING");
  rejects(
    () => confirmPreference(context, input, input.revisionId, now),
    "INVALID_TRANSITION",
  );
  const parsed = completePreferenceExtraction(
    context,
    input,
    input.revisionId,
    extraction,
  );
  assert.equal(parsed.status, "AWAITING_CONFIRMATION");
  rejects(() => toEvaluationRevision(parsed), "INVALID_TRANSITION");
  const confirmed = confirmPreference(context, parsed, parsed.revisionId, now);
  assert.equal(
    toEvaluationRevision(confirmed).confirmedRevisionId,
    parsed.revisionId,
  );
  assert.deepEqual(
    confirmPreference(
      context,
      confirmed,
      confirmed.revisionId,
      "2030-01-02T00:00:00Z",
    ),
    confirmed,
  );
  assert.equal(input.extraction, null);
});

test("late worker results and stale confirmations cannot replace a newer submission", () => {
  const first = submitted();
  const second = submitPreference(context, first, {
    text: "Now I prefer atmosphere.",
    expectedRevisionId: first.revisionId,
  });
  assert.notEqual(first.revisionId, second.revisionId);
  rejects(
    () =>
      completePreferenceExtraction(
        context,
        second,
        first.revisionId,
        extraction,
      ),
    "STALE_REVISION",
  );
  rejects(
    () => failPreferenceExtraction(context, second, first.revisionId),
    "STALE_REVISION",
  );
  rejects(
    () => confirmPreference(context, second, first.revisionId, now),
    "STALE_REVISION",
  );
  rejects(
    () =>
      submitPreference(context, second, {
        text: "Lost update",
        expectedRevisionId: null,
      }),
    "STALE_REVISION",
  );
});

test("correcting confirmed output creates a new unconfirmed revision and preserves the previous record", () => {
  const parsed = ready();
  const confirmed = confirmPreference(context, parsed, parsed.revisionId, now);
  const correction = correctPreference(context, confirmed, {
    expectedRevisionId: confirmed.revisionId,
    extraction: { ...extraction, constraints: [] },
  });
  assert.notEqual(correction.revisionId, confirmed.revisionId);
  assert.equal(correction.confirmedAt, null);
  assert.equal(correction.status, "AWAITING_CONFIRMATION");
  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(confirmed.extraction!.constraints.length, 1);
  rejects(
    () => confirmPreference(context, correction, confirmed.revisionId, now),
    "STALE_REVISION",
  );
});

test("unresolved clarifications and unsupported requirements must be corrected before confirmation", () => {
  for (const field of ["clarifications", "unsupportedRequirements"] as const) {
    const input = submitted();
    const unresolved = completePreferenceExtraction(
      context,
      input,
      input.revisionId,
      { ...extraction, [field]: ["Resolve this requirement"] },
    );
    assert.equal(unresolved.status, "NEEDS_CLARIFICATION");
    rejects(
      () => confirmPreference(context, unresolved, unresolved.revisionId, now),
      "UNRESOLVED_REQUIREMENTS",
    );
    const corrected = correctPreference(context, unresolved, {
      expectedRevisionId: unresolved.revisionId,
      extraction,
    });
    assert.equal(
      confirmPreference(context, corrected, corrected.revisionId, now).status,
      "CONFIRMED",
    );
  }
});

test("wrong group or participant context cannot mutate another preference", () => {
  const record = ready();
  for (const other of [
    { ...context, groupId: "different-group" },
    { ...context, participant: "0x2222222222222222222222222222222222222222" },
  ] satisfies PreferenceContext[]) {
    rejects(
      () =>
        submitPreference(other, record, {
          text: "Attack",
          expectedRevisionId: record.revisionId,
        }),
      "ACCESS_DENIED",
    );
    rejects(
      () => confirmPreference(other, record, record.revisionId, now),
      "ACCESS_DENIED",
    );
    rejects(
      () =>
        correctPreference(other, record, {
          expectedRevisionId: record.revisionId,
          extraction,
        }),
      "ACCESS_DENIED",
    );
  }
});

test("frozen proposal context blocks all mutations including background completions", () => {
  const locked = { ...context, preferencesLocked: true };
  const record = submitted();
  rejects(
    () =>
      submitPreference(locked, null, { text: "New", expectedRevisionId: null }),
    "PREFERENCES_LOCKED",
  );
  rejects(
    () =>
      completePreferenceExtraction(
        locked,
        record,
        record.revisionId,
        extraction,
      ),
    "PREFERENCES_LOCKED",
  );
  rejects(
    () => failPreferenceExtraction(locked, record, record.revisionId),
    "PREFERENCES_LOCKED",
  );
  const parsed = ready();
  rejects(
    () =>
      correctPreference(locked, parsed, {
        expectedRevisionId: parsed.revisionId,
        extraction,
      }),
    "PREFERENCES_LOCKED",
  );
  rejects(
    () => confirmPreference(locked, parsed, parsed.revisionId, now),
    "PREFERENCES_LOCKED",
  );
});

test("parse failure is sanitized and a retry needs a new revision", () => {
  const record = submitted();
  const failed = failPreferenceExtraction(context, record, record.revisionId);
  assert.equal(failed.errorCode, "EXTRACTION_FAILED");
  rejects(
    () =>
      completePreferenceExtraction(
        context,
        failed,
        failed.revisionId,
        extraction,
      ),
    "INVALID_TRANSITION",
  );
  const retry = submitPreference(context, failed, {
    text: failed.rawText,
    expectedRevisionId: failed.revisionId,
  });
  assert.notEqual(retry.revisionId, failed.revisionId);
  assert.equal(retry.errorCode, null);
});

test("shared progress contains no raw text, extracted constraints, or revision IDs", () => {
  assert.deepEqual(preferenceProgress(null), {
    submitted: false,
    confirmed: false,
  });
  const record = ready();
  assert.deepEqual(preferenceProgress(record), {
    submitted: true,
    confirmed: false,
  });
  assert.deepEqual(
    preferenceProgress(
      confirmPreference(context, record, record.revisionId, now),
    ),
    { submitted: true, confirmed: true },
  );
});

test("invalid extraction, fabricated state combinations, and oversized input fail validation", () => {
  const record = submitted();
  assert.throws(() =>
    completePreferenceExtraction(context, record, record.revisionId, {
      ...extraction,
      authorizePayment: true,
    }),
  );
  assert.throws(() =>
    preferenceStateSchema.parse({
      ...record,
      status: "CONFIRMED",
      confirmedAt: now,
    }),
  );
  assert.throws(() =>
    preferenceStateSchema.parse({ ...ready(), status: "NEEDS_CLARIFICATION" }),
  );
  assert.throws(() =>
    submitPreference(context, null, {
      text: "x".repeat(4001),
      expectedRevisionId: null,
    }),
  );
});
