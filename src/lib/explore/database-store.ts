import type { Pool } from "pg";
import { addressSchema } from "../schemas/primitives.js";
import {
  ExploreStore,
  ExploreError,
  commandSchema,
  validateLiveCommand,
  walletId,
} from "./store.js";
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
  override async create(address: string, maxRuns: number) {
    const judge = addressSchema.parse(address);
    const id = walletId(judge);
    return withJobLease(this.pool, "explore:admission", async (admission) => {
      this.admissionLease = admission;
      try {
        return await this.withRunLock(id, async () => {
          const existing = await this.read(id);
          if (existing) return existing;
          if ((await this.ids()).length >= maxRuns)
            throw new ExploreError("DEMO_SESSION_LIMIT");
          const run: ExploreRun = {
            id,
            judge,
            createdAt: new Date().toISOString(),
            phase: "preferences",
            revision: 0,
            extractionCalls: 0,
            transactions: [],
            approvals: 0,
            contributions: [],
            refund: "0",
            refunded: false,
          };
          await admission.assert();
          await this.save(run);
          return run;
        });
      } finally {
        this.admissionLease = undefined;
      }
    });
  }
  override async queue(address: string, input: unknown) {
    const command = commandSchema.parse(input);
    const id = walletId(address);
    return this.withRunLock(id, async () => {
      const run = await this.read(id);
      if (!run || run.judge.toLowerCase() !== address.toLowerCase())
        throw new ExploreError("RUN_NOT_FOUND");
      if (run.command) throw new ExploreError("DEMO_BUSY");
      if (command.action === "search" || command.action === "select_place") {
        validateLiveCommand(run, command);
      } else if (command.action === "extract") {
        if (
          !["preferences", "review"].includes(run.phase) ||
          Boolean(run.searchCalls) ||
          run.extractionCalls >= 3
        )
          throw new ExploreError("EXTRACTION_LIMIT_OR_LOCKED");
      } else if (command.action === "confirm") {
        if (
          run.phase !== "review" ||
          !run.extraction ||
          command.revision !== run.revision
        )
          throw new ExploreError("STALE_REVISION");
      } else if (run.phase !== "proposal")
        throw new ExploreError("POLICY_NOT_READY");
      run.command = command;
      delete run.error;
      await this.save(run);
      return run;
    });
  }
}
