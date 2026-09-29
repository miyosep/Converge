import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
if (!process.argv.includes("--live"))
  throw new Error("Pass --live for metered searches");
const origin = process.env.APP_ORIGIN || "http://localhost:3017";
const signer = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
async function post(path: string, body: unknown, cookie?: string) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
const challengeResponse = await post("/api/auth/challenge", {
  address: signer.address,
});
assert.equal(challengeResponse.status, 200);
const challenge = await challengeResponse.json();
const verification = await post("/api/auth/verify", {
  challengeId: challenge.challengeId,
  signature: await signer.signMessage({ message: challenge.message }),
});
assert.equal(verification.status, 200);
const cookie = verification.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie);
const outcomes = [];
try {
  for (const budget of [30000, 20000]) {
    const started = Date.now();
    const response = await post(
      "/api/discover",
      {
        location: "Gangnam Station, Seoul",
        text: `Find quiet Japanese restaurants for six people, up to KRW ${budget} per person.`,
      },
      cookie,
    );
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(result.source, "xAPI (Google Maps)");
    assert.equal(result.intent.budget.amount, budget);
    assert.equal(result.intent.people, 6);
    assert.ok(result.places.length > 0);
    assert.ok(
      result.places.every((p: { evidence: Array<{ status: string }> }) =>
        p.evidence.every((e) => e.status === "unknown"),
      ),
    );
    outcomes.push({
      budget,
      httpStatus: response.status,
      durationMs: Date.now() - started,
      count: result.places.length,
      query: result.query,
      allConditionsUnverified: true,
    });
  }
} finally {
  await post("/api/auth/logout", {}, cookie);
}
await mkdir("docs/evidence", { recursive: true });
const path = `docs/evidence/xapi-http-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(
  path,
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      scope:
        "Live authenticated local HTTP discovery with a changed budget; no payment or booking. Model/provider usage is logged by the server.",
      outcomes,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ path, outcomes }, null, 2));
