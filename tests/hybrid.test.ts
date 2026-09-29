import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withHybridLock } from "../scripts/lib/hybrid-lock.js";
import {
  executionEnabled,
  inngestJobsEnabled,
  jobsEnabled,
  serverlessJobs,
} from "../src/lib/jobs/config.js";
import { hybridCycle } from "../src/lib/jobs/hybrid.js";
import { hybridEnvironment } from "../scripts/lib/hybrid-environment.js";

test("PC configuration overrides stale shell variables and clears omitted app secrets", () => {
  const env = hybridEnvironment(
    {
      PATH: "node-path",
      DATABASE_URL: "wrong-database",
      BACKGROUND_DRIVER: "inngest",
      AGENT_EXECUTOR_PRIVATE_KEY: "old-key",
      HYBRID_WORKER_PROCESS: "true",
    },
    "DATABASE_URL=\nBACKGROUND_DRIVER=local\nAGENT_EXECUTOR_PRIVATE_KEY=\n",
    "DATABASE_URL=selected-database\nBACKGROUND_DRIVER=hybrid\n",
  );
  assert.equal(env.DATABASE_URL, "selected-database");
  assert.equal(env.BACKGROUND_DRIVER, "hybrid");
  assert.equal(env.AGENT_EXECUTOR_PRIVATE_KEY, undefined);
  assert.equal(env.HYBRID_WORKER_PROCESS, undefined);
  assert.equal(env.PATH, "node-path");
});

test("PC lock refuses a live legacy signer and releases its own lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "converge-hybrid-lock-"));
  const old = process.env.EXPLORE_DEMO_DIRECTORY;
  process.env.EXPLORE_DEMO_DIRECTORY = root;
  try {
    await withHybridLock(async () => {
      assert.equal(
        await readFile(join(root, "worker.lock"), "utf8"),
        String(process.pid),
      );
      await assert.rejects(
        withHybridLock(async () => {}),
        /ANOTHER_LOCAL_WORKER/,
      );
    });
    await assert.rejects(readFile(join(root, "worker.lock")), {
      code: "ENOENT",
    });
    await writeFile(join(root, "worker.lock"), "not-a-pid");
    await assert.rejects(
      withHybridLock(async () => {}),
      /INVALID_WORKER_LOCK/,
    );
  } finally {
    if (old === undefined) delete process.env.EXPLORE_DEMO_DIRECTORY;
    else process.env.EXPLORE_DEMO_DIRECTORY = old;
    await rm(root, { recursive: true, force: true });
  }
});

test("hybrid web uses DB storage but cannot execute jobs; only the PC can execute", () => {
  const original = { ...process.env };
  try {
    process.env.BACKGROUND_DRIVER = "hybrid";
    process.env.BACKGROUND_JOBS_ENABLED = "true";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.HYBRID_WORKER_PROCESS = "true";
    assert.equal(serverlessJobs(), true);
    assert.equal(jobsEnabled(), true);
    assert.equal(inngestJobsEnabled(), false);
    assert.equal(executionEnabled(), false);
    delete process.env.VERCEL;
    assert.equal(executionEnabled(), true);
    delete process.env.HYBRID_WORKER_PROCESS;
    assert.equal(executionEnabled(), false);
    process.env.VERCEL_ENV = "preview";
    assert.equal(jobsEnabled(), false);
  } finally {
    process.env = original;
  }
});

test("hybrid scan advances pages, isolates failures and refreshes calendar after groups", async () => {
  let pages = 0,
    failures = 0;
  const order: string[] = [];
  const pool = {
    query: async (sql: string, args: unknown[]) => {
      if (!sql.startsWith("SELECT")) return { rows: [] };
      pages++;
      if (pages === 1)
        return {
          rows: [
            { kind: "explore", id: "a", key: "explore:a" },
            { kind: "group", id: "b", key: "group:b" },
          ],
        };
      assert.equal(args[0], "group:b");
      return { rows: [] };
    },
  } as unknown as Pool;
  const count = await hybridCycle(
    pool,
    async (job) => {
      order.push(job.id);
      if (job.id === "a") throw new Error("Simulated interruption");
      return false;
    },
    async () => {
      order.push("calendar");
    },
    () => false,
    () => {
      failures++;
    },
  );
  assert.equal(count, 2);
  assert.equal(failures, 1);
  assert.equal(pages, 2);
  assert.deepEqual(order, ["a", "b", "calendar", "calendar"]);
});

test("heartbeat stays fresh while a job is pending and stops when the cycle ends", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let beats = 0,
    pages = 0;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pool = {
    query: async (sql: string) => {
      if (sql.startsWith("SELECT"))
        return {
          rows:
            pages++ === 0
              ? [{ kind: "explore", id: "a", key: "explore:a" }]
              : [],
        };
      if (sql.includes("converge_job_health")) beats++;
      return { rows: [] };
    },
  } as unknown as Pool;
  const cycle = hybridCycle(
    pool,
    async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return false;
    },
    async () => {},
  );
  await started;
  const initial = beats;
  t.mock.timers.tick(20000);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(beats > initial);
  release();
  await cycle;
  const final = beats;
  t.mock.timers.tick(90000);
  await Promise.resolve();
  assert.equal(beats, final);
});
