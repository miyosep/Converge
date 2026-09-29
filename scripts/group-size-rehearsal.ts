import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { PreferenceRepository } from "../src/lib/db/preferences.js";
import { WalletAuthRepository } from "../src/lib/db/wallet-auth.js";
import {
  groupEvaluationOptions,
  currentGroupPolicyConfig,
} from "../src/lib/server/group-config.js";

// This rehearsal writes only synthetic groups on the existing development branch.
// It uses no provider inference, test funds or chain transactions.
if (process.env.NEON_BRANCH !== "dev-preferences")
  throw new Error("Use dev-preferences only");
const pool = new Pool({
  connectionString: verifiedPostgresUrl(process.env.DATABASE_URL!),
  max: 4,
  connectionTimeoutMillis: 15000,
});
const repo = new PreferenceRepository(pool);
const auth = new WalletAuthRepository(pool, "http://localhost:3000");
const created: string[] = [];
const account = () =>
  privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
const slot = {
  startsAt: new Date(Date.now() + 172800000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z"),
  timeZone: "Asia/Seoul",
};

async function rehearse() {
  try {
    for (const size of process.argv.includes("--quick")
      ? [4]
      : [2, 4, 6, 8, 100]) {
      const people = Array.from(
        { length: size === 100 ? 1 : size + 1 },
        account,
      );
      const owner = people[0]!;
      const group = await repo.createGroup({
        name: `Synthetic ${size}-person group rehearsal`,
        creator: owner.address,
        displayName: "Synthetic owner",
        slot,
        ...(size === 4 ? { permittedRestaurantIds: ["L", "F"] } : {}),
        // Preserve the default for existing six-person clients.
        ...(size === 6 ? {} : { targetMemberCount: size }),
      });
      created.push(group);
      assert.equal(
        (await repo.listGroups(owner.address)).find((g) => g.id === group)
          ?.targetMemberCount,
        size,
      );
      const invite = await auth.createInvite(group, owner.address);
      const capacity = await pool.query<{ max_uses: number }>(
        "SELECT max_uses FROM converge_group_invites WHERE group_id=$1",
        [group],
      );
      assert.equal(capacity.rows[0]!.max_uses, size - 1);
      if (size === 100) continue;
      await assert.rejects(
        repo.evaluateAndFreeze(
          group,
          owner.address,
          groupEvaluationOptions(slot.startsAt),
        ),
        /INCOMPLETE_GROUP/,
      );
      for (const person of people.slice(1, size - 1))
        await auth.joinWithInvite(
          group,
          person.address,
          "Synthetic member",
          invite.token,
        );
      // Two links compete for one remaining seat. The row lock must protect capacity.
      const secondInvite = await auth.createInvite(group, owner.address);
      const contenders = people.slice(size - 1);
      const joins = await Promise.allSettled(
        contenders.map((person, i) =>
          auth.joinWithInvite(
            group,
            person.address,
            "Final seat",
            i ? secondInvite.token : invite.token,
          ),
        ),
      );
      assert.equal(
        joins.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const outsider =
        contenders[joins.findIndex((result) => result.status === "rejected")]!;
      await assert.rejects(
        repo.addVerifiedParticipant(group, outsider.address, "Over capacity"),
        /GROUP_FULL/,
      );
      await assert.rejects(
        repo.getOverview(group, outsider.address),
        /NOT_MEMBER/,
      );
      const overview = await repo.getOverview(group, owner.address);
      assert.equal(overview.group.targetMemberCount, size);
      assert.equal(overview.participants.length, size);
      for (const [index, person] of overview.participants.entries()) {
        const revision = await repo.submit(
          group,
          person.walletAddress,
          "Synthetic budget and quiet preference",
          null,
        );
        await repo.completeExtraction(
          group,
          person.walletAddress,
          revision.revisionId,
          {
            schemaVersion: 1,
            constraints: [
              {
                type: "hard",
                field: "budget_per_person_cents",
                operator: "lte",
                value: 3500,
              },
              { type: "soft", field: "quiet", weight: 1 },
            ],
            clarifications: [],
            unsupportedRequirements: [],
          },
        );
        if (index === size - 1)
          await assert.rejects(
            repo.evaluateAndFreeze(
              group,
              owner.address,
              groupEvaluationOptions(slot.startsAt),
            ),
            /INCOMPLETE_GROUP/,
          );
        await repo.confirm(group, person.walletAddress, revision.revisionId);
      }
      const result = await repo.evaluateAndFreeze(
        group,
        owner.address,
        groupEvaluationOptions(slot.startsAt),
      );
      assert.equal(
        result.publicResult.winnerId,
        size === 2 ? "T" : size === 4 ? "L" : "A",
      );
      const complete = await repo.getOverview(group, owner.address);
      assert.equal(complete.group.confirmedCount, size);
      assert.equal(
        complete.evaluation?.terms.maxTotalSpend,
        (BigInt(Math.min(size, 6)) * 10000000n).toString(),
      );
      assert.equal(complete.group.locked, true);
      const policy = await repo.preparePolicy(
        group,
        owner.address,
        currentGroupPolicyConfig(),
      );
      assert.equal(policy.policy.policyVersion, 2);
      assert.equal(policy.policy.approvalThreshold, size);
      assert.equal(policy.policy.participants.length, size);
      assert.equal(
        (await repo.getOverview(group, owner.address)).signingPolicy
          ?.policyHash,
        policy.policyHash,
      );
      await assert.rejects(
        auth.createInvite(group, owner.address),
        /GROUP_LOCKED/,
      );
      console.log(
        `PASS: ${size} members, invitations, concurrent capacity, private access, confirmations and recommendation`,
      );
    }
    console.log(
      "PASS: dynamic group policy persistence and catalog selection; no chain writes",
    );
  } finally {
    // Delete only the randomly identified synthetic groups created by this run.
    for (const group of created) {
      await pool.query(
        "UPDATE converge_participants SET current_revision_id=NULL WHERE group_id=$1",
        [group],
      );
      for (const table of [
        "converge_group_invites",
        "converge_group_policies",
        "converge_evaluations",
        "converge_preference_revisions",
        "converge_participants",
      ])
        await pool.query(`DELETE FROM ${table} WHERE group_id=$1`, [group]);
      await pool.query("DELETE FROM converge_groups WHERE id=$1", [group]);
    }
    await pool.end();
  }
}
rehearse().catch((error: unknown) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "Development group-size rehearsal failed; no credentials printed.",
  );
  process.exitCode = 1;
});
