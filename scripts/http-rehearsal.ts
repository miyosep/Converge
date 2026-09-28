import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { Pool } from "pg";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";

const origin = process.env.APP_ORIGIN || "http://localhost:3000";
const account = () =>
  privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
const owner = account();
const guest = account();

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

async function signIn(signer: ReturnType<typeof account>) {
  const challengeResponse = await post("/api/auth/challenge", {
    address: signer.address,
  });
  assert.equal(challengeResponse.status, 200);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    message: string;
  };
  const signature = await signer.signMessage({ message: challenge.message });
  const verification = await post("/api/auth/verify", {
    challengeId: challenge.challengeId,
    signature,
  });
  assert.equal(verification.status, 200);
  const cookie = verification.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  assert.ok(cookie.startsWith("converge_session="));
  assert.match(verification.headers.get("set-cookie") ?? "", /HttpOnly/i);
  const replay = await post("/api/auth/verify", {
    challengeId: challenge.challengeId,
    signature,
  });
  assert.equal(replay.status, 400);
  return cookie;
}

const noSession = await post("/api/groups", {});
assert.equal(noSession.status, 401);
const ownerCookie = await signIn(owner);
const guestCookie = await signIn(guest);
const csrf = await post(
  "/api/groups",
  {},
  ownerCookie,
  "https://attacker.example",
);
assert.equal(csrf.status, 403);
const groupResponse = await post(
  "/api/groups",
  {
    name: "HTTP rehearsal",
    displayName: "Alice",
    slot: { startsAt: "2026-10-03T18:00:00Z", timeZone: "Asia/Seoul" },
  },
  ownerCookie,
);
assert.equal(groupResponse.status, 201);
const { groupId } = (await groupResponse.json()) as { groupId: string };
const outsiderProgress = await fetch(
  `${origin}/api/groups/${groupId}/progress`,
  {
    headers: { Cookie: guestCookie },
  },
);
assert.notEqual(outsiderProgress.status, 200);
const inviteResponse = await post(
  `/api/groups/${groupId}/invite`,
  {},
  ownerCookie,
);
assert.equal(inviteResponse.status, 201);
const { token } = (await inviteResponse.json()) as { token: string };
const joinResponse = await post(
  `/api/groups/${groupId}/join`,
  {
    inviteToken: token,
    displayName: "Bob",
  },
  guestCookie,
);
assert.equal(joinResponse.status, 200);
const progress = await fetch(`${origin}/api/groups/${groupId}/progress`, {
  headers: { Cookie: guestCookie },
});
assert.equal(progress.status, 200);
const progressBody = (await progress.json()) as { participants: unknown[] };
assert.equal(progressBody.participants.length, 2);
assert.equal(JSON.stringify(progressBody).includes("rawText"), false);
console.log(
  JSON.stringify({
    groupId,
    checks: [
      "unauthenticated create rejected",
      "HTTP SIWE sign-in and replay protection",
      "cross-origin mutation rejected",
      "outsider progress denied",
      "authenticated invite join and sanitized progress",
    ],
  }),
);

if (process.argv.includes("--kiln")) {
  if (
    process.env.NEON_BRANCH !== "dev-preferences" ||
    !process.env.DATABASE_URL
  )
    throw new Error("Live Kiln HTTP rehearsal requires the development branch");
  const submission = await post(
    `/api/groups/${groupId}/preferences`,
    {
      text: "Under $35 per person, quiet, and vegetarian-friendly.",
      expectedRevisionId: null,
    },
    ownerCookie,
  );
  assert.equal(submission.status, 201);
  const submitted = (await submission.json()) as {
    preference: { revisionId: string; status: string; extraction: unknown };
  };
  assert.equal(submitted.preference.status, "AWAITING_CONFIRMATION");
  assert.ok(submitted.preference.extraction);
  const confirmation = await post(
    `/api/groups/${groupId}/confirm`,
    {
      revisionId: submitted.preference.revisionId,
    },
    ownerCookie,
  );
  assert.equal(confirmation.status, 200);
  const pool = new Pool({
    connectionString: verifiedPostgresUrl(process.env.DATABASE_URL),
    max: 1,
  });
  try {
    const records = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM converge_kiln_attempts
      WHERE group_id = $1 AND revision_id = $2`,
      [groupId, submitted.preference.revisionId],
    );
    assert.ok(Number(records.rows[0]!.count) >= 1);
    console.log(
      JSON.stringify({
        groupId,
        checks: [
          "live Kiln extraction",
          "explicit confirmation",
          "usage attempt persisted",
        ],
        usageAttempts: Number(records.rows[0]!.count),
      }),
    );
  } finally {
    await pool.end();
  }
}
