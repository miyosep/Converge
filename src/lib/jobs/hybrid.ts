import type { Pool } from "pg";
import type { Job } from "./client.js";
import { scanJobs, jobHeartbeat, acknowledgeJob } from "./scan.js";

export async function hybridCycle(
  pool: Pool,
  execute: (job: Job) => Promise<boolean>,
  calendar: () => Promise<unknown>,
  stopping: () => boolean = () => false,
  failed: () => void = () => {},
) {
  // Keep readiness fresh during AI/search/RPC waits, with at most one write in flight.
  let heartbeat: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (!heartbeat)
      heartbeat = jobHeartbeat(pool, "hybrid")
        .catch(() => {
          failed();
        })
        .finally(() => {
          heartbeat = undefined;
        });
  }, 20000);
  timer.unref();
  try {
    let cursor = "";
    let count = 0;
    while (!stopping()) {
      const jobs = await scanJobs(pool, cursor);
      await jobHeartbeat(pool, "hybrid");
      if (!jobs.length) break;
      for (const job of jobs) {
        if (stopping()) return count;
        try {
          const more = await execute(job);
          if (!more) await acknowledgeJob(pool, job.key, job.wakeup);
          // Consume a fresh chain snapshot before the next group delays it.
          if (job.kind === "group") await calendar();
        } catch {
          failed(); // One failing job must not starve the rest of the queue.
        }
        count++;
        await jobHeartbeat(pool, "hybrid");
      }
      cursor = jobs[jobs.length - 1]!.key;
    }
    if (!stopping()) await calendar();
    return count;
  } finally {
    clearInterval(timer);
    await heartbeat;
  }
}
