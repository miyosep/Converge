import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { PreferenceRepository } from "../src/lib/db/preferences.js";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import type { GroupOverview } from "../src/lib/group-view.js";
import { EXPLANATION_PROMPT_VERSION } from "../src/lib/group-explanation.js";
import type {
  FlowUsage,
  SavedExplanation,
} from "../src/lib/db/group-insights.js";

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
  const verified = await post("/api/auth/verify", {
    challengeId: body.challengeId,
    signature: await person.signMessage({ message: body.message }),
  });
  assert.equal(verified.status, 200);
  const cookie = verified.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

const extraction = {
  schemaVersion: 1,
  constraints: [{ type: "soft", field: "quiet", weight: 1 }],
  clarifications: [],
  unsupportedRequirements: [],
};

try {
  const owner = people[0]!;
  const groupId = await repo.createGroup({
    name: "Synthetic explanation rehearsal",
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
        groupId,
        person.address,
        `Synthetic ${index + 1}`,
      );
    const revision = await repo.submit(
      groupId,
      person.address,
      "Synthetic quiet preference",
      null,
    );
    await repo.completeExtraction(
      groupId,
      person.address,
      revision.revisionId,
      extraction,
    );
    await repo.confirm(groupId, person.address, revision.revisionId);
  }
  const cookie = await login(owner);
  const outsider = await login(people[6]!);
  const evaluationResponse = await post(
    `/api/groups/${groupId}/evaluate`,
    {},
    cookie,
  );
  assert.equal(evaluationResponse.status, 200);
  const overview = (await evaluationResponse.json()) as GroupOverview;
  assert.equal(overview.evaluation?.status, "PROPOSAL_READY");
  const path = `/api/insights/${groupId}`;
  assert.equal((await fetch(`${origin}${path}`)).status, 401);
  assert.notEqual(
    (await fetch(`${origin}${path}`, { headers: { Cookie: outsider } })).status,
    200,
  );
  assert.equal(
    (await post(path, {}, cookie, "https://invalid.example")).status,
    403,
  );
  const response = await post(path, {}, cookie);
  assert.equal(response.status, 200);
  const first = (await response.json()) as {
    explanation: SavedExplanation;
    usage: FlowUsage[];
    cacheHit: boolean;
  };
  assert.equal(first.explanation.source, "kiln");
  assert.equal(first.cacheHit, false);
  assert.ok(first.explanation.text.includes("KAGAMI"));
  assert.doesNotMatch(
    first.explanation.text,
    /Synthetic [1-6]|0x[a-fA-F0-9]{40}/,
  );
  const explanationUsage = first.usage.find(
    (flow) => flow.flow === "decision_explanation",
  )!;
  assert.ok(explanationUsage.attempts >= 1);
  assert.equal(explanationUsage.successfulAttempts, 1);
  const cachedResponse = await post(path, {}, cookie);
  assert.equal(cachedResponse.status, 200);
  const cached = (await cachedResponse.json()) as typeof first;
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.explanation.text, first.explanation.text);
  assert.ok(
    cached.usage.find((flow) => flow.flow === "decision_explanation")!
      .applicationCacheHits >= 1,
  );
  const sanitized = {
    schemaVersion: 1,
    synthetic: true,
    branch: "dev-preferences",
    checkedAt: new Date().toISOString(),
    groupId,
    explanationSource: first.explanation.source,
    explanationPromptVersion: EXPLANATION_PROMPT_VERSION,
    explanationAttempts: explanationUsage.attempts,
    inputTokens: explanationUsage.inputTokens,
    outputTokens: explanationUsage.outputTokens,
    cacheHitOnRepeat: cached.cacheHit,
    outsiderRejected: true,
    csrfRejected: true,
    onChainTransactions: false,
  };
  await writeFile(
    "docs/evidence/group-insights-dev.json",
    `${JSON.stringify(sanitized, null, 2)}\n`,
  );
  console.log(
    "Group explanation and usage passed with live Kiln, member access, and idempotent cache. No chain transactions.",
  );
} finally {
  await pool.end();
}
