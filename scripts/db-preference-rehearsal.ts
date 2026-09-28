import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { demoRolesSchema } from "../src/lib/demo-roles.js";
import {
  PreferenceRepository,
  PreferenceRepositoryError,
} from "../src/lib/db/preferences.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";
import { createRestaurantCatalog } from "../src/lib/fixtures/restaurants.js";
import { PreferenceError } from "../src/lib/preferences.js";
import { addressSchema } from "../src/lib/schemas/primitives.js";
import { z } from "zod";

if (process.env.NEON_BRANCH !== "dev-preferences" || !process.env.DATABASE_URL)
  throw new Error("The rehearsal requires the dev-preferences database branch");
const pool = new Pool({
  connectionString: verifiedPostgresUrl(process.env.DATABASE_URL),
  max: 4,
  connectionTimeoutMillis: 15000,
});
try {
  const repo = new PreferenceRepository(pool);
  const people = z
    .object({
      participants: z
        .array(z.object({ persona: z.string(), address: addressSchema }))
        .length(6),
    })
    .parse(
      JSON.parse(
        await readFile(
          "contracts/deployments/demo-participants.11155111.json",
          "utf8",
        ),
      ),
    ).participants;
  const roles = demoRolesSchema.parse(
    JSON.parse(
      await readFile("contracts/deployments/demo-roles.11155111.json", "utf8"),
    ),
  );
  const members = people.map((person) => person.address);
  const slot = { startsAt: "2030-01-05T10:00:00Z", timeZone: "Asia/Seoul" };
  const groupId = await repo.createGroup({
    name: "Synthetic dinner rehearsal",
    slot,
    creator: people[0]!.address,
    displayName: people[0]!.persona,
  });
  for (const person of people.slice(1))
    await repo.addVerifiedParticipant(groupId, person.address, person.persona);
  await repo.addVerifiedParticipant(
    groupId,
    people[1]!.address,
    people[1]!.persona,
  );
  await assert.rejects(
    repo.addVerifiedParticipant(
      groupId,
      "0x7777777777777777777777777777777777777777",
      "Seventh",
    ),
    (error) =>
      error instanceof PreferenceRepositoryError && error.code === "GROUP_FULL",
  );
  await assert.rejects(
    repo.getOwn(groupId, "0x7777777777777777777777777777777777777777"),
    (error) =>
      error instanceof PreferenceRepositoryError && error.code === "NOT_MEMBER",
  );

  const initial = await repo.submit(
    groupId,
    people[0]!.address,
    "My budget is $35 per person.",
    null,
  );
  const concurrent = await Promise.allSettled([
    repo.submit(
      groupId,
      people[0]!.address,
      "Budget $35; I prefer quiet.",
      initial.revisionId,
    ),
    repo.submit(
      groupId,
      people[0]!.address,
      "Budget $35; I prefer atmosphere.",
      initial.revisionId,
    ),
  ]);
  assert.equal(
    concurrent.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.ok(
    concurrent.some(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof PreferenceError &&
        result.reason.code === "STALE_REVISION",
    ),
  );
  const alice = await repo.getOwn(groupId, people[0]!.address);
  assert.ok(alice);
  await assert.rejects(
    repo.completeExtraction(
      groupId,
      people[0]!.address,
      initial.revisionId,
      createBaselinePreferences(members)[0]!.extraction,
    ),
    (error) =>
      error instanceof PreferenceError && error.code === "STALE_REVISION",
  );

  const fixture = createBaselinePreferences(members);
  for (let index = 0; index < people.length; index++) {
    const person = people[index]!;
    const revision =
      index === 0
        ? alice
        : await repo.submit(
            groupId,
            person.address,
            `Synthetic preference from ${person.persona}`,
            null,
          );
    const parsed = await repo.completeExtraction(
      groupId,
      person.address,
      revision!.revisionId,
      fixture[index]!.extraction,
    );
    assert.equal(parsed.status, "AWAITING_CONFIRMATION");
    await repo.confirm(groupId, person.address, parsed.revisionId);
  }
  const beforeCorrection = await repo.getProgress(groupId, people[0]!.address);
  assert.equal(beforeCorrection.length, 6);
  assert.ok(beforeCorrection.every((row) => row.submitted && row.confirmed));
  assert.ok(
    beforeCorrection.every(
      (row) =>
        !JSON.stringify(row).includes("rawText") &&
        !JSON.stringify(row).includes("extraction") &&
        !JSON.stringify(row).includes("revisionId"),
    ),
  );

  const bob = (await repo.getOwn(groupId, people[1]!.address))!;
  const corrected = await repo.correct(
    groupId,
    people[1]!.address,
    bob.revisionId,
    bob.extraction,
  );
  assert.equal(corrected.status, "AWAITING_CONFIRMATION");
  assert.equal(
    (await repo.getProgress(groupId, people[0]!.address))[1]!.confirmed,
    false,
  );
  const options = {
    permittedMerchants: Object.values(roles.merchants),
    contributionPerParticipant: "10000000",
    maxDeposit: "60000000",
    maxTotalSpend: "60000000",
    catalog: createRestaurantCatalog(roles, [slot.startsAt]),
  };
  await assert.rejects(
    repo.evaluateAndFreeze(groupId, people[0]!.address, options),
    (error) =>
      error instanceof PreferenceRepositoryError &&
      error.code === "INCOMPLETE_GROUP",
  );
  await repo.confirm(groupId, people[1]!.address, corrected.revisionId);
  const noMatch = await repo.evaluateAndFreeze(groupId, people[0]!.address, {
    ...options,
    permittedMerchants: [],
  });
  assert.equal(noMatch.frozen, false);
  assert.equal(noMatch.publicResult.status, "NO_MATCH");
  const ready = await repo.evaluateAndFreeze(
    groupId,
    people[0]!.address,
    options,
  );
  assert.equal(ready.frozen, true);
  await assert.rejects(
    repo.submit(groupId, people[0]!.address, "Too late", alice.revisionId),
    (error) =>
      error instanceof PreferenceError && error.code === "PREFERENCES_LOCKED",
  );

  const result = ready.publicResult;
  assert.equal(result.winnerId, "A");
  const stored = await pool.query<{
    input_snapshot: { preferences: unknown[] };
  }>("SELECT input_snapshot FROM converge_evaluations WHERE group_id = $1", [
    groupId,
  ]);
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0]!.input_snapshot.preferences.length, 6);
  const audit = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM converge_preference_revisions WHERE group_id = $1",
    [groupId],
  );
  assert.equal(Number(audit.rows[0]!.count), 8);
  const evidence = {
    schemaVersion: 1,
    synthetic: true,
    branch: "dev-preferences",
    groupId,
    sixParticipants: true,
    staleConcurrentWriteRejected: true,
    staleWorkerResultRejected: true,
    correctionClearedConfirmation: true,
    incompleteFreezeRejected: true,
    noMatchDidNotFreeze: true,
    immutableEvaluationStored: true,
    writesBlockedAfterFreeze: true,
    privateInputExcludedFromProgress: true,
    historicalRevisionCount: 8,
    publicEvaluation: result,
  };
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/db-preferences-dev.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    `PostgreSQL preference rehearsal passed on dev branch; winner ${result.winnerId}.`,
  );
} finally {
  await pool.end();
}
