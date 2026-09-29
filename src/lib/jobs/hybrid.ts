import type { Pool } from "pg";
import type { Job } from "./client.js";
import { scanJobs, jobHeartbeat } from "./scan.js";

export async function hybridCycle(
  pool: Pool,
  execute: (job: Job) => Promise<boolean>,
  calendar: () => Promise<unknown>,
  stopping: () => boolean = () => false,
  failed: () => void = () => {},
) {
  let cursor = "";
  let count = 0;
  while (!stopping()) {
    const jobs = await scanJobs(pool, cursor);
    await jobHeartbeat(pool, "hybrid");
    if (!jobs.length) break;
    for (const job of jobs) {
      if (stopping()) return count;
      try {
        await execute(job);
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
}
