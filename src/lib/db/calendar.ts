import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  authorizationUrl,
  calendarConfigured,
  digest,
  eventId,
  seal,
  unseal,
  exchangeCode,
} from "../calendar/google.js";

export class CalendarRepository {
  constructor(readonly pool: Pool) {}
  async status(group: string, wallet: string) {
    const connection = (
      await this.pool.query(
        "SELECT email,needs_reconnect FROM converge_calendar_connections WHERE wallet_address=$1",
        [wallet],
      )
    ).rows[0];
    const job = (
      await this.pool.query(
        "SELECT enabled,status,event_url,error_code,duration_minutes FROM converge_calendar_jobs WHERE group_id=$1 AND wallet_address=$2",
        [group, wallet],
      )
    ).rows[0];
    return {
      configured: calendarConfigured(),
      connected: !!connection,
      email: connection?.email ?? null,
      needsReconnect: connection?.needs_reconnect ?? false,
      job: job ?? null,
    };
  }
  async start(group: string, wallet: string, session: string) {
    const state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url");
    const url = authorizationUrl(state, verifier);
    await this.pool.query(
      "DELETE FROM converge_calendar_oauth_states WHERE expires_at<now() OR session_hash=$1",
      [digest(session)],
    );
    await this.pool.query(
      "INSERT INTO converge_calendar_oauth_states(state_hash,session_hash,wallet_address,group_id,verifier_encrypted,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
      [
        digest(state),
        digest(session),
        wallet,
        group,
        seal(verifier, digest(state)),
      ],
    );
    return { url, state };
  }
  async finish(state: string, code: string, wallet: string, session: string) {
    const result = await this.pool.query(
      "SELECT group_id,verifier_encrypted FROM converge_calendar_oauth_states WHERE state_hash=$1 AND session_hash=$2 AND wallet_address=$3 AND expires_at>now()",
      [digest(state), digest(session), wallet],
    );
    const pending = result.rows[0];
    if (!pending) throw new Error("INVALID_CALENDAR_STATE");
    const google = await exchangeCode(
      code,
      unseal(pending.verifier_encrypted, digest(state)),
    );
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      // Serializes reconnect/disconnect and worker use for this wallet.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "calendar:" + wallet,
      ]);
      const consumed = await db.query(
        "DELETE FROM converge_calendar_oauth_states s WHERE state_hash=$1 AND session_hash=$2 AND wallet_address=$3 AND expires_at>now() AND EXISTS (SELECT 1 FROM converge_auth_sessions a WHERE a.token_hash=s.session_hash AND a.revoked_at IS NULL AND a.expires_at>now()) RETURNING group_id",
        [digest(state), digest(session), wallet],
      );
      if (consumed.rowCount !== 1) throw new Error("INVALID_CALENDAR_STATE");
      await db.query(
        "UPDATE converge_calendar_jobs SET enabled=false WHERE wallet_address=$1 AND google_subject<>$2",
        [wallet, google.subject],
      );
      await db.query(
        "INSERT INTO converge_calendar_connections(wallet_address,google_subject,email,refresh_token_encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(wallet_address) DO UPDATE SET google_subject=$2,email=$3,refresh_token_encrypted=$4,needs_reconnect=false,connected_at=now()",
        [
          wallet,
          google.subject,
          google.email,
          seal(google.refreshToken, wallet),
        ],
      );
      await db.query(
        "UPDATE converge_calendar_jobs SET status='waiting',error_code=NULL,next_attempt_at=now() WHERE wallet_address=$1 AND google_subject=$2 AND error_code='RECONNECT_GOOGLE'",
        [wallet, google.subject],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    return pending.group_id as string;
  }
  async enable(group: string, wallet: string, duration: number) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "calendar:" + wallet,
      ]);
      const connection = (
        await db.query(
          "SELECT google_subject FROM converge_calendar_connections WHERE wallet_address=$1 AND NOT needs_reconnect",
          [wallet],
        )
      ).rows[0];
      if (!connection) throw new Error("RECONNECT_GOOGLE");
      await db.query(
        `INSERT INTO converge_calendar_jobs(group_id,wallet_address,google_subject,duration_minutes,event_id) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(group_id,wallet_address) DO UPDATE SET enabled=true,google_subject=$3,duration_minutes=CASE WHEN converge_calendar_jobs.status='synced' AND converge_calendar_jobs.google_subject=$3 THEN converge_calendar_jobs.duration_minutes ELSE $4 END,
    event_id=$5,event_url=CASE WHEN converge_calendar_jobs.google_subject=$3 THEN converge_calendar_jobs.event_url ELSE NULL END,
    status=CASE WHEN converge_calendar_jobs.google_subject=$3 AND converge_calendar_jobs.status='synced' THEN 'synced' ELSE 'waiting' END,error_code=NULL,next_attempt_at=now()`,
        [
          group,
          wallet,
          connection.google_subject,
          duration,
          eventId(group, wallet, connection.google_subject),
        ],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async disable(group: string, wallet: string) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "calendar:" + wallet,
      ]);
      await db.query(
        "UPDATE converge_calendar_jobs SET enabled=false WHERE group_id=$1 AND wallet_address=$2",
        [group, wallet],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async disconnect(wallet: string) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "calendar:" + wallet,
      ]);
      await db.query(
        "DELETE FROM converge_calendar_connections WHERE wallet_address=$1",
        [wallet],
      );
      await db.query(
        "DELETE FROM converge_calendar_oauth_states WHERE wallet_address=$1",
        [wallet],
      );
      await db.query(
        "UPDATE converge_calendar_jobs SET enabled=false WHERE wallet_address=$1",
        [wallet],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
}
