import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export class JobBusy extends Error {
  constructor() {
    super("JOB_BUSY");
  }
}
export class JobLease {
  constructor(
    readonly pool: Pool,
    readonly name: string,
    readonly token: string,
  ) {}
  async assert(db: Pool | PoolClient = this.pool, lock = false) {
    const result = await db.query(
      `SELECT 1 FROM converge_job_leases WHERE name=$1 AND token=$2 AND expires_at>clock_timestamp() ${lock ? "FOR UPDATE" : ""}`,
      [this.name, this.token],
    );
    if (!result.rowCount) throw new Error("JOB_LEASE_LOST");
  }
}

// Leases survive process death; fencing is checked in the same transaction as
// every durable write. A stale invocation cannot save a newly signed transaction.
export async function withJobLease<T>(
  pool: Pool,
  name: string,
  work: (lease: JobLease) => Promise<T>,
) {
  const token = randomUUID();
  const result = await pool.query(
    `INSERT INTO converge_job_leases(name,token,expires_at) VALUES($1,$2,clock_timestamp()+interval '240 seconds')
     ON CONFLICT(name) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at
     WHERE converge_job_leases.expires_at<=clock_timestamp() RETURNING name`,
    [name, token],
  );
  if (!result.rowCount) throw new JobBusy();
  try {
    return await work(new JobLease(pool, name, token));
  } finally {
    await pool.query(
      "DELETE FROM converge_job_leases WHERE name=$1 AND token=$2",
      [name, token],
    );
  }
}

export async function guardedTransaction<T>(
  pool: Pool,
  leases: JobLease[],
  work: (db: PoolClient) => Promise<T>,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const lease of [...leases].sort((a, b) =>
      a.name.localeCompare(b.name),
    ))
      await lease.assert(db, true);
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
