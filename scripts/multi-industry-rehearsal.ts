import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { PreferenceRepository } from "../src/lib/db/preferences.js";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import {
  groupEvaluationOptions,
  currentGroupPolicyConfig,
} from "../src/lib/server/group-config.js";
import { hashPolicy } from "../src/lib/signing-policy.js";
import { optionsForCategory } from "../src/lib/catalog-options.js";

if (process.env.NEON_BRANCH !== "dev-preferences")
  throw new Error("Restricted to the dev-preferences database branch");
const pool = new Pool({
  connectionString: verifiedPostgresUrl(process.env.DATABASE_URL!),
  connectionTimeoutMillis: 15000,
});
const repo = new PreferenceRepository(pool);
const created: string[] = [];
try {
  for (const category of ["stay", "space", "sport", "class"] as const) {
    const members = Array.from(
      { length: 2 },
      () => `0x${randomBytes(20).toString("hex")}`,
    );
    const slot = {
      startsAt: new Date(Date.now() + 172800000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
      timeZone: "Asia/Seoul",
    };
    const group = await repo.createGroup({
      name: `Synthetic ${category} rehearsal`,
      creator: members[0]!,
      displayName: "Synthetic owner",
      targetMemberCount: 2,
      slot,
      permittedRestaurantIds: optionsForCategory(category).map(
        (item) => item.id,
      ),
    });
    created.push(group);
    await repo.addVerifiedParticipant(group, members[1]!, "Synthetic member");
    const facility =
      category === "stay"
        ? "pet_friendly"
        : category === "space"
          ? "projector"
          : category === "sport"
            ? "equipment_rental"
            : "beginner_friendly";
    for (const member of members) {
      const preference = await repo.submit(
        group,
        member,
        `Synthetic ${category} with ${facility}`,
        null,
      );
      await repo.completeExtraction(group, member, preference.revisionId, {
        schemaVersion: 1,
        constraints: [
          {
            type: "non_negotiable",
            field: "facility_requirement",
            value: facility,
          },
        ],
        clarifications: [],
        unsupportedRequirements: [],
      });
      await repo.confirm(group, member, preference.revisionId);
    }
    const before = await repo.getOverview(group, members[0]!);
    assert.equal(before.group.category, category);
    assert.equal(before.group.permittedRestaurantIds!.length, 40);
    assert.equal(
      (await repo.listGroups(members[0]!)).find((item) => item.id === group)!
        .category,
      category,
    );
    const options = groupEvaluationOptions(
      slot.startsAt,
      before.group.category,
    );
    await repo.evaluateAndFreeze(group, members[0]!, options);
    await repo.preparePolicy(group, members[0]!, currentGroupPolicyConfig());
    const saved = await repo.getOverview(group, members[1]!);
    assert.equal(saved.group.locked, true);
    assert.equal(saved.evaluation!.status, "PROPOSAL_READY");
    assert.equal(saved.evaluation!.catalog.length, 40);
    const winner = saved.evaluation!.catalog.find(
      (item) => item.id === saved.evaluation!.winnerId,
    )!;
    assert.equal(winner.category, category);
    assert.equal(saved.signingPolicy!.policy.merchant, winner.merchant);
    assert.equal(
      saved.signingPolicy!.policy.paymentAmount,
      winner.depositBaseUnits,
    );
    assert.equal(
      saved.signingPolicy!.policyHash,
      hashPolicy(saved.signingPolicy!.policy),
    );
    assert.ok(BigInt(winner.depositBaseUnits) <= 20_000_000n);
    console.log(
      `${category}: 40 saved candidates, confirmed preferences, frozen recommendation and v2 policy verified`,
    );
  }
} finally {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const id of created) {
      // A running read-only worker may have observed these temporary policies.
      await client.query(
        "SELECT decision_id FROM converge_group_policies WHERE group_id = $1 FOR UPDATE",
        [id],
      );
      await client.query(
        "DELETE FROM converge_group_chain_snapshots WHERE decision_id IN (SELECT decision_id FROM converge_group_policies WHERE group_id = $1)",
        [id],
      );
      await client.query(
        "UPDATE converge_participants SET current_revision_id = NULL WHERE group_id = $1",
        [id],
      );
      for (const table of [
        "converge_group_policies",
        "converge_evaluations",
        "converge_preference_revisions",
        "converge_participants",
      ])
        await client.query(`DELETE FROM ${table} WHERE group_id = $1`, [id]);
      await client.query("DELETE FROM converge_groups WHERE id = $1", [id]);
    }
    await client.query("COMMIT");
    console.log("Temporary multi-industry groups removed.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
