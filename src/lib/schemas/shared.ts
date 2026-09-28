import { z } from "zod";
import {
  DECISION_STATUSES,
  KILN_FLOWS,
  KILN_MODEL,
  MVP_PARTICIPANT_COUNT,
  WORKFLOW_STATUSES,
} from "../constants.js";
import { addressSchema, idSchema, utcTimestampSchema } from "./primitives.js";

export const participantAddressesSchema = z
  .array(addressSchema)
  .length(MVP_PARTICIPANT_COUNT)
  .refine(
    (values) =>
      new Set(values.map((value) => value.toLowerCase())).size ===
      values.length,
    "Participants must have distinct wallet addresses",
  );
export const decisionStatusSchema = z.enum(DECISION_STATUSES);
export const workflowStatusSchema = z.enum(WORKFLOW_STATUSES);

// Only this projection belongs in shared lobby responses, not private inputs.
export const participantProgressSchema = z
  .strictObject({
    id: idSchema,
    displayName: z.string().trim().min(1).max(80),
    walletAddress: addressSchema,
    submitted: z.boolean(),
    confirmed: z.boolean(),
  })
  .refine(
    (value) => !value.confirmed || value.submitted,
    "Confirmation requires submission",
  );

export const apiErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(500),
  requestId: idSchema,
  retryable: z.boolean(),
});

const tokenCount = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
export const kilnUsageSchema = z
  .strictObject({
    runId: idSchema,
    requestId: idSchema,
    providerRequestId: idSchema.nullable(),
    flow: z.enum(KILN_FLOWS),
    model: z.literal(KILN_MODEL),
    attempt: z.number().int().positive(),
    status: z.enum(["success", "provider_error", "validation_error"]),
    inputTokens: tokenCount,
    outputTokens: tokenCount,
    totalTokens: tokenCount,
    usageSource: z.enum(["provider", "unavailable"]),
    startedAt: utcTimestampSchema,
    completedAt: utcTimestampSchema,
    latencyMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    promptVersion: idSchema,
    schemaVersion: z.number().int().positive(),
  })
  .superRefine((value, context) => {
    if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Completion precedes start",
      });
    }
    const counts = [value.inputTokens, value.outputTokens, value.totalTokens];
    if (
      (value.usageSource === "unavailable") !==
      counts.every((count) => count === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usageSource"],
        message: "Usage source must match the available counts",
      });
    }
  });

export type ParticipantProgress = z.infer<typeof participantProgressSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type KilnUsage = z.infer<typeof kilnUsageSchema>;
