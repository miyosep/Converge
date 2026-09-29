import { Pool } from "pg";
import { assertLocalWorker } from "../src/lib/jobs/config.js";
import { setTimeout as sleep } from "node:timers/promises";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { calendarConfig } from "../src/lib/calendar/google.js";
import { syncCalendars } from "../src/lib/calendar/worker.js";

async function main() {
  assertLocalWorker();
  calendarConfig();
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url || new URL(url).hostname.includes("-pooler"))
    throw new Error("Direct database connection required");
  const pool = new Pool({
    connectionString: verifiedPostgresUrl(url),
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  let stopped = false;
  process.on("SIGINT", () => {
    stopped = true;
  });
  process.on("SIGTERM", () => {
    stopped = true;
  });
  try {
    await pool.query("SELECT 1 FROM converge_calendar_jobs LIMIT 1");
    if (process.argv.includes("--check")) {
      console.log("Calendar configuration and schema ready.");
      return;
    }
    do {
      const count = await syncCalendars(pool);
      if (count) console.log(`Added ${count} calendar event(s).`);
      if (!stopped && !process.argv.includes("--once")) await sleep(15000);
    } while (!stopped && !process.argv.includes("--once"));
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Calendar worker unavailable. Check Google configuration and migration. No credentials printed.",
  );
  process.exitCode = 1;
});
