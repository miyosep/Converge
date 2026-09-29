import { inngest, jobSchema } from "./client.js";
import { inngestJobsEnabled } from "./config.js";
import { scanJobs } from "./scan.js";
import { runJob } from "./run.js";
import { databasePool } from "../db/pool.js";
import { syncCalendars } from "../calendar/worker.js";
import { calendarConfigured } from "../calendar/google.js";

export const processJob = inngest.createFunction(
  {
    id: "process-saved-work",
    triggers: { event: "converge/job.requested" },
    singleton: { key: "event.data.key", mode: "skip" },
    concurrency: { limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    const job = jobSchema.parse(event.data);
    if (!inngestJobsEnabled()) return;
    for (let i = 0; i < 30; i++) {
      const more = await step.run(`advance-${i}`, () => runJob(job));
      if (job.kind === "group" && !more && calendarConfigured())
        await step.sendEvent(`calendar-${i}`, {
          name: "converge/calendar.requested",
          data: {},
        });
      if (!more) return;
      if (i < 29) await step.sleep(`confirmations-${i}`, "10s");
    }
  },
);

// DB state is the durable queue. This recovers lost sends, function timeouts and
// wallet transactions made while the browser is closed. Pagination avoids a
// permanent first-page bias. Only IDs leave the application database.
export const recoverJobs = inngest.createFunction(
  {
    id: "recover-saved-work",
    triggers: { cron: "*/5 * * * *" },
    singleton: { key: '"recovery"', mode: "skip" },
    retries: 2,
  },
  async ({ step }) => {
    if (!inngestJobsEnabled()) return;
    let cursor = "";
    for (let page = 0; ; page++) {
      const jobs: { kind: "explore" | "group"; id: string; key: string }[] =
        await step.run(`scan-${page}`, () => scanJobs(databasePool(), cursor));
      if (!jobs.length) break;
      await step.sendEvent(
        `dispatch-${page}`,
        jobs.map((job) => ({ name: "converge/job.requested", data: job })),
      );
      cursor = jobs[jobs.length - 1]!.key;
    }
    await step.run("health", async () => {
      await databasePool().query(
        "INSERT INTO converge_job_health(name) VALUES('dispatcher') ON CONFLICT(name) DO UPDATE SET checked_at=now()",
      );
    });
  },
);

export const calendarJobs = inngest.createFunction(
  {
    id: "calendar-sync",
    triggers: [
      { cron: "*/5 * * * *" },
      { event: "converge/calendar.requested" },
    ],
    singleton: { key: '"calendar"', mode: "skip" },
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    if (!inngestJobsEnabled() || !calendarConfigured()) return;
    for (let i = 0; i < 20; i++) {
      const synced = await step.run(`sync-${i}`, () =>
        syncCalendars(databasePool(), 1),
      );
      if (!synced) break;
    }
  },
);
