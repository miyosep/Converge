import type { Pool } from "pg";
import { ExploreStore, ExploreError } from "./store.js";
import { latestRuns } from "./sessions.js";
import type { ExploreRun } from "./types.js";
import {
  JobBusy,
  JobLease,
  guardedTransaction,
  withJobLease,
} from "../jobs/lease.js";

export class DatabaseExploreStore extends ExploreStore {
  private runLease: JobLease | undefined;
  private admissionLease: JobLease | undefined;
  constructor(
    readonly pool: Pool,
    readonly workerLease?: JobLease,
  ) {
    super();
  }
  override async init() {
    await this.pool.query("SELECT 1 FROM converge_explore_runs LIMIT 1");
  }
  override async online() {
    return !!(
      await this.pool.query(
        "SELECT 1 FROM converge_job_health WHERE name=$1 AND checked_at>now()-($2::int * interval '1 second')",
        process.env.BACKGROUND_DRIVER === "hybrid"
          ? ["hybrid", 90]
          : ["dispatcher", 720],
      )
    ).rowCount;
  }
  override async read(id: string): Promise<ExploreRun | undefined> {
    this.path(id); // Validate the same opaque ID used by the file implementation.
    return (
      await this.pool.query(
        "SELECT data FROM converge_explore_runs WHERE id=$1",
        [id],
      )
    ).rows[0]?.data;
  }
  override async ids() {
    return (
      await this.pool.query<{ id: string }>(
        "SELECT id FROM converge_explore_runs ORDER BY id",
      )
    ).rows.map((r) => r.id);
  }
  override async save(run: ExploreRun) {
    if (!this.runLease) throw new Error("RUN_LOCK_REQUIRED");
    await guardedTransaction(
      this.pool,
      [
        this.runLease,
        ...(this.workerLease ? [this.workerLease] : []),
        ...(this.admissionLease ? [this.admissionLease] : []),
      ],
      async (db) => {
        await db.query(
          "INSERT INTO converge_explore_runs(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()",
          [run.id, JSON.stringify(run)],
        );
      },
    );
  }
  override async withRunLock<T>(
    id: string,
    work: () => Promise<T>,
  ): Promise<T> {
    this.path(id);
    try {
      return await withJobLease(this.pool, `explore:${id}`, async (lease) => {
        this.runLease = lease;
        try {
          return await work();
        } finally {
          this.runLease = undefined;
        }
      });
    } catch (error) {
      if (error instanceof JobBusy) throw new ExploreError("DEMO_BUSY");
      throw error;
    }
  }
  override async listRuns(address?: string): Promise<ExploreRun[]> {
    const result = await this.pool.query<{ data: ExploreRun }>(
      address
        ? "SELECT data FROM converge_explore_runs WHERE lower(data->>'judge')=$1"
        : "SELECT data FROM converge_explore_runs",
      address ? [address.toLowerCase()] : [],
    );
    return latestRuns(result.rows.map((row) => row.data));
  }
  override async withAdmissionLock<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await withJobLease(
        this.pool,
        "explore:admission",
        async (admission) => {
          this.admissionLease = admission;
          try {
            return await work();
          } finally {
            this.admissionLease = undefined;
          }
        },
      );
    } catch (error) {
      if (error instanceof JobBusy) throw new ExploreError("DEMO_BUSY");
      throw error;
    }
  }
}
