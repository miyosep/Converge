import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { KILN_FLOWS, KILN_MODEL } from "../constants.js";
import { idSchema } from "../schemas/primitives.js";
import { kilnUsageSchema, type KilnUsage } from "../schemas/shared.js";

export const KILN_BASE_URL = "https://api.bricksum.com/v1";
export type KilnAttempt = {
  usage: KilnUsage;
  httpStatus: number | null;
  errorCode: string | null;
  costUsd: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  energyJoules: null;
};
export class KilnError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = false,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(`Kiln request failed: ${code}`);
    this.name = "KilnError";
  }
}
type Message = { role: "system" | "user"; content: string };
type Request<T> = {
  runId: string;
  flow: (typeof KILN_FLOWS)[number];
  promptVersion: string;
  messages: Message[];
  schema: z.ZodType<T>;
  maxTokens?: number;
};
const requestMetadataSchema = z.object({
  runId: idSchema,
  flow: z.enum(KILN_FLOWS),
  promptVersion: idSchema,
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["system", "user"]),
        content: z.string().min(1).max(16000),
      }),
    )
    .min(1)
    .max(4),
  maxTokens: z.number().int().min(16).max(4096).optional(),
});
const envelopeSchema = z.object({
  id: z.string().optional(),
  model: z.literal(KILN_MODEL),
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.literal("assistant"),
          content: z.string().nullable(),
          tool_calls: z.array(z.unknown()).optional(),
        }),
        finish_reason: z.string().nullable(),
      }),
    )
    .length(1),
  usage: z
    .object({
      prompt_tokens: z.unknown().optional(),
      completion_tokens: z.unknown().optional(),
      total_tokens: z.unknown().optional(),
      cost: z.unknown().optional(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.unknown().optional() })
        .optional(),
      completion_tokens_details: z
        .object({ reasoning_tokens: z.unknown().optional() })
        .optional(),
    })
    .optional(),
});
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const requestId = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : null;

async function boundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > limit) {
    await response.body?.cancel();
    throw new KilnError("RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new KilnError("EMPTY_RESPONSE");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new KilnError("RESPONSE_TOO_LARGE");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function retryDelay(response: Response): number | null {
  const after = response.headers.get("retry-after");
  const reset = response.headers.get("x-ratelimit-reset");
  if (after !== null) {
    const seconds = Number(after);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(after) - Date.now();
    if (Number.isFinite(delay)) return Math.max(0, delay);
  }
  if (reset !== null && Number.isFinite(Number(reset)))
    return Math.max(0, Number(reset) * 1000);
  return null;
}

export function createKilnClient(config: {
  apiKey: string;
  baseUrl?: string;
  onAttempt: (attempt: KilnAttempt) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}) {
  if ("window" in globalThis) throw new KilnError("SERVER_ONLY");
  if (!config.apiKey.trim() || /\s/.test(config.apiKey))
    throw new KilnError("INVALID_API_KEY_CONFIGURATION");
  if ((config.baseUrl ?? KILN_BASE_URL).replace(/\/$/, "") !== KILN_BASE_URL)
    throw new KilnError("UNVERIFIED_PROVIDER_URL");
  const maxAttempts = config.maxAttempts ?? 2;
  const timeoutMs = config.timeoutMs ?? 45_000;
  const maxResponseBytes = config.maxResponseBytes ?? 262_144;
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 3 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000 ||
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 1_048_576
  )
    throw new KilnError("INVALID_LIMIT_CONFIGURATION");
  const fetchImpl = config.fetchImpl ?? fetch;
  const wait = config.wait ?? ((ms: number) => sleep(ms));

  return {
    async complete<T>(request: Request<T>): Promise<T> {
      requestMetadataSchema.parse(request);
      const localRequestId = randomUUID();
      let repair = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const started = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let inputTokens: number | null = null,
          outputTokens: number | null = null,
          totalTokens: number | null = null;
        let costUsd: number | null = null,
          cachedInputTokens: number | null = null,
          reasoningTokens: number | null = null;
        let providerRequestId: string | null = null,
          httpStatus: number | null = null;
        let failure: KilnError | undefined;
        let output: T | undefined;
        try {
          const messages: Message[] = repair
            ? [
                {
                  role: "system",
                  content:
                    "The prior response failed schema validation. Return only one valid JSON value matching the requested schema, with no markdown or extra keys.",
                },
                ...request.messages,
              ]
            : request.messages;
          const response = await fetchImpl(
            `${KILN_BASE_URL}/chat/completions`,
            {
              method: "POST",
              redirect: "error",
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: KILN_MODEL,
                messages,
                stream: false,
                max_tokens: request.maxTokens ?? 2048,
              }),
            },
          );
          httpStatus = response.status;
          providerRequestId = requestId(
            response.headers.get("x-neocloud-generation-id"),
          );
          if (!response.ok) {
            await response.body?.cancel();
            throw new KilnError(
              `HTTP_${response.status}`,
              response.status === 429 || response.status >= 500,
              retryDelay(response),
            );
          }
          const text = await boundedText(response, maxResponseBytes);
          let decoded: unknown;
          try {
            decoded = JSON.parse(text);
          } catch {
            throw new KilnError("INVALID_ENVELOPE");
          }
          const parsed = envelopeSchema.safeParse(decoded);
          if (!parsed.success) throw new KilnError("INVALID_ENVELOPE");
          const envelope = parsed.data;
          providerRequestId ??= requestId(envelope.id);
          inputTokens = count(envelope.usage?.prompt_tokens);
          outputTokens = count(envelope.usage?.completion_tokens);
          totalTokens = count(envelope.usage?.total_tokens);
          const cost = envelope.usage?.cost;
          costUsd =
            typeof cost === "number" && Number.isFinite(cost) && cost >= 0
              ? cost
              : null;
          cachedInputTokens = count(
            envelope.usage?.prompt_tokens_details?.cached_tokens,
          );
          reasoningTokens = count(
            envelope.usage?.completion_tokens_details?.reasoning_tokens,
          );
          const choice = envelope.choices[0]!;
          if (
            choice.finish_reason !== "stop" ||
            choice.message.tool_calls?.length
          )
            throw new KilnError("UNEXPECTED_FINISH");
          if (!choice.message.content?.trim())
            throw new KilnError("EMPTY_CONTENT");
          let content: unknown;
          try {
            content = JSON.parse(choice.message.content);
          } catch {
            throw new KilnError("INVALID_JSON");
          }
          const result = request.schema.safeParse(content);
          if (!result.success) throw new KilnError("INVALID_OUTPUT");
          output = result.data;
        } catch (error) {
          failure =
            error instanceof KilnError
              ? error
              : new KilnError(
                  controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
                  true,
                );
        } finally {
          clearTimeout(timer);
        }
        const completed = Date.now();
        const unavailable = [inputTokens, outputTokens, totalTokens].every(
          (value) => value === null,
        );
        const status = !failure
          ? "success"
          : failure.code.startsWith("HTTP_") ||
              failure.code === "TIMEOUT" ||
              failure.code === "NETWORK_ERROR"
            ? "provider_error"
            : "validation_error";
        await config.onAttempt({
          usage: kilnUsageSchema.parse({
            runId: request.runId,
            requestId: localRequestId,
            providerRequestId,
            flow: request.flow,
            model: KILN_MODEL,
            attempt,
            status,
            inputTokens,
            outputTokens,
            totalTokens,
            usageSource: unavailable ? "unavailable" : "provider",
            startedAt: new Date(started)
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z"),
            completedAt: new Date(completed)
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z"),
            latencyMs: Math.max(0, completed - started),
            promptVersion: request.promptVersion,
            schemaVersion: 1,
          }),
          httpStatus,
          errorCode: failure?.code ?? null,
          costUsd,
          cachedInputTokens,
          reasoningTokens,
          energyJoules: null,
        });
        if (!failure) return output as T;
        const canRepair =
          !repair && ["INVALID_JSON", "INVALID_OUTPUT"].includes(failure.code);
        if (attempt === maxAttempts || (!failure.retryable && !canRepair))
          throw failure;
        if (canRepair) repair = true;
        else {
          const delay = failure.retryAfterMs ?? 250 * 2 ** (attempt - 1);
          if (delay > 5000) throw failure;
          await wait(delay);
        }
      }
      throw new KilnError("ATTEMPTS_EXHAUSTED");
    },
  };
}
export type KilnClient = ReturnType<typeof createKilnClient>;
