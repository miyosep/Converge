import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Pool } from "pg";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";

async function main() {
  if (
    process.env.NEON_BRANCH !== "verify-production-0015" ||
    !process.env.DATABASE_URL_UNPOOLED
  )
    throw new Error("ISOLATED_TEST_BRANCH_REQUIRED");
  const credentials = process.argv.indexOf("--credentials");
  if (credentials !== -1) {
    const env = parseEnv(
      await readFile(process.argv[credentials + 1]!, "utf8"),
    );
    for (const key of ["KILN_API_KEY", "XAPI_KEY"])
      if (env[key]) process.env[key] = env[key];
  }
  if (!process.env.KILN_API_KEY || !process.env.XAPI_KEY)
    throw new Error("LIVE_PROVIDER_KEYS_REQUIRED");
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
  Object.assign(process.env, { NODE_ENV: "production" });
  process.env.BACKGROUND_DRIVER = "hybrid";
  process.env.BACKGROUND_JOBS_ENABLED = "false";
  process.env.EXPLORE_DEMO_ENABLED = "false";
  process.env.GROUP_EXECUTION_ENABLED = "false";
  const pool = new Pool({
    connectionString: verifiedPostgresUrl(process.env.DATABASE_URL),
    max: 2,
  });
  const members = [
    privateKeyToAccount(generatePrivateKey()),
    privateKeyToAccount(generatePrivateKey()),
  ];
  let handler: import("node:http").RequestListener = (_request, response) => {
    response.writeHead(503).end();
  };
  let groupId = "",
    searchId = "";
  const cookies: string[] = [];
  const preview = process.argv.includes("--preview");
  const server = createServer((request, response) => {
    if (
      preview &&
      request.url === "/_rehearsal/alice" &&
      cookies[0] &&
      groupId
    ) {
      response
        .writeHead(302, {
          "Set-Cookie": `${cookies[0]}; HttpOnly; SameSite=Strict; Path=/`,
          Location: `/group/${groupId}`,
        })
        .end();
      return;
    }
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  process.env.APP_ORIGIN = origin;
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const { default: next } = await import(
    pathToFileURL(resolve("node_modules/next/dist/server/next.js")).href
  );
  const app = next({ dev: false, hostname: "127.0.0.1", port });
  try {
    await app.prepare();
    handler = app.getRequestHandler();
    async function request(
      path: string,
      body?: unknown,
      member = 0,
      expected = 200,
      method = body === undefined ? "GET" : "POST",
    ) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(cookies[member] ? { Cookie: cookies[member]! } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      assert.equal(
        response.status,
        expected,
        `${path}: ${data.error ?? "unexpected response"}`,
      );
      return { response, data };
    }
    for (const [index, member] of members.entries()) {
      const { data: challenge } = await request("/api/auth/challenge", {
        address: member.address,
      });
      const { response } = await request("/api/auth/verify", {
        challengeId: challenge.challengeId,
        signature: await member.signMessage({ message: challenge.message }),
      });
      cookies[index] = response.headers.get("set-cookie")!.split(";")[0]!;
    }
    const { data: search } = await request("/api/discover", {
      category: "restaurant",
      scope: "general",
      location: "Gangnam Station, Seoul",
      text: "Japanese restaurants near Gangnam Station, Seoul",
    });
    assert.ok(search.places.length, "Live discovery returned no candidates");
    searchId = search.searchId;
    const { data: created } = await request(
      "/api/groups/live",
      {
        requestId: randomUUID(),
        searchId,
        placeIds: [search.places[0].id],
        name: "Friends live integration rehearsal",
        displayName: "Alice",
        targetMemberCount: 2,
        depositUsdc: 15,
        acknowledgeDemo: true,
        slot: {
          startsAt: new Date(Date.now() + 7200000)
            .toISOString()
            .replace(/\.\d{3}Z$/, "Z"),
          timeZone: "Asia/Seoul",
        },
      },
      0,
      201,
    );
    groupId = created.groupId;
    const base = `/api/groups/${groupId}`;
    await request(`${base}/live-preferences`, undefined, 1, 403);
    const { data: invite } = await request(`${base}/invite`, {}, 0, 201);
    await request(
      `${base}/join`,
      { inviteToken: invite.token, displayName: "Bob" },
      1,
    );
    const texts = [
      "I prefer Japanese food near Gangnam Station, Seoul. I have no required restrictions.",
      "I prefer a quiet atmosphere near Gangnam Station, Seoul. I have no required restrictions.",
    ];
    for (const index of [0, 1]) {
      const { data } = await request(
        `${base}/live-preferences`,
        { text: texts[index], expectedRevisionId: null },
        index,
      );
      assert.equal(data.preference.status, "review");
      assert.equal(data.preference.confirmed, false);
      assert.equal(data.preference.extraction.clarifications.length, 0);
      assert.ok(data.preference.extraction.requirements.length);
      await request(
        `${base}/live-confirm`,
        { revisionId: data.preference.revisionId },
        index,
      );
    }
    const { data: result } = await request(`${base}/recommend`, {});
    assert.ok(
      result.livePlan.recommendationReady,
      "Group live search returned no candidates",
    );
    assert.equal(
      result.participants.filter(
        (member: { confirmed: boolean }) => member.confirmed,
      ).length,
      2,
    );
    assert.doesNotMatch(JSON.stringify(result), /I prefer|rawText|extraction/);
    const vote = {
      placeId: result.livePlan.places[0].id,
      recommendationRevision: result.livePlan.recommendationRevision,
      acknowledgeDemo: true,
    };
    await request(`${base}/vote`, vote);
    await request(`${base}/decisions`, {}, 0, 409);
    await request(`${base}/vote`, vote, 1);
    const { data: policy } = await request(`${base}/decisions`, {});
    assert.equal(policy.signingPolicy.policy.approvalThreshold, 2);
    assert.equal(policy.signingPolicy.policy.paymentAmount, "15000000");
    const { data: guest } = await request(`${base}/overview`, undefined, 1);
    assert.equal(
      guest.signingPolicy.policyHash,
      policy.signingPolicy.policyHash,
    );
    console.log(
      `PASS live HTTP: two SIWE sessions, saved xAPI search, invitation, two confirmed Kiln preferences, ${result.livePlan.places.length} group candidates, unanimous choice and one immutable shared policy. No chain transactions.`,
    );
    if (preview) {
      console.log(
        `Preview (temporary test identity): ${origin}/_rehearsal/alice`,
      );
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 10 * 60 * 1000);
        process.once("SIGINT", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  } catch (error) {
    if (groupId) {
      const attempts = await pool.query(
        "SELECT usage->>'errorCode' AS error,usage->>'httpStatus' AS status,usage->'usage'->>'flow' AS flow FROM converge_live_usage WHERE group_id=$1",
        [groupId],
      );
      console.log("Provider attempt diagnostics", attempts.rows);
    }
    throw error;
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (groupId) {
      await pool.query(
        "DELETE FROM converge_group_policies WHERE group_id=$1",
        [groupId],
      );
      await pool.query("DELETE FROM converge_group_invites WHERE group_id=$1", [
        groupId,
      ]);
      await pool.query("DELETE FROM converge_participants WHERE group_id=$1", [
        groupId,
      ]);
      await pool.query("DELETE FROM converge_groups WHERE id=$1", [groupId]);
    }
    if (searchId)
      await pool.query("DELETE FROM converge_discovery_searches WHERE id=$1", [
        searchId,
      ]);
    for (const member of members) {
      await pool.query(
        "DELETE FROM converge_auth_sessions WHERE wallet_address=$1",
        [member.address.toLowerCase()],
      );
      await pool.query(
        "DELETE FROM converge_auth_challenges WHERE wallet_address=$1",
        [member.address.toLowerCase()],
      );
    }
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "HTTP rehearsal failed",
  );
  process.exitCode = 1;
});
