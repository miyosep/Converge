import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { evaluateDecision, publicEvaluation } from "../decision-engine.js";
import type { Evaluation } from "../decision-engine.js";
import {
  savedEvaluationView,
  type GroupSummary,
  type GroupOverview,
} from "../group-view.js";
import type { RestaurantCatalog } from "../schemas/decision.js";
import {
  buildGroupPolicy,
  GroupPolicyError,
  type GroupPolicyConfig,
} from "../group-policy.js";
import { hashPolicy, policySchema } from "../policy.js";
import {
  completePreferenceExtraction,
  confirmPreference,
  correctPreference,
  failPreferenceExtraction,
  preferenceStateSchema,
  submitPreference,
  toEvaluationRevision,
  PreferenceError,
  type PreferenceContext,
  type PreferenceState,
} from "../preferences.js";
import { addressSchema, idSchema } from "../schemas/primitives.js";
import {
  reservationSlotSchema,
  type EvaluationInput,
} from "../schemas/decision.js";

export class PreferenceRepositoryError extends Error {
  constructor(
    public readonly code:
      "GROUP_NOT_FOUND" | "NOT_MEMBER" | "GROUP_FULL" | "INCOMPLETE_GROUP",
  ) {
    super(code);
    this.name = "PreferenceRepositoryError";
  }
}

type GroupRow = {
  id: string;
  preferences_locked: boolean;
  reservation_starts_at: Date;
  reservation_time_zone: string;
};
type ParticipantRow = { current_revision_id: string | null };
type RevisionRow = {
  group_id: string;
  wallet_address: string;
  revision_id: string;
  raw_text: string;
  status: PreferenceState["status"];
  extraction: unknown;
  confirmed_at: Date | null;
  error_code: PreferenceState["errorCode"];
};
const wallet = (value: string) => addressSchema.parse(value).toLowerCase();
const timestamp = (value: Date | null) =>
  value?.toISOString().replace(/\.\d{3}Z$/, "Z") ?? null;
const stateFromRow = (row: RevisionRow): PreferenceState =>
  preferenceStateSchema.parse({
    groupId: row.group_id,
    participant: row.wallet_address,
    revisionId: row.revision_id,
    rawText: row.raw_text,
    status: row.status,
    extraction: row.extraction,
    confirmedAt: timestamp(row.confirmed_at),
    errorCode: row.error_code,
  });

async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lockedContext(
  client: PoolClient,
  groupId: string,
  actor: string,
) {
  const groups = await client.query<GroupRow>(
    "SELECT id, preferences_locked FROM converge_groups WHERE id = $1 FOR UPDATE",
    [groupId],
  );
  const group = groups.rows[0];
  if (!group) throw new PreferenceRepositoryError("GROUP_NOT_FOUND");
  const participants = await client.query<ParticipantRow>(
    "SELECT current_revision_id FROM converge_participants WHERE group_id = $1 AND wallet_address = $2 FOR UPDATE",
    [groupId, actor],
  );
  const participant = participants.rows[0];
  if (!participant) throw new PreferenceRepositoryError("NOT_MEMBER");
  const context: PreferenceContext = {
    groupId,
    participant: addressSchema.parse(actor),
    preferencesLocked: group.preferences_locked,
  };
  const current =
    participant.current_revision_id === null
      ? null
      : (
          await client.query<RevisionRow>(
            "SELECT * FROM converge_preference_revisions WHERE group_id = $1 AND wallet_address = $2 AND revision_id = $3",
            [groupId, actor, participant.current_revision_id],
          )
        ).rows[0];
  if (participant.current_revision_id && !current)
    throw new Error("Missing current preference revision");
  return { context, current: current ? stateFromRow(current) : null };
}

async function saveState(
  client: PoolClient,
  value: PreferenceState,
  previous: PreferenceState | null,
) {
  const state = preferenceStateSchema.parse(value);
  const args = [
    state.groupId,
    wallet(state.participant),
    state.revisionId,
    state.rawText,
    state.status,
    state.extraction === null ? null : JSON.stringify(state.extraction),
    state.confirmedAt,
    state.errorCode,
  ];
  if (state.revisionId !== previous?.revisionId) {
    await client.query(
      `INSERT INTO converge_preference_revisions
      (group_id, wallet_address, revision_id, raw_text, status, extraction, confirmed_at, error_code)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      args,
    );
    await client.query(
      `UPDATE converge_participants SET current_revision_id = $3
      WHERE group_id = $1 AND wallet_address = $2`,
      args.slice(0, 3),
    );
  } else {
    await client.query(
      `UPDATE converge_preference_revisions SET raw_text = $4, status = $5,
      extraction = $6::jsonb, confirmed_at = $7, error_code = $8
      WHERE group_id = $1 AND wallet_address = $2 AND revision_id = $3`,
      args,
    );
  }
  return state;
}

// These methods take a wallet address already verified by the caller's session.
export class PreferenceRepository {
  constructor(private readonly pool: Pool) {}

  async listGroups(actor: string): Promise<GroupSummary[]> {
    const result = await this.pool.query<{
      id: string;
      name: string;
      reservation_starts_at: Date;
      reservation_time_zone: string;
      preferences_locked: boolean;
      member_count: number;
      confirmed_count: number;
    }>(
      `SELECT g.id, g.name, g.reservation_starts_at, g.reservation_time_zone,
        g.preferences_locked, count(p.wallet_address)::int AS member_count,
        count(*) FILTER (WHERE r.status = 'CONFIRMED')::int AS confirmed_count
       FROM converge_groups g
       JOIN converge_participants mine ON mine.group_id = g.id AND mine.wallet_address = $1
       JOIN converge_participants p ON p.group_id = g.id
       LEFT JOIN converge_preference_revisions r ON r.group_id = p.group_id
         AND r.wallet_address = p.wallet_address AND r.revision_id = p.current_revision_id
       GROUP BY g.id ORDER BY g.created_at DESC`,
      [wallet(actor)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      startsAt: timestamp(row.reservation_starts_at)!,
      timeZone: row.reservation_time_zone,
      locked: row.preferences_locked,
      memberCount: row.member_count,
      confirmedCount: row.confirmed_count,
    }));
  }

  async getOverview(groupId: string, actor: string): Promise<GroupOverview> {
    const group = idSchema.parse(groupId);
    const participant = wallet(actor);
    const result = await this.pool.query<{
      id: string;
      name: string;
      reservation_starts_at: Date;
      reservation_time_zone: string;
      preferences_locked: boolean;
      evaluation_id: string | null;
      evaluated_at: Date | null;
      internal_result: Evaluation;
      catalog: RestaurantCatalog;
      contribution: string;
      max_deposit: string;
      max_spend: string;
      evaluation_current: boolean;
      signing_policy: unknown | null;
      policy_hash: string | null;
      policy_created_at: Date | null;
    }>(
      `SELECT g.id, g.name, g.reservation_starts_at, g.reservation_time_zone,
        g.preferences_locked, e.id AS evaluation_id, e.created_at AS evaluated_at,
        e.internal_result, e.input_snapshot->'catalog' AS catalog,
        e.input_snapshot->>'contributionPerParticipant' AS contribution,
        e.input_snapshot->>'maxDeposit' AS max_deposit,
        e.input_snapshot->>'maxTotalSpend' AS max_spend,
        NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(e.internal_result->'revisions') revision
          WHERE NOT EXISTS (
            SELECT 1 FROM converge_participants current
            WHERE current.group_id = g.id AND current.wallet_address = lower(revision->>'participant')
              AND current.current_revision_id = revision->>'revisionId'
          )
        ) AS evaluation_current,
        policy.policy AS signing_policy, policy.policy_hash, policy.created_at AS policy_created_at
       FROM converge_groups g
       JOIN converge_participants p ON p.group_id = g.id AND p.wallet_address = $2
       LEFT JOIN converge_evaluations e ON e.group_id = g.id
       LEFT JOIN converge_group_policies policy ON policy.group_id = g.id
       WHERE g.id = $1`,
      [group, participant],
    );
    const row = result.rows[0];
    if (!row) throw new PreferenceRepositoryError("NOT_MEMBER");
    const participants = await this.getProgress(group, participant);
    const signingPolicy =
      row.signing_policy === null
        ? null
        : policySchema.parse(row.signing_policy);
    if (signingPolicy && hashPolicy(signingPolicy) !== row.policy_hash)
      throw new Error("Stored policy hash mismatch");
    return {
      group: {
        id: row.id,
        name: row.name,
        startsAt: timestamp(row.reservation_starts_at)!,
        timeZone: row.reservation_time_zone,
        locked: row.preferences_locked,
        memberCount: participants.length,
        confirmedCount: participants.filter((member) => member.confirmed)
          .length,
      },
      participants,
      signingPolicy: signingPolicy
        ? {
            policy: signingPolicy,
            policyHash: row.policy_hash!,
            createdAt: timestamp(row.policy_created_at)!,
          }
        : null,
      evaluation:
        row.evaluation_id && row.evaluation_current
          ? savedEvaluationView({
              id: row.evaluation_id,
              createdAt: timestamp(row.evaluated_at)!,
              result: row.internal_result,
              catalog: row.catalog,
              contributionPerParticipant: row.contribution,
              maxDeposit: row.max_deposit,
              maxTotalSpend: row.max_spend,
            })
          : null,
    };
  }

  async createGroup(input: {
    name: string;
    slot: unknown;
    creator: string;
    displayName: string;
  }) {
    const name = z.string().trim().min(1).max(100).parse(input.name);
    const displayName = z
      .string()
      .trim()
      .min(1)
      .max(80)
      .parse(input.displayName);
    const slot = reservationSlotSchema.parse(input.slot);
    const creator = wallet(input.creator);
    const id = randomUUID();
    await transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO converge_groups
        (id, name, reservation_starts_at, reservation_time_zone, creator_wallet)
        VALUES ($1, $2, $3, $4, $5)`,
        [id, name, slot.startsAt, slot.timeZone, creator],
      );
      await client.query(
        `INSERT INTO converge_participants(group_id, wallet_address, display_name)
        VALUES ($1, $2, $3)`,
        [id, creator, displayName],
      );
    });
    return id;
  }

  // Call only after the invite and wallet signature have been verified upstream.
  async addVerifiedParticipant(
    groupId: string,
    actor: string,
    displayName: string,
  ) {
    idSchema.parse(groupId);
    const participant = wallet(actor);
    const name = z.string().trim().min(1).max(80).parse(displayName);
    return transaction(this.pool, async (client) => {
      const groups = await client.query<GroupRow>(
        "SELECT id, preferences_locked FROM converge_groups WHERE id = $1 FOR UPDATE",
        [groupId],
      );
      if (!groups.rows[0])
        throw new PreferenceRepositoryError("GROUP_NOT_FOUND");
      if (groups.rows[0].preferences_locked)
        throw new PreferenceError("PREFERENCES_LOCKED");
      const existing = await client.query(
        "SELECT 1 FROM converge_participants WHERE group_id = $1 AND wallet_address = $2",
        [groupId, participant],
      );
      if (existing.rows.length) return;
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM converge_participants WHERE group_id = $1",
        [groupId],
      );
      if (Number(count.rows[0]!.count) >= 6)
        throw new PreferenceRepositoryError("GROUP_FULL");
      await client.query(
        `INSERT INTO converge_participants(group_id, wallet_address, display_name)
        VALUES ($1, $2, $3) ON CONFLICT (group_id, wallet_address) DO NOTHING`,
        [groupId, participant, name],
      );
    });
  }

  async getOwn(groupId: string, actor: string) {
    const group = idSchema.parse(groupId);
    const participant = wallet(actor);
    const result = await this.pool.query<RevisionRow>(
      `SELECT r.* FROM converge_participants p
      LEFT JOIN converge_preference_revisions r ON r.group_id = p.group_id
        AND r.wallet_address = p.wallet_address AND r.revision_id = p.current_revision_id
      WHERE p.group_id = $1 AND p.wallet_address = $2`,
      [group, participant],
    );
    if (!result.rows[0]) throw new PreferenceRepositoryError("NOT_MEMBER");
    return result.rows[0].revision_id ? stateFromRow(result.rows[0]) : null;
  }

  async getProgress(groupId: string, actor: string) {
    const group = idSchema.parse(groupId);
    const participant = wallet(actor);
    const member = await this.pool.query(
      "SELECT 1 FROM converge_participants WHERE group_id = $1 AND wallet_address = $2",
      [group, participant],
    );
    if (!member.rows.length) throw new PreferenceRepositoryError("NOT_MEMBER");
    const result = await this.pool.query<{
      wallet_address: string;
      display_name: string;
      revision_id: string | null;
      status: PreferenceState["status"] | null;
    }>(
      `SELECT p.wallet_address, p.display_name, r.revision_id, r.status
      FROM converge_participants p LEFT JOIN converge_preference_revisions r
      ON r.group_id = p.group_id AND r.wallet_address = p.wallet_address
        AND r.revision_id = p.current_revision_id
      WHERE p.group_id = $1 ORDER BY p.joined_at, p.wallet_address`,
      [group],
    );
    return result.rows.map((row) => ({
      walletAddress: addressSchema.parse(row.wallet_address),
      displayName: row.display_name,
      submitted: row.revision_id !== null,
      confirmed: row.status === "CONFIRMED",
    }));
  }

  private async mutate(
    groupId: string,
    actor: string,
    work: (
      context: PreferenceContext,
      current: PreferenceState | null,
    ) => PreferenceState,
  ) {
    const group = idSchema.parse(groupId);
    const participant = wallet(actor);
    return transaction(this.pool, async (client) => {
      const { context, current } = await lockedContext(
        client,
        group,
        participant,
      );
      const next = work(context, current);
      return saveState(client, next, current);
    });
  }

  submit(
    groupId: string,
    actor: string,
    text: string,
    expectedRevisionId: string | null,
  ) {
    return this.mutate(groupId, actor, (context, current) =>
      submitPreference(context, current, { text, expectedRevisionId }),
    );
  }
  async completeExtraction(
    groupId: string,
    actor: string,
    revisionId: string,
    output: unknown,
  ) {
    return this.mutate(groupId, actor, (context, current) => {
      if (!current) throw new PreferenceError("STALE_REVISION");
      return completePreferenceExtraction(context, current, revisionId, output);
    });
  }
  async failExtraction(groupId: string, actor: string, revisionId: string) {
    return this.mutate(groupId, actor, (context, current) => {
      if (!current) throw new PreferenceError("STALE_REVISION");
      return failPreferenceExtraction(context, current, revisionId);
    });
  }
  async correct(
    groupId: string,
    actor: string,
    expectedRevisionId: string,
    extraction: unknown,
  ) {
    return this.mutate(groupId, actor, (context, current) => {
      if (!current) throw new PreferenceError("STALE_REVISION");
      return correctPreference(context, current, {
        expectedRevisionId,
        extraction,
      });
    });
  }
  async confirm(groupId: string, actor: string, revisionId: string) {
    return this.mutate(groupId, actor, (context, current) => {
      if (!current) throw new PreferenceError("STALE_REVISION");
      return confirmPreference(
        context,
        current,
        revisionId,
        new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      );
    });
  }

  async evaluateAndFreeze(
    groupId: string,
    actor: string,
    options: Pick<
      EvaluationInput,
      | "permittedMerchants"
      | "contributionPerParticipant"
      | "maxDeposit"
      | "maxTotalSpend"
      | "catalog"
    >,
  ) {
    const group = idSchema.parse(groupId);
    const participant = wallet(actor);
    return transaction(this.pool, async (client) => {
      const groups = await client.query<GroupRow>(
        "SELECT id, preferences_locked, reservation_starts_at, reservation_time_zone FROM converge_groups WHERE id = $1 FOR UPDATE",
        [group],
      );
      if (!groups.rows[0])
        throw new PreferenceRepositoryError("GROUP_NOT_FOUND");
      const member = await client.query(
        "SELECT 1 FROM converge_participants WHERE group_id = $1 AND wallet_address = $2",
        [group, participant],
      );
      if (!member.rows.length)
        throw new PreferenceRepositoryError("NOT_MEMBER");
      if (groups.rows[0].preferences_locked) {
        const existing = await client.query<{ internal_result: Evaluation }>(
          "SELECT internal_result FROM converge_evaluations WHERE group_id = $1",
          [group],
        );
        if (!existing.rows[0])
          throw new Error("Locked group has no evaluation");
        return {
          frozen: true as const,
          publicResult: publicEvaluation(existing.rows[0].internal_result),
        };
      }
      const rows = await client.query<RevisionRow>(
        `SELECT r.* FROM converge_participants p
        LEFT JOIN converge_preference_revisions r ON r.group_id = p.group_id
          AND r.wallet_address = p.wallet_address AND r.revision_id = p.current_revision_id
        WHERE p.group_id = $1 ORDER BY p.joined_at, p.wallet_address`,
        [group],
      );
      if (
        rows.rows.length !== 6 ||
        rows.rows.some((row) => row.status !== "CONFIRMED")
      )
        throw new PreferenceRepositoryError("INCOMPLETE_GROUP");
      const snapshot = rows.rows.map((row) =>
        toEvaluationRevision(stateFromRow(row)),
      );
      const evaluationInput = {
        ...options,
        members: rows.rows.map((row) =>
          addressSchema.parse(row.wallet_address),
        ),
        preferences: snapshot,
        slot: {
          startsAt: timestamp(groups.rows[0].reservation_starts_at),
          timeZone: groups.rows[0].reservation_time_zone,
        },
      };
      const result = evaluateDecision(evaluationInput);
      await client.query(
        `INSERT INTO converge_evaluations
        (id, group_id, input_snapshot, internal_result)
        VALUES ($1, $2, $3::jsonb, $4::jsonb)
        ON CONFLICT (group_id) DO UPDATE SET input_snapshot = EXCLUDED.input_snapshot,
          internal_result = EXCLUDED.internal_result, created_at = now()`,
        [
          randomUUID(),
          group,
          JSON.stringify(evaluationInput),
          JSON.stringify(result),
        ],
      );
      if (result.status !== "PROPOSAL_READY")
        return {
          frozen: false as const,
          publicResult: publicEvaluation(result),
        };
      await client.query(
        "UPDATE converge_groups SET preferences_locked = true WHERE id = $1",
        [group],
      );
      return { frozen: true as const, publicResult: publicEvaluation(result) };
    });
  }

  async preparePolicy(
    groupId: string,
    actor: string,
    config: GroupPolicyConfig,
  ) {
    const group = idSchema.parse(groupId);
    const participant = wallet(actor);
    return transaction(this.pool, async (client) => {
      const rows = await client.query<{ preferences_locked: boolean }>(
        `SELECT g.preferences_locked FROM converge_groups g
         JOIN converge_participants p ON p.group_id = g.id AND p.wallet_address = $2
         WHERE g.id = $1 FOR UPDATE OF g`,
        [group, participant],
      );
      if (!rows.rows[0]) throw new PreferenceRepositoryError("NOT_MEMBER");
      const existing = await client.query<{
        policy: unknown;
        policy_hash: string;
        created_at: Date;
      }>(
        "SELECT policy, policy_hash, created_at FROM converge_group_policies WHERE group_id = $1",
        [group],
      );
      if (existing.rows[0]) {
        const saved = existing.rows[0];
        const policy = policySchema.parse(saved.policy);
        if (hashPolicy(policy) !== saved.policy_hash)
          throw new Error("Stored policy hash mismatch");
        return {
          policy,
          policyHash: saved.policy_hash,
          createdAt: timestamp(saved.created_at)!,
        };
      }
      if (!rows.rows[0].preferences_locked)
        throw new GroupPolicyError("NO_PROPOSAL");
      const evaluations = await client.query<{
        id: string;
        input_snapshot: unknown;
        internal_result: Evaluation;
      }>(
        "SELECT id, input_snapshot, internal_result FROM converge_evaluations WHERE group_id = $1",
        [group],
      );
      const evaluation = evaluations.rows[0];
      if (!evaluation) throw new GroupPolicyError("NO_PROPOSAL");
      const saved = buildGroupPolicy({
        groupId: group,
        evaluationId: evaluation.id,
        decisionNonce: randomUUID(),
        snapshot: evaluation.input_snapshot,
        expectedWinner: evaluation.internal_result.winnerId,
        config,
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      await client.query(
        `INSERT INTO converge_group_policies (decision_id, group_id, evaluation_id, policy, policy_hash, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [
          saved.policy.decisionId,
          group,
          evaluation.id,
          JSON.stringify(saved.policy),
          saved.policyHash,
          saved.createdAt,
        ],
      );
      return saved;
    });
  }
}
