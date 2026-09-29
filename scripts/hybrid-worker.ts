import { setTimeout as sleep } from "node:timers/promises";
import { databasePool } from "../src/lib/db/pool.js";
import { jobsEnabled } from "../src/lib/jobs/config.js";
import { hybridCycle } from "../src/lib/jobs/hybrid.js";
import { runJob } from "../src/lib/jobs/run.js";
import { calendarConfigured } from "../src/lib/calendar/google.js";
import { syncCalendars } from "../src/lib/calendar/worker.js";
import { withHybridLock } from "./lib/hybrid-lock.js";

async function main() {
  if (
    process.env.VERCEL ||
    process.env.BACKGROUND_DRIVER !== "hybrid" ||
    !jobsEnabled()
  )
    throw new Error("HYBRID_CONFIGURATION_REQUIRED");
  process.env.HYBRID_WORKER_PROCESS = "true";
  const pool = databasePool();
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  try {
    await pool.query("SELECT 1 FROM converge_job_transactions LIMIT 1");
    await pool.query("SELECT 1 FROM converge_explore_runs LIMIT 1");
    await pool.query(
      "SELECT acknowledged_at FROM converge_job_wakeups LIMIT 1",
    );
    await pool.query("SELECT search_token FROM converge_live_plans LIMIT 1");
    await pool.query("SELECT 1 FROM converge_live_preferences LIMIT 1");
    if (process.argv.includes("--check")) {
      console.log(
        "Hybrid database connection and migrations verified. No jobs executed.",
      );
      return;
    }
    console.log(
      "Hybrid processor running. No inbound ports or Inngest connection required.",
    );
    do {
      // Terminate a stuck cycle so the supervisor can restart it. Durable leases
      // and signed journals remain authoritative after this process disappears.
      const watchdog = setTimeout(() => process.exit(1), 10 * 60_000);
      try {
        await hybridCycle(
          pool,
          async (job) => {
            watchdog.refresh();
            try {
              return await runJob(job);
            } finally {
              watchdog.refresh();
            }
          },
          async () => {
            if (calendarConfigured()) await syncCalendars(pool, 1);
          },
          () => stopping,
          () => console.error("Saved job delayed; retrying on the next scan."),
        );
      } catch {
        console.error(
          "Database scan delayed; reconnecting without discarding saved work.",
        );
        if (process.argv.includes("--once")) throw new Error("SCAN_FAILED");
      } finally {
        clearTimeout(watchdog);
      }
      if (process.argv.includes("--once")) break;
      if (!stopping) await sleep(5000);
    } while (!stopping);
  } finally {
    await pool.end();
  }
}
const needsSignerLock =
  !process.argv.includes("--check") &&
  (process.env.EXPLORE_DEMO_ENABLED === "true" ||
    process.env.GROUP_EXECUTION_ENABLED === "true");
(needsSignerLock ? withHybridLock(main) : main()).catch((error: unknown) => {
  if (
    error instanceof Error &&
    error.message === "ANOTHER_LOCAL_WORKER_IS_RUNNING"
  ) {
    console.error(
      "A local signer is already running. Stop the legacy Explore/group worker before starting hybrid mode.",
    );
  }
  console.error(
    "Hybrid processor stopped. Check the private environment file and database configuration.",
  );
  process.exitCode = 1;
});
