import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { KILN_FLOWS } from "../constants.js";
import {
  explanationSelectionSchema,
  type ExplanationReason,
} from "../group-explanation.js";
import type { KilnAttempt } from "../kiln/client.js";
import { idSchema } from "../schemas/primitives.js";

export class GroupInsightsError extends Error {
  constructor(
    public readonly code: "EXPLANATION_IN_PROGRESS" | "STALE_EXPLANATION",
  ) {
    super(code);
  }
}

export type SavedExplanation = {
  source: "kiln" | "deterministic_fallback";
  reasonIds: ExplanationReason[];
  text: string;
  createdAt: string;
};

export type FlowUsage = {
  flow: (typeof KILN_FLOWS)[number];
  attempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  retryAttempts: number;
  unavailableUsageAttempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reportedCostUsd: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  applicationCacheHits: number;
  energyJoules: null;
};

type ExplanationRow = {
  status: "GENERATING" | "KILN" | "FALLBACK";
  reason_ids: unknown;
  explanation: string | null;
  completed_at: Date | null;
};

function savedExplanation(
  row: ExplanationRow | undefined,
): SavedExplanation | null {
  if (!row || row.status === "GENERATING") return null;
  const reasonIds = explanationSelectionSchema.parse({
    reasonIds: row.reason_ids,
  }).reasonIds;
  if (!row.explanation || !row.completed_at)
    throw new Error("Stored explanation is incomplete");
  return {
    source: row.status === "KILN" ? "kiln" : "deterministic_fallback",
    reasonIds,
    text: row.explanation,
    createdAt: row.completed_at.toISOString(),
  };
}

type UsageRow = {
  flow: string;
  attempts: number;
  successful_attempts: number;
  retry_attempts: number;
  unavailable_usage_attempts: number;
  unknown_input: number;
  unknown_output: number;
  unknown_total: number;
  unknown_cost: number;
  unknown_cached: number;
  unknown_reasoning: number;
  input_tokens: string | null;
  output_tokens: string | null;
  total_tokens: string | null;
  reported_cost_usd: string | null;
  cached_input_tokens: string | null;
  reasoning_tokens: string | null;
};

function measured(value: string | null, unknown: number, attempts: number) {
  return attempts === 0 || unknown > 0 || value === null ? null : Number(value);
}

export function usageRowsToFlows(
  rows: UsageRow[],
  explanationCacheHits: number,
): FlowUsage[] {
  const byFlow = new Map(rows.map((row) => [row.flow, row]));
  return KILN_FLOWS.map((flow) => {
    const row = byFlow.get(flow);
    const attempts = row?.attempts ?? 0;
    const successfulAttempts = row?.successful_attempts ?? 0;
    return {
      flow,
      attempts,
      successfulAttempts,
      failedAttempts: attempts - successfulAttempts,
      retryAttempts: row?.retry_attempts ?? 0,
      unavailableUsageAttempts: row?.unavailable_usage_attempts ?? 0,
      inputTokens: measured(
        row?.input_tokens ?? null,
        row?.unknown_input ?? 0,
        attempts,
      ),
      outputTokens: measured(
        row?.output_tokens ?? null,
        row?.unknown_output ?? 0,
        attempts,
      ),
      totalTokens: measured(
        row?.total_tokens ?? null,
        row?.unknown_total ?? 0,
        attempts,
      ),
      reportedCostUsd: measured(
        row?.reported_cost_usd ?? null,
        row?.unknown_cost ?? 0,
        attempts,
      ),
      cachedInputTokens: measured(
        row?.cached_input_tokens ?? null,
        row?.unknown_cached ?? 0,
        attempts,
      ),
      reasoningTokens: measured(
        row?.reasoning_tokens ?? null,
        row?.unknown_reasoning ?? 0,
        attempts,
      ),
      applicationCacheHits:
        flow === "decision_explanation" ? explanationCacheHits : 0,
      energyJoules: null,
    };
  });
}

export class GroupInsightsRepository {
  constructor(private readonly pool: Pool) {}

  async getExplanation(evaluationId: string): Promise<SavedExplanation | null> {
    const result = await this.pool.query<ExplanationRow>(
      `SELECT status, reason_ids, explanation, completed_at
       FROM converge_group_explanations WHERE evaluation_id = $1`,
      [idSchema.parse(evaluationId)],
    );
    return savedExplanation(result.rows[0]);
  }

  async claim(groupId: string, evaluationId: string) {
    const token = randomUUID();
    const result = await this.pool.query<{ claim_token: string }>(
      `INSERT INTO converge_group_explanations
         (evaluation_id, group_id, status, claim_token, lease_until)
       VALUES ($1, $2, 'GENERATING', $3, now() + interval '3 minutes')
       ON CONFLICT (evaluation_id) DO UPDATE SET
         claim_token = EXCLUDED.claim_token,
         lease_until = EXCLUDED.lease_until
       WHERE converge_group_explanations.status = 'GENERATING'
         AND converge_group_explanations.lease_until < now()
       RETURNING claim_token`,
      [idSchema.parse(evaluationId), idSchema.parse(groupId), token],
    );
    if (result.rows[0]) return { kind: "claimed" as const, token };
    const cached = await this.getExplanation(evaluationId);
    if (!cached) throw new GroupInsightsError("EXPLANATION_IN_PROGRESS");
    await this.pool.query(
      `UPDATE converge_group_explanations SET cache_hits = cache_hits + 1
       WHERE evaluation_id = $1 AND status <> 'GENERATING'`,
      [evaluationId],
    );
    return { kind: "cached" as const, explanation: cached };
  }

  async recordAttempt(
    groupId: string,
    evaluationId: string,
    attempt: KilnAttempt,
  ) {
    await this.pool.query(
      `INSERT INTO converge_kiln_evaluation_attempts
         (request_id, attempt, group_id, evaluation_id, usage,
          http_status, error_code, cost_usd, cached_input_tokens, reasoning_tokens)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      [
        attempt.usage.requestId,
        attempt.usage.attempt,
        groupId,
        evaluationId,
        JSON.stringify(attempt.usage),
        attempt.httpStatus,
        attempt.errorCode,
        attempt.costUsd,
        attempt.cachedInputTokens,
        attempt.reasoningTokens,
      ],
    );
  }

  async complete(
    evaluationId: string,
    token: string,
    source: "KILN" | "FALLBACK",
    reasonIds: ExplanationReason[],
    text: string,
  ) {
    const result = await this.pool.query<ExplanationRow>(
      `UPDATE converge_group_explanations SET status = $3, reason_ids = $4::jsonb,
         explanation = $5, completed_at = now(), lease_until = now()
       WHERE evaluation_id = $1 AND claim_token = $2 AND status = 'GENERATING'
       RETURNING status, reason_ids, explanation, completed_at`,
      [evaluationId, token, source, JSON.stringify(reasonIds), text],
    );
    const saved = savedExplanation(result.rows[0]);
    if (!saved) throw new GroupInsightsError("STALE_EXPLANATION");
    return saved;
  }

  async getUsage(groupId: string): Promise<FlowUsage[]> {
    const group = idSchema.parse(groupId);
    const [result, cache] = await Promise.all([
      this.pool.query<UsageRow>(
        `WITH attempts AS (
           SELECT request_id, usage, cost_usd, cached_input_tokens, reasoning_tokens
             FROM converge_kiln_attempts WHERE group_id = $1
           UNION ALL
           SELECT request_id, usage, cost_usd, cached_input_tokens, reasoning_tokens
             FROM converge_kiln_evaluation_attempts WHERE group_id = $1
         )
         SELECT usage->>'flow' AS flow, count(*)::int AS attempts,
           count(*) FILTER (WHERE usage->>'status' = 'success')::int AS successful_attempts,
           count(*) FILTER (WHERE (usage->>'attempt')::int > 1)::int AS retry_attempts,
           count(*) FILTER (WHERE usage->>'usageSource' = 'unavailable')::int AS unavailable_usage_attempts,
           count(*) FILTER (WHERE usage->>'inputTokens' IS NULL)::int AS unknown_input,
           count(*) FILTER (WHERE usage->>'outputTokens' IS NULL)::int AS unknown_output,
           count(*) FILTER (WHERE usage->>'totalTokens' IS NULL)::int AS unknown_total,
           count(*) FILTER (WHERE cost_usd IS NULL)::int AS unknown_cost,
           count(*) FILTER (WHERE cached_input_tokens IS NULL)::int AS unknown_cached,
           count(*) FILTER (WHERE reasoning_tokens IS NULL)::int AS unknown_reasoning,
           sum((usage->>'inputTokens')::bigint)::text AS input_tokens,
           sum((usage->>'outputTokens')::bigint)::text AS output_tokens,
           sum((usage->>'totalTokens')::bigint)::text AS total_tokens,
           sum(cost_usd)::text AS reported_cost_usd,
           sum(cached_input_tokens)::text AS cached_input_tokens,
           sum(reasoning_tokens)::text AS reasoning_tokens
         FROM attempts GROUP BY usage->>'flow'`,
        [group],
      ),
      this.pool.query<{ cache_hits: string }>(
        `SELECT coalesce(sum(cache_hits), 0)::text AS cache_hits
         FROM converge_group_explanations WHERE group_id = $1`,
        [group],
      ),
    ]);
    return usageRowsToFlows(
      result.rows,
      Number(cache.rows[0]?.cache_hits ?? 0),
    );
  }
}
