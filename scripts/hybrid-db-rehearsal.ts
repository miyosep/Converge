import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { databasePool } from "../src/lib/db/pool.js";
import { DatabaseExploreStore } from "../src/lib/explore/database-store.js";
import { inngest, notifyJob } from "../src/lib/jobs/client.js";
import { scanJobs, jobHeartbeat } from "../src/lib/jobs/scan.js";
import { hybridCycle } from "../src/lib/jobs/hybrid.js";

async function main() {
  if (process.env.NEON_BRANCH !== "dev-vercel-inngest")
    throw new Error("TEST_BRANCH_REQUIRED");
  process.env.BACKGROUND_DRIVER = "hybrid";
  process.env.BACKGROUND_JOBS_ENABLED = "true";
  process.env.EXPLORE_DEMO_ENABLED = "true";
  process.env.GROUP_EXECUTION_ENABLED = "false";
  const pool = databasePool();
  const store = new DatabaseExploreStore(pool);
  const runs: string[] = [];
  let sends = 0;
  const send = inngest.send;
  inngest.send = async () => {
    sends++;
    throw new Error("INNGEST_MUST_NOT_BE_USED");
  };
  try {
    const wallet = privateKeyToAccount(generatePrivateKey()).address;
    const run = await store.create(wallet, 20);
    runs.push(run.id);
    assert.equal(
      (await scanJobs(pool)).some((j) => j.id === run.id),
      false,
    );
    await notifyJob({ kind: "explore", id: run.id });
    assert.equal(sends, 0);
    assert.equal(
      (await scanJobs(pool)).some((j) => j.id === run.id),
      true,
    );
    await store.queue(wallet, { action: "extract", text: "quiet dinner" });
    await pool.query(
      "UPDATE converge_job_wakeups SET dispatched_at=now()-interval '2 minutes' WHERE name=$1",
      [`explore:${run.id}`],
    );
    assert.equal(
      (await scanJobs(pool)).some((j) => j.id === run.id),
      true,
      "Commands survive lost wakeups",
    );
    let executed = false;
    await hybridCycle(
      pool,
      async (job) => {
        if (job.id === run.id) executed = true;
        return false;
      },
      async () => {},
    );
    assert.equal(executed, true);
    assert.equal(await store.online(), true);
    await pool.query(
      "UPDATE converge_job_health SET checked_at=now()-interval '2 minutes' WHERE name='hybrid'",
    );
    await jobHeartbeat(pool, "dispatcher");
    assert.equal(
      await store.online(),
      false,
      "Inngest heartbeat cannot mask an offline PC",
    );
    console.log(
      "Hybrid DB rehearsal passed: durable dispatch, no Inngest sends, polling, command recovery and PC-specific health. No chain, AI or Google calls.",
    );
  } finally {
    inngest.send = send;
    for (const id of runs) {
      await pool.query("DELETE FROM converge_job_wakeups WHERE name=$1", [
        `explore:${id}`,
      ]);
      await pool.query("DELETE FROM converge_explore_runs WHERE id=$1", [id]);
    }
    await pool.end();
  }
}
main().catch(() => {
  console.error("Hybrid DB rehearsal failed; credentials withheld.");
  process.exitCode = 1;
});
