import { Inngest } from "inngest";
import { jobsEnabled } from "./config.js";
import { z } from "zod";
import { databasePool } from "../db/pool.js";
import { idSchema } from "../schemas/primitives.js";

export const jobSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("explore"),
    id: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({ kind: z.literal("group"), id: idSchema }),
]);
export type Job = z.infer<typeof jobSchema>;
export const inngest = new Inngest({
  id: "converge",
  checkpointing: false,
  ...(process.env.VERCEL ? { isDev: false } : {}),
});

// Durable database records remain eligible for the recovery sweep when event
// delivery fails. Only opaque IDs, never preferences or keys, enter Inngest.
export async function notifyJob(job: Job) {
  if (!jobsEnabled()) return;
  try {
    const key = `${job.kind}:${job.id}`;
    const claimed = await databasePool().query(
      `INSERT INTO converge_job_wakeups(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET dispatched_at=now() WHERE converge_job_wakeups.dispatched_at<now()-interval '10 seconds' RETURNING name`,
      [key],
    );
    if (claimed.rowCount)
      await inngest.send({
        name: "converge/job.requested",
        data: { ...job, key },
      });
  } catch {
    console.error("Background dispatch delayed; saved work will be recovered.");
  }
}
