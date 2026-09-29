import assert from "node:assert/strict";
import test from "node:test";
import { serverlessJobs, jobsEnabled } from "../src/lib/jobs/config.js";
import { jobSchema } from "../src/lib/jobs/client.js";
import { exploreNeedsWork } from "../src/lib/jobs/run.js";
import type { ExploreRun } from "../src/lib/explore/types.js";
import { ExploreWorker } from "../scripts/lib/explore-worker.js";

test("Vercel cannot fall back to file workers and preview deployments cannot sign", () => {
  const original = { ...process.env };
  try {
    process.env.VERCEL = "1";
    delete process.env.BACKGROUND_DRIVER;
    assert.throws(serverlessJobs, /Vercel requires/);
    process.env.BACKGROUND_DRIVER = "inngest";
    process.env.BACKGROUND_JOBS_ENABLED = "true";
    process.env.VERCEL_ENV = "preview";
    assert.equal(jobsEnabled(), false);
    process.env.VERCEL_ENV = "production";
    assert.equal(jobsEnabled(), true);
    process.env.BACKGROUND_JOBS_ENABLED = "false";
    assert.equal(jobsEnabled(), false);
  } finally {
    process.env = original;
  }
});

test("job inputs retain legacy group IDs but reject arbitrary demo paths", () => {
  assert.equal(
    jobSchema.parse({ kind: "group", id: "acceptance-baseline-001" }).id,
    "acceptance-baseline-001",
  );
  assert.equal(
    jobSchema.safeParse({ kind: "explore", id: "../../private/transactions" })
      .success,
    false,
  );
});

test("saved commands and pending automation resume; waiting for preferences does not poll", () => {
  const run = { phase: "preferences" } as ExploreRun;
  assert.equal(exploreNeedsWork(run), false);
  run.command = { action: "extract", text: "quiet" };
  assert.equal(exploreNeedsWork(run), true);
  delete run.command;
  run.phase = "completed";
  run.policy = {} as ExploreRun["policy"] & object;
  assert.equal(exploreNeedsWork(run), true);
  run.automationComplete = true;
  assert.equal(exploreNeedsWork(run), false);
});

test("an interrupted extraction keeps its command and has a bounded retry budget", async () => {
  const key = process.env.KILN_API_KEY;
  delete process.env.KILN_API_KEY;
  let saved: ExploreRun = {
    id: "a".repeat(64),
    judge: "0x0000000000000000000000000000000000000999",
    createdAt: new Date().toISOString(),
    phase: "preferences",
    revision: 0,
    extractionCalls: 0,
    transactions: [],
    approvals: 0,
    contributions: [],
    refund: "0",
    refunded: false,
    command: { action: "extract", text: "quiet" },
  };
  const worker = Object.assign(
    Object.create(ExploreWorker.prototype) as ExploreWorker,
    {
      ledger: {},
      store: {
        save: async (run: ExploreRun) => {
          saved = structuredClone(run);
        },
      },
      deployer: { address: "0x1" },
      executor: { address: "0x2" },
      bots: [],
      token: "0x3",
      escrow: "0x4",
      roles: { merchants: {} },
    },
  );
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await assert.rejects(worker.tick(structuredClone(saved)), /KILN_API_KEY/);
      assert.equal(saved.extractionCalls, 1);
      assert.equal(saved.revision, 1);
      assert.equal(saved.extractionAttempts, attempt);
      assert.equal(saved.command?.action, "extract");
    }
    await worker.tick(structuredClone(saved));
    assert.equal(saved.command, undefined);
    assert.equal(saved.error, "EXTRACTION_FAILED");
  } finally {
    if (key === undefined) delete process.env.KILN_API_KEY;
    else process.env.KILN_API_KEY = key;
  }
});
