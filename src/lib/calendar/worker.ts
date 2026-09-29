import type { Pool } from "pg";
import { PreferenceRepository } from "../db/preferences.js";
import {
  calendarEvent,
  GoogleCalendarError,
  insertCalendarEvent,
  unseal,
} from "./google.js";

// Calendar work is independent of the payment executor: provider failures never
// prevent settlement. No preferences, wallet addresses or attendee lists leave here.
export async function syncCalendars(pool: Pool, limit = 20) {
  const candidates = await pool.query(
    `SELECT j.group_id,j.wallet_address FROM converge_calendar_jobs j
 JOIN converge_calendar_connections c USING(wallet_address)
 JOIN converge_group_policies p USING(group_id)
 JOIN converge_group_execution e USING(decision_id)
 JOIN converge_group_chain_snapshots s USING(decision_id)
 WHERE e.status='confirmed' AND s.state->>'status'='2' AND s.state->>'spent'=p.policy->>'paymentAmount' AND s.checked_at>now()-interval '2 minutes' AND j.enabled AND j.status IN ('waiting','retry') AND j.next_attempt_at<=now()
 AND NOT c.needs_reconnect AND j.google_subject=c.google_subject ORDER BY j.next_attempt_at LIMIT $1`,
    [limit],
  );
  let synced = 0;
  for (const candidate of candidates.rows) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const locked = (
        await db.query(
          "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked",
          ["calendar:" + candidate.wallet_address],
        )
      ).rows[0].locked;
      if (!locked) {
        await db.query("ROLLBACK");
        continue;
      }
      const job = (
        await db.query(
          `SELECT j.*,c.refresh_token_encrypted FROM converge_calendar_jobs j
    JOIN converge_calendar_connections c USING(wallet_address)
    JOIN converge_participants m USING(group_id,wallet_address)
    JOIN converge_group_policies p USING(group_id)
    JOIN converge_group_execution e USING(decision_id)
    JOIN converge_group_chain_snapshots s USING(decision_id)
    WHERE j.group_id=$1 AND j.wallet_address=$2 AND j.enabled AND j.status IN ('waiting','retry')
    AND j.next_attempt_at<=now() AND NOT c.needs_reconnect AND c.google_subject=j.google_subject
    AND e.status='confirmed' AND s.state->>'status'='2'
    AND s.state->>'spent'=p.policy->>'paymentAmount'
    AND s.checked_at>now()-interval '2 minutes' FOR UPDATE OF j,c`,
          [candidate.group_id, candidate.wallet_address],
        )
      ).rows[0];
      if (!job) {
        await db.query("COMMIT");
        continue;
      }
      try {
        const overview = await new PreferenceRepository(pool).getOverview(
          job.group_id,
          job.wallet_address,
        );
        if (new Date(overview.group.startsAt).getTime() <= Date.now()) {
          await db.query(
            "UPDATE converge_calendar_jobs SET status='blocked',error_code='PLAN_ALREADY_STARTED' WHERE group_id=$1 AND wallet_address=$2",
            [job.group_id, job.wallet_address],
          );
        } else {
          const event = calendarEvent(
            overview,
            job.duration_minutes,
            job.event_id,
          );
          const url = await insertCalendarEvent(
            unseal(job.refresh_token_encrypted, job.wallet_address),
            event,
          );
          await db.query(
            "UPDATE converge_calendar_jobs SET status='synced',event_url=$3,error_code=NULL,updated_at=now() WHERE group_id=$1 AND wallet_address=$2",
            [job.group_id, job.wallet_address, url],
          );
          synced++;
        }
      } catch (error) {
        const code =
          error instanceof GoogleCalendarError
            ? error.code
            : "CALENDAR_SYNC_FAILED";
        const terminal = [
          "EVENT_REMOVED",
          "EVENT_CONFLICT",
          "RECONNECT_GOOGLE",
        ].includes(code);
        await db.query(
          "UPDATE converge_calendar_jobs SET status=$3,error_code=$4,next_attempt_at=now()+interval '5 minutes',updated_at=now() WHERE group_id=$1 AND wallet_address=$2",
          [
            job.group_id,
            job.wallet_address,
            terminal ? "blocked" : "retry",
            code,
          ],
        );
        if (code === "RECONNECT_GOOGLE")
          await db.query(
            "UPDATE converge_calendar_connections SET needs_reconnect=true WHERE wallet_address=$1",
            [job.wallet_address],
          );
      }
      await db.query("COMMIT");
    } catch {
      await db.query("ROLLBACK");
    } finally {
      db.release();
    }
  }
  return synced;
}
