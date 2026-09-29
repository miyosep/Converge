import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { CalendarRepository } from "../src/lib/db/calendar.js";
import { PreferenceRepository } from "../src/lib/db/preferences.js";
import { syncCalendars } from "../src/lib/calendar/worker.js";
import { digest, seal, CALENDAR_SCOPE } from "../src/lib/calendar/google.js";
import type { GroupOverview } from "../src/lib/group-view.js";

async function main() {
  if (
    process.env.NEON_BRANCH !== "dev-preferences" ||
    !process.env.DATABASE_URL_UNPOOLED
  )
    throw new Error("Development database required");
  const pool = new Pool({
    connectionString: verifiedPostgresUrl(process.env.DATABASE_URL_UNPOOLED),
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  const group = "calendar-test-" + randomUUID(),
    wallet = "0x" + randomBytes(20).toString("hex"),
    decision = "0x" + randomBytes(32).toString("hex"),
    evaluation = randomUUID(),
    session = randomBytes(32).toString("base64url");
  const originalFetch = globalThis.fetch,
    originalOverview = PreferenceRepository.prototype.getOverview;
  process.env.GOOGLE_CLIENT_ID = "rehearsal";
  process.env.GOOGLE_CLIENT_SECRET = "rehearsal";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.APP_ORIGIN = "http://localhost:3000";
  let inserts = 0,
    providerCalls = 0;
  globalThis.fetch = async (input, init) => {
    providerCalls++;
    const url = String(input);
    if (url.includes("oauth2.googleapis.com"))
      return Response.json({
        access_token: "fake",
        refresh_token: "fake-refresh",
        scope: CALENDAR_SCOPE,
      });
    if (url.includes("userinfo"))
      return Response.json({
        sub: "rehearsal-subject",
        email: "calendar-test@example.invalid",
        email_verified: true,
      });
    assert.equal(init?.method, "POST");
    inserts++;
    const event = JSON.parse(String(init.body));
    return Response.json({
      ...event,
      htmlLink: "https://www.google.com/calendar/event?eid=rehearsal",
    });
  };
  PreferenceRepository.prototype.getOverview = async (id, actor) => {
    assert.equal(id, group);
    assert.equal(actor, wallet);
    return {
      group: {
        id: group,
        name: "Calendar rehearsal",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        timeZone: "Asia/Seoul",
      },
      evaluation: {
        winnerId: "x",
        catalog: [{ id: "x", name: "Synthetic venue" }],
      },
      signingPolicy: { policy: {} },
    } as unknown as GroupOverview;
  };
  try {
    await pool.query(
      "INSERT INTO converge_groups(id,name,reservation_starts_at,reservation_time_zone,creator_wallet) VALUES($1,'Calendar rehearsal',now()+interval '1 day','Asia/Seoul',$2)",
      [group, wallet],
    );
    await pool.query(
      "INSERT INTO converge_participants(group_id,wallet_address,display_name) VALUES($1,$2,'Test only')",
      [group, wallet],
    );
    await pool.query(
      "INSERT INTO converge_auth_sessions(token_hash,wallet_address,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [digest(session), wallet],
    );
    const repo = new CalendarRepository(pool),
      start = await repo.start(group, wallet, session);
    await assert.rejects(() =>
      repo.finish(start.state, "code", wallet, "wrong-session"),
    );
    assert.equal(providerCalls, 0);
    assert.equal(
      await repo.finish(start.state, "code", wallet, session),
      group,
    );
    await assert.rejects(() =>
      repo.finish(start.state, "code", wallet, session),
    );
    const status = await repo.status(group, wallet);
    assert.equal(status.connected, true);
    assert.doesNotMatch(JSON.stringify(status), /fake-refresh|refresh_token/);
    await repo.enable(group, wallet, 120);
    assert.equal(await syncCalendars(pool), 0);
    assert.equal(inserts, 0);
    await pool.query(
      "INSERT INTO converge_evaluations(id,group_id,input_snapshot,internal_result) VALUES($1,$2,'{}','{}')",
      [evaluation, group],
    );
    await pool.query(
      "INSERT INTO converge_group_policies(decision_id,group_id,evaluation_id,policy,policy_hash) VALUES($1,$2,$3,$4::jsonb,$1)",
      [decision, group, evaluation, JSON.stringify({ paymentAmount: "40" })],
    );
    await pool.query(
      "INSERT INTO converge_group_execution(decision_id,transaction_hash,journal,reserved_wei,status) VALUES($1,$1,'{}',0,'confirmed')",
      [decision],
    );
    await pool.query(
      "INSERT INTO converge_group_chain_snapshots(decision_id,block_number,block_hash,state) VALUES($1,20,$1,$2::jsonb)",
      [decision, JSON.stringify({ status: 2, spent: "39" })],
    );
    assert.equal(await syncCalendars(pool), 0);
    assert.equal(inserts, 0);
    await pool.query(
      "UPDATE converge_group_chain_snapshots SET state=$2::jsonb,checked_at=now()-interval '3 minutes' WHERE decision_id=$1",
      [decision, JSON.stringify({ status: 2, spent: "40" })],
    );
    assert.equal(await syncCalendars(pool), 0);
    await pool.query(
      "UPDATE converge_group_chain_snapshots SET checked_at=now() WHERE decision_id=$1",
      [decision],
    );
    await repo.disable(group, wallet);
    assert.equal(await syncCalendars(pool), 0);
    await repo.enable(group, wallet, 120);
    assert.equal(await syncCalendars(pool), 1);
    assert.equal(inserts, 1);
    assert.equal((await repo.status(group, wallet)).job.status, "synced");
    assert.equal(await syncCalendars(pool), 0);
    assert.equal(inserts, 1);
    await repo.enable(group, wallet, 180);
    assert.equal((await repo.status(group, wallet)).job.duration_minutes, 120);
    await repo.disconnect(wallet);
    assert.equal((await repo.status(group, wallet)).connected, false);
    assert.equal((await repo.status(group, wallet)).job.enabled, false);
    console.log(
      "Calendar rehearsal passed: session binding, replay rejection, payment gating, amount/freshness checks, opt-out, single insertion, disconnect. Google responses were mocked; no external events created.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    PreferenceRepository.prototype.getOverview = originalOverview;
    await pool.query(
      "DELETE FROM converge_calendar_oauth_states WHERE group_id=$1",
      [group],
    );
    await pool.query("DELETE FROM converge_calendar_jobs WHERE group_id=$1", [
      group,
    ]);
    await pool.query(
      "DELETE FROM converge_calendar_connections WHERE wallet_address=$1",
      [wallet],
    );
    await pool.query("DELETE FROM converge_auth_sessions WHERE token_hash=$1", [
      digest(session),
    ]);
    await pool.query(
      "DELETE FROM converge_group_chain_snapshots WHERE decision_id=$1",
      [decision],
    );
    await pool.query(
      "DELETE FROM converge_group_execution WHERE decision_id=$1",
      [decision],
    );
    await pool.query("DELETE FROM converge_group_policies WHERE group_id=$1", [
      group,
    ]);
    await pool.query("DELETE FROM converge_evaluations WHERE group_id=$1", [
      group,
    ]);
    await pool.query("DELETE FROM converge_participants WHERE group_id=$1", [
      group,
    ]);
    await pool.query("DELETE FROM converge_groups WHERE id=$1", [group]);
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Calendar rehearsal failed",
  );
  process.exitCode = 1;
});
