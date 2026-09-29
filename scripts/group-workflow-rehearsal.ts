import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { PreferenceRepository } from "../src/lib/db/preferences.js";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import type { GroupOverview } from "../src/lib/group-view.js";
import { hashPolicy } from "../src/lib/policy.js";

if (process.env.NEON_BRANCH !== "dev-preferences")
  throw new Error("This synthetic rehearsal is restricted to dev-preferences");
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Use a local app for this rehearsal");
const pool = new Pool({
  connectionString: verifiedPostgresUrl(process.env.DATABASE_URL!),
  connectionTimeoutMillis: 15000,
});
const repo = new PreferenceRepository(pool);
const people = Array.from({ length: 7 }, () =>
  privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`),
);
async function post(
  path: string,
  body: unknown,
  cookie?: string,
  requestOrigin = origin,
) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function login(person: (typeof people)[number]) {
  const challenge = await post("/api/auth/challenge", {
    address: person.address,
  });
  assert.equal(challenge.status, 200);
  const body = (await challenge.json()) as {
    challengeId: string;
    message: string;
  };
  const response = await post("/api/auth/verify", {
    challengeId: body.challengeId,
    signature: await person.signMessage({ message: body.message }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}
const conditions = (budget: number) => ({
  schemaVersion: 1,
  constraints: [
    {
      type: "hard",
      field: "budget_per_person_cents",
      operator: "lte",
      value: budget,
    },
    { type: "soft", field: "quiet", weight: 1 },
  ],
  clarifications: [],
  unsupportedRequirements: [],
});
try {
  const owner = people[0]!;
  const group = await repo.createGroup({
    name: "Synthetic ordinary-group workflow rehearsal",
    creator: owner.address,
    displayName: "Synthetic 1",
    slot: {
      startsAt: new Date(Date.now() + 172800000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
      timeZone: "Asia/Seoul",
    },
  });
  for (const [index, person] of people.slice(0, 6).entries()) {
    if (index)
      await repo.addVerifiedParticipant(
        group,
        person.address,
        `Synthetic ${index + 1}`,
      );
    const revision = await repo.submit(
      group,
      person.address,
      "Synthetic budget and quiet preference",
      null,
    );
    await repo.completeExtraction(
      group,
      person.address,
      revision.revisionId,
      conditions(index === 0 ? 100 : 3500),
    );
    await repo.confirm(group, person.address, revision.revisionId);
  }
  const cookie = await login(owner);
  const outsider = await login(people[6]!);
  const base = `/api/groups/${group}`;
  assert.equal((await post(`${base}/evaluate`, {})).status, 401);
  assert.equal(
    (await post(`${base}/evaluate`, {}, cookie, "https://invalid.example"))
      .status,
    403,
  );
  assert.equal((await post(`${base}/evaluate`, {}, outsider)).status, 409);
  assert.equal(
    (await post(`${base}/evaluate`, { maxTotalSpend: "999999999" }, cookie))
      .status,
    400,
  );
  assert.equal((await post(`${base}/decisions`, {}, cookie)).status, 409);
  const noMatchResponse = await post(`${base}/evaluate`, {}, cookie);
  assert.equal(noMatchResponse.status, 200);
  const noMatch = (await noMatchResponse.json()) as GroupOverview;
  assert.equal(noMatch.evaluation?.status, "NO_MATCH");
  assert.equal(noMatch.group.locked, false);
  assert.equal(
    (await repo.getOverview(group, owner.address)).evaluation?.status,
    "NO_MATCH",
  );
  const own = await repo.getOwn(group, owner.address);
  assert.ok(own);
  const corrected = await repo.correct(
    group,
    owner.address,
    own.revisionId,
    conditions(3500),
  );
  assert.equal((await repo.getOverview(group, owner.address)).evaluation, null);
  assert.equal((await post(`${base}/evaluate`, {}, cookie)).status, 409);
  await repo.confirm(group, owner.address, corrected.revisionId);
  const responses = await Promise.all([
    post(`${base}/evaluate`, {}, cookie),
    post(`${base}/evaluate`, {}, cookie),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    const view = (await response.json()) as GroupOverview;
    assert.equal(view.evaluation?.winnerId, "A");
    assert.equal(view.group.locked, true);
  }
  const policies = await Promise.all([
    post(`${base}/decisions`, {}, cookie),
    post(`${base}/decisions`, {}, cookie),
  ]);
  const views: GroupOverview[] = [];
  for (const response of policies) {
    assert.equal(response.status, 200);
    views.push((await response.json()) as GroupOverview);
  }
  const saved = views[0]!.signingPolicy!;
  assert.ok(saved);
  assert.deepEqual(views[1]!.signingPolicy, saved);
  assert.equal(hashPolicy(saved.policy), saved.policyHash);
  assert.deepEqual(
    saved.policy.participants.map((value) => value.toLowerCase()).sort(),
    people
      .slice(0, 6)
      .map((person) => person.address.toLowerCase())
      .sort(),
  );
  assert.equal((await post(`${base}/decisions`, {}, outsider)).status, 409);
  await assert.rejects(
    repo.correct(group, owner.address, corrected.revisionId, conditions(2500)),
    /PREFERENCES_LOCKED/,
  );
  await assert.rejects(
    pool.query(
      "UPDATE converge_group_policies SET policy = policy WHERE group_id = $1",
      [group],
    ),
    /immutable/,
  );
  const loaded = await fetch(`${origin}${base}/overview`, {
    headers: { Cookie: cookie },
  });
  assert.equal(loaded.status, 200);
  const text = await loaded.text();
  assert.doesNotMatch(
    text,
    /"rawText"|"violations"|"input_snapshot"|"confirmedRevisionId"/,
  );
  assert.equal(
    (JSON.parse(text) as GroupOverview).signingPolicy?.policyHash,
    saved.policyHash,
  );
  await writeFile(
    "docs/evidence/group-workflow-dev.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        synthetic: true,
        liveKiln: false,
        onChainTransactions: false,
        branch: "dev-preferences",
        checkedAt: new Date().toISOString(),
        groupId: group,
        noMatchPersisted: true,
        staleResultHidden: true,
        incompleteEvaluationRejected: true,
        concurrentEvaluationIdempotent: true,
        concurrentPolicyIdempotent: true,
        policyUpdatesRejected: true,
        outsiderRejected: true,
        csrfRejected: true,
        clientTermsRejected: true,
        policyHash: saved.policyHash,
        winner: "A",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Ordinary-group workflow passed: no-match, revision, evaluation, policy idempotency, privacy and authorization. No chain transactions or AI calls.",
  );
} finally {
  await pool.end();
}
