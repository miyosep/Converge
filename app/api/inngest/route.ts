import { serve } from "inngest/next";
import { inngest } from "../../../src/lib/jobs/client.js";
import {
  processJob,
  recoverJobs,
  calendarJobs,
} from "../../../src/lib/jobs/functions.js";

export const runtime = "nodejs";
export const maxDuration = 300;
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processJob, recoverJobs, calendarJobs],
});
