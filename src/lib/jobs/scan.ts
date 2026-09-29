import type { Pool } from "pg";
import type { Job } from "./client.js";

export async function scanJobs(pool: Pool, cursor = "") {
  const result = await pool.query<Job & { key: string; wakeup: string | null }>(
    `SELECT jobs.*,w.dispatched_at::text AS wakeup FROM (
      SELECT 'explore' AS kind,id,'explore:' || id AS key FROM converge_explore_runs r
      WHERE $2 AND (data ? 'command' OR
        (data ? 'policy' AND NOT COALESCE((data->>'automationComplete')::boolean,false)
         AND data->>'phase' NOT IN ('preferences','review','proposal')) OR
        EXISTS(SELECT 1 FROM converge_job_wakeups w WHERE w.name='explore:' || r.id AND (w.acknowledged_at IS NULL OR w.dispatched_at>w.acknowledged_at)))
      UNION ALL
      SELECT 'group',p.group_id::text,'group:' || p.group_id FROM converge_group_policies p
      LEFT JOIN converge_group_execution e USING(decision_id)
      WHERE $3 AND (e.status='pending' OR (p.policy->>'expiry')::bigint>extract(epoch FROM now())-86400 OR
        EXISTS(SELECT 1 FROM converge_calendar_jobs c WHERE c.group_id=p.group_id AND c.enabled AND c.status IN ('waiting','retry')) OR
        EXISTS(SELECT 1 FROM converge_job_wakeups w WHERE w.name='group:' || p.group_id AND (w.acknowledged_at IS NULL OR w.dispatched_at>w.acknowledged_at)))
    ) jobs LEFT JOIN converge_job_wakeups w ON w.name=jobs.key
    WHERE key>$1 ORDER BY key LIMIT 100`,
    [
      cursor,
      process.env.EXPLORE_DEMO_ENABLED === "true",
      process.env.GROUP_EXECUTION_ENABLED === "true",
    ],
  );
  return result.rows;
}

export async function acknowledgeJob(
  pool: Pool,
  key: string,
  wakeup: string | null | undefined,
) {
  if (!wakeup) return;
  // A request arriving during execution must remain queued for the next pass.
  await pool.query(
    "UPDATE converge_job_wakeups SET acknowledged_at=dispatched_at WHERE name=$1 AND dispatched_at=$2::timestamptz",
    [key, wakeup],
  );
}

// Successful scans are the readiness signal; no credentials enter health rows.
export async function jobHeartbeat(pool: Pool, name: string) {
  await pool.query(
    "INSERT INTO converge_job_health(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET checked_at=now()",
    [name],
  );
}
