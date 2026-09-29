import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerialized,
} from "viem";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import {
  ExploreStore,
  withFileLock,
  walletId,
} from "../src/lib/explore/store.js";
import { withJobLease, guardedTransaction } from "../src/lib/jobs/lease.js";
import { assertMatchingIntent } from "./lib/transaction-journal.js";
import type { ExploreEntry } from "./lib/explore-worker.js";

async function main() {
  const store = new ExploreStore();
  await store.init();
  // Freeze admission, the ledger and every existing run for a consistent copy.
  async function lockRuns<T>(
    ids: string[],
    work: () => Promise<T>,
  ): Promise<T> {
    const [id, ...rest] = ids;
    return id ? store.withRunLock(id, () => lockRuns(rest, work)) : work();
  }
  await withFileLock(join(store.root, "worker.lock"), () =>
    withFileLock(join(store.root, "admission.lock"), async () => {
      const ids = await store.ids();
      await lockRuns(ids, async () => {
        const runs = await Promise.all(ids.map((id) => store.read(id)));
        let ledger: Record<string, ExploreEntry> = {};
        try {
          ledger = JSON.parse(
            await readFile(
              join(store.root, "private", "transactions.json"),
              "utf8",
            ),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        for (const run of runs)
          if (!run || walletId(run.judge) !== run.id)
            throw new Error("INVALID_RUN_ID");
        for (const [key, entry] of Object.entries(ledger)) {
          if (!ids.includes(key.slice(0, 64)))
            throw new Error("JOURNAL_WITHOUT_RUN");
          if (!entry.serialized && !entry.confirmed)
            throw new Error("PENDING_JOURNAL_MISSING_SIGNATURE");
          if (entry.serialized) {
            if (keccak256(entry.serialized) !== entry.hash)
              throw new Error("JOURNAL_HASH_MISMATCH");
            const parsed = parseTransaction(entry.serialized);
            assertMatchingIntent(
              {
                chainId: parsed.chainId!,
                from: await recoverTransactionAddress({
                  serializedTransaction:
                    entry.serialized as TransactionSerialized,
                }),
                to: parsed.to ?? null,
                data: parsed.data ?? "0x",
                valueWei: String(parsed.value ?? 0n),
              },
              entry.intent,
            );
          }
        }
        console.log(
          `Validated ${runs.length} saved runs and ${Object.keys(ledger).length} journal entries. No transactions submitted.`,
        );
        if (!process.argv.includes("--execute")) {
          console.log(
            "Read-only check. Use --execute <expected-branch> to import into an empty Explore database.",
          );
          return;
        }
        const expected = process.argv[process.argv.indexOf("--execute") + 1];
        if (
          !expected ||
          expected !== process.env.NEON_BRANCH ||
          !process.env.DATABASE_URL
        )
          throw new Error("EXPECTED_DATABASE_BRANCH_REQUIRED");
        const pool = new Pool({
          connectionString: verifiedPostgresUrl(process.env.DATABASE_URL),
          max: 3,
        });
        try {
          await withJobLease(pool, "chain-execution", (chain) =>
            withJobLease(pool, "explore:admission", (admission) =>
              guardedTransaction(pool, [chain, admission], async (db) => {
                if (
                  (
                    await db.query(
                      "SELECT 1 FROM converge_explore_runs LIMIT 1",
                    )
                  ).rowCount ||
                  (
                    await db.query(
                      "SELECT 1 FROM converge_job_transactions WHERE scope='explore' LIMIT 1",
                    )
                  ).rowCount
                )
                  throw new Error("IMPORT_REQUIRES_EMPTY_EXPLORE_STATE");
                for (const run of runs)
                  await db.query(
                    "INSERT INTO converge_explore_runs(id,data) VALUES($1,$2::jsonb)",
                    [run!.id, JSON.stringify(run)],
                  );
                for (const [key, entry] of Object.entries(ledger))
                  await db.query(
                    "INSERT INTO converge_job_transactions(id,scope,signer,journal,reserved_wei,confirmed,failed) VALUES($1,'explore',$2,$3::jsonb,$4,$5,$6)",
                    [
                      `explore:${key}`,
                      entry.intent.from.toLowerCase(),
                      JSON.stringify(entry),
                      entry.reservedWei,
                      entry.confirmed,
                      entry.failed ?? false,
                    ],
                  );
                const privateDir = join(store.root, "private");
                for (const name of await readdir(privateDir).catch(() => []))
                  if (/^[a-f0-9]{64}-kiln-\d+-\d+\.json$/.test(name)) {
                    await db.query(
                      "INSERT INTO converge_explore_attempts(id,attempt) VALUES($1,$2::jsonb)",
                      [
                        `import:${name}`,
                        await readFile(join(privateDir, name), "utf8"),
                      ],
                    );
                  }
              }),
            ),
          );
          console.log(
            "Explore state imported atomically; local originals preserved. Keep the local signer stopped before enabling hosted jobs.",
          );
        } finally {
          await pool.end();
        }
      });
    }),
  );
}
main().catch(() => {
  console.error(
    "Explore import failed. Check locks, target branch and journal integrity. No credentials printed.",
  );
  process.exitCode = 1;
});
