import { randomUUID } from "node:crypto";
import { z } from "zod";
import { extractionSchema, type Extraction } from "./schemas/constraints.js";
import {
  addressSchema,
  idSchema,
  utcTimestampSchema,
} from "./schemas/primitives.js";

// Construct this context from a verified session and locked database group row, never request JSON.
export const preferenceContextSchema = z.strictObject({
  groupId: idSchema,
  participant: addressSchema,
  preferencesLocked: z.boolean(),
});
export type PreferenceContext = z.infer<typeof preferenceContextSchema>;
export const preferenceStateSchema = z
  .strictObject({
    groupId: idSchema,
    participant: addressSchema,
    revisionId: idSchema,
    rawText: z.string().trim().min(1).max(4000),
    status: z.enum([
      "PARSING",
      "AWAITING_CONFIRMATION",
      "NEEDS_CLARIFICATION",
      "PARSE_FAILED",
      "CONFIRMED",
    ]),
    extraction: extractionSchema.nullable(),
    confirmedAt: utcTimestampSchema.nullable(),
    errorCode: z.enum(["EXTRACTION_FAILED"]).nullable(),
  })
  .superRefine((value, context) => {
    const parsed = [
      "AWAITING_CONFIRMATION",
      "NEEDS_CLARIFICATION",
      "CONFIRMED",
    ].includes(value.status);
    const unresolved = !!value.extraction && hasUnresolved(value.extraction);
    if (
      parsed !== (value.extraction !== null) ||
      (value.status === "CONFIRMED") !== (value.confirmedAt !== null) ||
      (value.status === "PARSE_FAILED") !== (value.errorCode !== null) ||
      (parsed && (value.status === "NEEDS_CLARIFICATION") !== unresolved)
    ) {
      context.addIssue({
        code: "custom",
        message: "Inconsistent preference state",
      });
    }
  });
export type PreferenceState = z.infer<typeof preferenceStateSchema>;
export class PreferenceError extends Error {
  constructor(
    public readonly code:
      | "ACCESS_DENIED"
      | "PREFERENCES_LOCKED"
      | "STALE_REVISION"
      | "INVALID_TRANSITION"
      | "UNRESOLVED_REQUIREMENTS",
  ) {
    super(code);
    this.name = "PreferenceError";
  }
}
function hasUnresolved(value: Extraction) {
  return (
    value.clarifications.length > 0 || value.unsupportedRequirements.length > 0
  );
}
function authorize(
  context: PreferenceContext,
  current: PreferenceState | null,
) {
  const parsed = preferenceContextSchema.parse(context);
  if (
    current &&
    (current.groupId !== parsed.groupId ||
      current.participant.toLowerCase() !== parsed.participant.toLowerCase())
  )
    throw new PreferenceError("ACCESS_DENIED");
  if (parsed.preferencesLocked) throw new PreferenceError("PREFERENCES_LOCKED");
  return parsed;
}
function checkRevision(
  current: PreferenceState | null,
  expectedRevisionId: string | null,
) {
  if ((current?.revisionId ?? null) !== expectedRevisionId)
    throw new PreferenceError("STALE_REVISION");
}

export function submitPreference(
  context: PreferenceContext,
  value: PreferenceState | null,
  input: { text: string; expectedRevisionId: string | null },
): PreferenceState {
  const current = value === null ? null : preferenceStateSchema.parse(value);
  const owner = authorize(context, current);
  checkRevision(current, input.expectedRevisionId);
  return preferenceStateSchema.parse({
    groupId: owner.groupId,
    participant: owner.participant,
    revisionId: randomUUID(),
    rawText: input.text,
    status: "PARSING",
    extraction: null,
    confirmedAt: null,
    errorCode: null,
  });
}

// Worker completions must compare their captured revision against the current database revision.
export function completePreferenceExtraction(
  context: PreferenceContext,
  value: PreferenceState,
  revisionId: string,
  output: unknown,
): PreferenceState {
  const current = preferenceStateSchema.parse(value);
  authorize(context, current);
  checkRevision(current, revisionId);
  if (current.status !== "PARSING")
    throw new PreferenceError("INVALID_TRANSITION");
  const extraction = extractionSchema.parse(output);
  return preferenceStateSchema.parse({
    ...current,
    extraction,
    status: hasUnresolved(extraction)
      ? "NEEDS_CLARIFICATION"
      : "AWAITING_CONFIRMATION",
  });
}

export function failPreferenceExtraction(
  context: PreferenceContext,
  value: PreferenceState,
  revisionId: string,
): PreferenceState {
  const current = preferenceStateSchema.parse(value);
  authorize(context, current);
  checkRevision(current, revisionId);
  if (current.status !== "PARSING")
    throw new PreferenceError("INVALID_TRANSITION");
  return preferenceStateSchema.parse({
    ...current,
    status: "PARSE_FAILED",
    errorCode: "EXTRACTION_FAILED",
  });
}

export function correctPreference(
  context: PreferenceContext,
  value: PreferenceState,
  input: { expectedRevisionId: string; extraction: unknown },
): PreferenceState {
  const current = preferenceStateSchema.parse(value);
  authorize(context, current);
  checkRevision(current, input.expectedRevisionId);
  if (current.extraction === null)
    throw new PreferenceError("INVALID_TRANSITION");
  const extraction = extractionSchema.parse(input.extraction);
  return preferenceStateSchema.parse({
    ...current,
    revisionId: randomUUID(),
    extraction,
    status: hasUnresolved(extraction)
      ? "NEEDS_CLARIFICATION"
      : "AWAITING_CONFIRMATION",
    confirmedAt: null,
    errorCode: null,
  });
}

export function confirmPreference(
  context: PreferenceContext,
  value: PreferenceState,
  revisionId: string,
  now: string,
): PreferenceState {
  const current = preferenceStateSchema.parse(value);
  authorize(context, current);
  checkRevision(current, revisionId);
  if (current.status === "CONFIRMED") return current;
  if (current.status === "NEEDS_CLARIFICATION")
    throw new PreferenceError("UNRESOLVED_REQUIREMENTS");
  if (current.status !== "AWAITING_CONFIRMATION")
    throw new PreferenceError("INVALID_TRANSITION");
  return preferenceStateSchema.parse({
    ...current,
    status: "CONFIRMED",
    confirmedAt: utcTimestampSchema.parse(now),
  });
}

export function preferenceProgress(value: PreferenceState | null) {
  const current = value === null ? null : preferenceStateSchema.parse(value);
  return {
    submitted: current !== null,
    confirmed: current?.status === "CONFIRMED",
  };
}

export function toEvaluationRevision(value: PreferenceState) {
  const current = preferenceStateSchema.parse(value);
  if (current.status !== "CONFIRMED" || current.extraction === null)
    throw new PreferenceError("INVALID_TRANSITION");
  return {
    participant: current.participant,
    revisionId: current.revisionId,
    confirmedRevisionId: current.revisionId,
    extraction: current.extraction,
  };
}
