import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  ExploreError,
  atomicJson,
  withFileLock,
} from "../src/lib/explore/store.js";
import { ExploreWorker } from "./lib/explore-worker.js";

async function main() {
  const worker = new ExploreWorker();
  await worker.store.init();
  await withFileLock(join(worker.store.root, "worker.lock"), async () => {
    await worker.init();
    if (process.argv.includes("--check")) {
      console.log("Explore Demo preflight passed. No transactions submitted.");
      return;
    }
    let stopping = false;
    process.on("SIGINT", () => {
      stopping = true;
    });
    process.on("SIGTERM", () => {
      stopping = true;
    });
    const heartbeat = async () => {
      await atomicJson(join(worker.store.root, "heartbeat.json"), {
        at: new Date().toISOString(),
      });
    };
    await heartbeat();
    const interval = setInterval(() => {
      void heartbeat().catch(() => {});
    }, 10000);
    console.log(
      "Explore Demo worker ready. Waiting for authenticated judge sessions.",
    );
    try {
      do {
        for (const id of await worker.store.ids()) {
          try {
            await withFileLock(`${worker.store.path(id)}.lock`, async () => {
              const run = (await worker.store.read(id))!;
              try {
                delete run.error;
                await worker.tick(run);
              } catch (error) {
                // Provider messages may contain RPC credentials; keep browser and console errors generic.
                const message = error instanceof Error ? error.message : "";
                run.error = [
                  "DEMO_ETH_BUDGET_EXCEEDED",
                  "WAITING_FOR_CONFIRMATIONS",
                  "WAITING_FOR_CANONICAL_RECEIPT",
                  "WAITING_FOR_OTHER_TRANSACTION",
                ].includes(message)
                  ? message
                  : "RUNNER_ACTION_PENDING_OR_FAILED";
                console.error(`Explore run ${id.slice(0, 8)}: ${run.error}`);
              }
              await worker.store.save(run);
            });
          } catch (error) {
            if (!(error instanceof ExploreError)) throw error;
          }
        }
        if (!stopping && !process.argv.includes("--once")) await sleep(3000);
      } while (!stopping && !process.argv.includes("--once"));
    } finally {
      clearInterval(interval);
    }
  });
}
main().catch((error: unknown) => {
  const name =
    error instanceof Error
      ? error.name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40)
      : "UnknownError";
  const frame =
    error instanceof Error ? (error.stack?.split("\n")[1] ?? "") : "";
  const source = (frame.trim().replace(/^at /, "").split(" (")[0] ?? "")
    .replace(/[^A-Za-z0-9_./:\\ -]/g, "")
    .slice(0, 160);
  console.error(
    `Explore worker stopped (${name}${source ? ` at ${source}` : ""}). Check configuration, RPC connectivity, and local lock files. No credentials are printed.`,
  );
  process.exitCode = 1;
});
