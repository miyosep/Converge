import { randomUUID, createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { addressSchema, idSchema } from "../schemas/primitives.js";
import {
  discoveryRequestSchema,
  type DiscoveryResult,
} from "../discovery/types.js";
import {
  livePlanRequestSchema,
  unanimousPlace,
  type LivePlan,
} from "../discovery/live-plan.js";
import type { GroupPolicyConfig } from "../group-policy.js";
import { hashPolicy, policySchema } from "../signing-policy.js";
import {
  livePreferenceSchema,
  type LivePreference,
} from "../discovery/group-preferences.js";

import {
  buildLivePayment,
  livePaymentTermsSchema,
} from "../discovery/live-payment";

export class LivePlanError extends Error {}
const wallet = (value: string) => addressSchema.parse(value).toLowerCase();

async function transaction<T>(
  pool: Pool,
  work: (db: PoolClient) => Promise<T>,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export class LivePlanRepository {
  constructor(private readonly pool: Pool) {}
  async recordUsage(
    groupId: string,
    attempt: import("../kiln/client.js").KilnAttempt,
  ) {
    await this.pool.query(
      "INSERT INTO converge_live_usage(group_id,request_id,attempt,usage) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING",
      [
        groupId,
        attempt.usage.requestId,
        attempt.usage.attempt,
        JSON.stringify(attempt),
      ],
    );
  }
  async saveSearch(actor: string, request: unknown, result: DiscoveryResult) {
    const input = discoveryRequestSchema.parse(request);
    const searchId = randomUUID();
    await this.pool.query(
      "INSERT INTO converge_discovery_searches(id,owner_wallet,request,result) VALUES($1,$2,$3::jsonb,$4::jsonb)",
      [searchId, wallet(actor), JSON.stringify(input), JSON.stringify(result)],
    );
    return { ...result, searchId };
  }
  async latestSearch(actor: string) {
    const row = (
      await this.pool.query(
        "SELECT id,request,result,selected_place_ids FROM converge_discovery_searches WHERE owner_wallet=$1 AND request->>'scope'='general' ORDER BY created_at DESC,id DESC LIMIT 1",
        [wallet(actor)],
      )
    ).rows[0];
    return row
      ? {
          request: row.request,
          result: { ...row.result, searchId: row.id },
          selectedPlaceIds: row.selected_place_ids,
        }
      : null;
  }
  async select(actor: string, searchId: string, placeIds: string[]) {
    idSchema.parse(searchId);
    z.array(z.string().min(1).max(100)).max(5).parse(placeIds);
    const row = (
      await this.pool.query(
        "SELECT result FROM converge_discovery_searches WHERE id=$1 AND owner_wallet=$2",
        [searchId, wallet(actor)],
      )
    ).rows[0];
    if (
      !row ||
      new Set(placeIds).size !== placeIds.length ||
      placeIds.some(
        (id) =>
          !(row.result as DiscoveryResult).places.some(
            (place) => place.id === id,
          ),
      )
    )
      throw new LivePlanError("SEARCH_NOT_FOUND");
    await this.pool.query(
      "UPDATE converge_discovery_searches SET selected_place_ids=$3::jsonb WHERE id=$1 AND owner_wallet=$2",
      [searchId, wallet(actor), JSON.stringify(placeIds)],
    );
  }
  async create(actor: string, raw: unknown, _legacyMerchant?: `0x${string}`) {
    const input = livePlanRequestSchema.parse(raw);
    const creator = wallet(actor);
    if (Date.parse(input.slot.startsAt) <= Date.now() + 60_000)
      throw new LivePlanError("RESERVATION_PASSED");
    return transaction(this.pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `live-create:${input.requestId}`,
      ]);
      const existing = (
        await db.query(
          "SELECT g.id,g.creator_wallet FROM converge_groups g JOIN converge_live_plans l ON l.group_id=g.id WHERE g.id=$1",
          [input.requestId],
        )
      ).rows[0];
      if (existing) {
        if (existing.creator_wallet !== creator)
          throw new LivePlanError("NOT_MEMBER");
        return existing.id as string;
      }
      let searchId: string | null = null;
      let snapshot: Omit<LivePlan, "votes">;
      if ("searchId" in input) {
        searchId = input.searchId;
        const row = (
          await db.query(
            "SELECT request,result FROM converge_discovery_searches WHERE id=$1 AND owner_wallet=$2",
            [input.searchId, creator],
          )
        ).rows[0];
        if (!row) throw new LivePlanError("SEARCH_NOT_FOUND");
        const result = row.result as DiscoveryResult;
        const places = input.placeIds.map((id) =>
          result.places.find((place) => place.id === id),
        );
        if (
          result.intent.clarifications.length ||
          places.some((place) => !place)
        )
          throw new LivePlanError("INVALID_SHORTLIST");
        snapshot = {
          recommendationReady: false,
          category: row.request.category,
          places: places as LivePlan["places"],
          intent: result.intent,
          source: result.source,
          searchedAt: result.searchedAt,
          depositUsdc: null,
          merchant: null,
        };
      } else {
        snapshot = {
          recommendationReady: false,
          category: input.category,
          places: [],
          intent: {
            area: input.location,
            cuisine: "",
            koreanQuery: "",
            budget: null,
            people: input.targetMemberCount,
            facilities: [],
            otherRequirements: [],
            clarifications: [],
          },
          source: "xAPI (Google Maps)",
          searchedAt: "",
          depositUsdc: null,
          merchant: null,
        };
      }
      const groupId = input.requestId;
      await db.query(
        "INSERT INTO converge_groups(id,name,reservation_starts_at,reservation_time_zone,creator_wallet,target_member_count) VALUES($1,$2,$3,$4,$5,$6)",
        [
          groupId,
          input.name,
          input.slot.startsAt,
          input.slot.timeZone,
          creator,
          input.targetMemberCount,
        ],
      );
      await db.query(
        "INSERT INTO converge_participants(group_id,wallet_address,display_name) VALUES($1,$2,$3)",
        [groupId, creator, input.displayName],
      );
      await db.query(
        "INSERT INTO converge_live_plans(group_id,search_id,snapshot) VALUES($1,$2,$3::jsonb)",
        [groupId, searchId, JSON.stringify(snapshot)],
      );
      if ("initialPreferences" in input && input.initialPreferences) {
        await db.query(
          "INSERT INTO converge_live_preferences(group_id,wallet_address,revision_id,raw_text,status) VALUES($1,$2,$3,$4,'draft')",
          [groupId, creator, randomUUID(), input.initialPreferences],
        );
      }
      return groupId;
    });
  }
  private async lock(db: PoolClient, groupId: string, actor: string) {
    idSchema.parse(groupId);
    const row = (
      await db.query(
        `SELECT g.*,l.snapshot,l.votes,l.search_token,l.search_started_at FROM converge_groups g
      JOIN converge_live_plans l ON l.group_id=g.id
      JOIN converge_participants p ON p.group_id=g.id AND p.wallet_address=$2
      WHERE g.id=$1 FOR UPDATE OF g,l`,
        [groupId, wallet(actor)],
      )
    ).rows[0];
    if (!row) throw new LivePlanError("NOT_MEMBER");
    return row;
  }
  private async invalidate(db: PoolClient, groupId: string) {
    await db.query(
      'UPDATE converge_live_plans SET votes=\'{}\',snapshot=snapshot || \'{"recommendationReady":false,"recommendationStatus":"idle","conflicts":[]}\'::jsonb,search_token=NULL,search_started_at=NULL WHERE group_id=$1',
      [groupId],
    );
  }
  async ownPreference(
    groupId: string,
    actor: string,
  ): Promise<LivePreference | null> {
    idSchema.parse(groupId);
    const result = await this.pool.query(
      `SELECT v.* FROM converge_participants p JOIN converge_live_plans l USING(group_id)
      LEFT JOIN converge_live_preferences v USING(group_id,wallet_address) WHERE p.group_id=$1 AND p.wallet_address=$2`,
      [groupId, wallet(actor)],
    );
    if (!result.rowCount) throw new LivePlanError("NOT_MEMBER");
    const row = result.rows[0];
    return row.revision_id
      ? {
          revisionId: row.revision_id,
          rawText: row.raw_text,
          extraction: row.extraction,
          confirmed: row.confirmed,
          status: row.status,
        }
      : null;
  }
  async submitPreference(
    groupId: string,
    actor: string,
    text: string,
    expectedRevisionId: string | null,
  ) {
    const raw = z.string().trim().min(1).max(2000).parse(text);
    return transaction(this.pool, async (db) => {
      const group = await this.lock(db, groupId, actor);
      if (group.preferences_locked) throw new LivePlanError("GROUP_LOCKED");
      const previous = (
        await db.query(
          "SELECT revision_id FROM converge_live_preferences WHERE group_id=$1 AND wallet_address=$2",
          [groupId, wallet(actor)],
        )
      ).rows[0];
      if ((previous?.revision_id ?? null) !== expectedRevisionId)
        throw new LivePlanError("STALE_REVISION");
      const revisionId = randomUUID();
      await db.query(
        `INSERT INTO converge_live_preferences(group_id,wallet_address,revision_id,raw_text,status) VALUES($1,$2,$3,$4,'extracting')
        ON CONFLICT(group_id,wallet_address) DO UPDATE SET revision_id=$3,raw_text=$4,extraction=NULL,confirmed=false,status='extracting'`,
        [groupId, wallet(actor), revisionId, raw],
      );
      await this.invalidate(db, groupId);
      return {
        revisionId,
        rawText: raw,
        category: group.snapshot.category,
        area: group.snapshot.intent.area,
        people: group.target_member_count,
        startsAt: group.reservation_starts_at.toISOString(),
        timeZone: group.reservation_time_zone,
      };
    });
  }
  async completePreference(
    groupId: string,
    actor: string,
    revisionId: string,
    extraction: unknown | null,
  ) {
    const parsed =
      extraction === null ? null : livePreferenceSchema.parse(extraction);
    await transaction(this.pool, async (db) => {
      const group = await this.lock(db, groupId, actor);
      if (group.preferences_locked) throw new LivePlanError("GROUP_LOCKED");
      const result = await db.query(
        "UPDATE converge_live_preferences SET extraction=$4::jsonb,status=$5 WHERE group_id=$1 AND wallet_address=$2 AND revision_id=$3 AND status='extracting'",
        [
          groupId,
          wallet(actor),
          revisionId,
          parsed ? JSON.stringify(parsed) : null,
          parsed ? "review" : "failed",
        ],
      );
      if (!result.rowCount) throw new LivePlanError("STALE_REVISION");
    });
    return this.ownPreference(groupId, actor);
  }
  async confirmPreference(groupId: string, actor: string, revisionId: string) {
    await transaction(this.pool, async (db) => {
      const group = await this.lock(db, groupId, actor);
      if (group.preferences_locked) throw new LivePlanError("GROUP_LOCKED");
      const row = (
        await db.query(
          "SELECT * FROM converge_live_preferences WHERE group_id=$1 AND wallet_address=$2 AND revision_id=$3",
          [groupId, wallet(actor), revisionId],
        )
      ).rows[0];
      if (
        !row ||
        row.status !== "review" ||
        !row.extraction ||
        livePreferenceSchema.parse(row.extraction).clarifications.length
      )
        throw new LivePlanError("PREFERENCES_NOT_READY");
      if (row.confirmed) return;
      await db.query(
        "UPDATE converge_live_preferences SET confirmed=true WHERE group_id=$1 AND wallet_address=$2",
        [groupId, wallet(actor)],
      );
      await this.invalidate(db, groupId);
    });
    return this.ownPreference(groupId, actor);
  }
  private async confirmedPreferences(
    db: PoolClient,
    groupId: string,
    target: number,
  ) {
    const rows = (
      await db.query(
        `SELECT p.wallet_address,v.revision_id,v.extraction,v.confirmed FROM converge_participants p
      LEFT JOIN converge_live_preferences v USING(group_id,wallet_address) WHERE p.group_id=$1 ORDER BY p.wallet_address`,
        [groupId],
      )
    ).rows;
    if (
      rows.length !== target ||
      rows.some((row) => !row.confirmed || !row.extraction)
    )
      throw new LivePlanError("PREFERENCES_NOT_CONFIRMED");
    const preferences = rows.map((row) =>
      livePreferenceSchema.parse(row.extraction),
    );
    if (preferences.some((item) => item.clarifications.length))
      throw new LivePlanError("PREFERENCES_NOT_CONFIRMED");
    return {
      preferences,
      revision: createHash("sha256")
        .update(
          JSON.stringify(
            rows.map((row) => [row.wallet_address, row.revision_id]),
          ),
        )
        .digest("hex"),
    };
  }
  async beginRecommendation(groupId: string, actor: string) {
    return transaction(this.pool, async (db) => {
      const row = await this.lock(db, groupId, actor);
      if (row.preferences_locked) throw new LivePlanError("GROUP_LOCKED");
      if (
        row.search_token &&
        Date.now() - row.search_started_at.getTime() < 240000
      )
        throw new LivePlanError("SEARCH_IN_PROGRESS");
      const confirmed = await this.confirmedPreferences(
        db,
        groupId,
        row.target_member_count,
      );
      const token = randomUUID();
      await this.invalidate(db, groupId);
      await db.query(
        "UPDATE converge_live_plans SET search_token=$2,search_started_at=now() WHERE group_id=$1",
        [groupId, token],
      );
      return {
        ...confirmed,
        token,
        area: row.snapshot.intent.area,
        category: row.snapshot.category,
        people: row.target_member_count,
        startsAt: row.reservation_starts_at.toISOString(),
      };
    });
  }
  async completeRecommendation(
    groupId: string,
    actor: string,
    token: string,
    revision: string,
    result: {
      places: LivePlan["places"];
      searchedAt: string;
      conflicts: string[];
    } | null,
  ) {
    await transaction(this.pool, async (db) => {
      const row = await this.lock(db, groupId, actor);
      if (row.preferences_locked || row.search_token !== token)
        throw new LivePlanError("STALE_RECOMMENDATION");
      if (
        result &&
        (await this.confirmedPreferences(db, groupId, row.target_member_count))
          .revision !== revision
      )
        throw new LivePlanError("STALE_RECOMMENDATION");
      const snapshot = {
        ...row.snapshot,
        places: result?.places ?? [],
        searchedAt: result?.searchedAt ?? row.snapshot.searchedAt,
        source: "xAPI (Google Maps)",
        recommendationReady:
          result?.places.length === 1 && !result.conflicts.length,
        recommendationStatus: !result
          ? "failed"
          : result.conflicts.length
            ? "blocked"
            : result.places.length === 1
              ? "ready"
              : "empty",
        recommendationRevision: token,
        preferenceRevision: revision,
        conflicts: result?.conflicts ?? [],
      };
      await db.query(
        "UPDATE converge_live_plans SET snapshot=$2::jsonb,votes='{}',search_token=NULL,search_started_at=NULL WHERE group_id=$1",
        [groupId, JSON.stringify(snapshot)],
      );
    });
  }
  async vote(
    groupId: string,
    actor: string,
    placeId: string,
    recommendationRevision: string,
  ) {
    z.string().min(1).max(100).parse(placeId);
    await transaction(this.pool, async (db) => {
      const row = await this.lock(db, groupId, actor);
      if (row.preferences_locked) throw new LivePlanError("GROUP_LOCKED");
      if (
        (row.snapshot as LivePlan).places.length !== 1 ||
        !row.snapshot.recommendationReady ||
        row.snapshot.recommendationRevision !== recommendationRevision
      )
        throw new LivePlanError("STALE_RECOMMENDATION");
      if (
        !(row.snapshot as LivePlan).places.some((place) => place.id === placeId)
      )
        throw new LivePlanError("INVALID_SHORTLIST");
      if (row.reservation_starts_at.getTime() <= Date.now() + 60_000)
        throw new LivePlanError("RESERVATION_PASSED");
      await db.query(
        "UPDATE converge_live_plans SET votes=votes || $2::jsonb WHERE group_id=$1",
        [groupId, JSON.stringify({ [wallet(actor)]: placeId })],
      );
    });
  }
  async prepare(
    groupId: string,
    actor: string,
    config: GroupPolicyConfig,
    rawTerms?: unknown,
  ) {
    return transaction(this.pool, async (db) => {
      const group = await this.lock(db, groupId, actor);
      const existing = (
        await db.query(
          "SELECT policy,policy_hash,created_at FROM converge_group_policies WHERE group_id=$1",
          [groupId],
        )
      ).rows[0];
      if (existing) {
        const policy = policySchema.parse(existing.policy);
        if (hashPolicy(policy) !== existing.policy_hash)
          throw new Error("Stored policy hash mismatch");
        return {
          policy,
          policyHash: existing.policy_hash,
          createdAt: existing.created_at.toISOString(),
        };
      }
      if (group.creator_wallet !== wallet(actor))
        throw new LivePlanError("NOT_CREATOR");
      if (group.preferences_locked) throw new LivePlanError("GROUP_LOCKED");
      const terms = livePaymentTermsSchema.parse(rawTerms);
      const confirmed = await this.confirmedPreferences(
        db,
        groupId,
        group.target_member_count,
      );
      if (
        (group.snapshot as LivePlan).places.length !== 1 ||
        !group.snapshot.recommendationReady ||
        group.snapshot.recommendationRevision !==
          terms.recommendationRevision ||
        group.snapshot.preferenceRevision !== confirmed.revision
      )
        throw new LivePlanError("STALE_RECOMMENDATION");
      const members = (
        await db.query(
          "SELECT wallet_address FROM converge_participants WHERE group_id=$1 ORDER BY wallet_address",
          [groupId],
        )
      ).rows.map((row) => row.wallet_address as string);
      const place = unanimousPlace(
        { ...group.snapshot, votes: group.votes },
        members,
        group.target_member_count,
      );
      if (!place || place.id !== terms.placeId)
        throw new LivePlanError("UNANIMOUS_CHOICE_REQUIRED");
      let saved;
      try {
        saved = buildLivePayment({
          terms,
          config,
          groupId,
          members,
          startsAt: group.reservation_starts_at.toISOString(),
          nowSeconds: Math.floor(Date.now() / 1000),
        });
      } catch (error) {
        throw new LivePlanError(
          error instanceof Error ? error.message : "INVALID_PAYMENT_TERMS",
        );
      }
      await db.query(
        "UPDATE converge_groups SET preferences_locked=true WHERE id=$1",
        [groupId],
      );
      await db.query(
        "UPDATE converge_live_plans SET snapshot=snapshot || $2::jsonb WHERE group_id=$1",
        [
          groupId,
          JSON.stringify({ merchant: terms.recipient, testPayment: true }),
        ],
      );
      await db.query(
        "INSERT INTO converge_group_policies(decision_id,group_id,evaluation_id,policy,policy_hash,created_at) VALUES($1,$2,NULL,$3::jsonb,$4,$5)",
        [
          saved.policy.decisionId,
          groupId,
          JSON.stringify(saved.policy),
          saved.policyHash,
          saved.createdAt,
        ],
      );
      return saved;
    });
  }
}
