import type { Pool, PoolClient } from "pg";
import { parseEther } from "viem";
import {
  assertMatchingIntent,
  type JournalTransaction,
} from "../../../scripts/lib/transaction-journal.js";
import type {
  ExploreEntry,
  ExplorePersistence,
} from "../../../scripts/lib/explore-worker.js";
import { GroupExecutionRepository } from "../db/group-execution.js";
import { DatabaseExploreStore } from "../explore/database-store.js";
import { JobLease, guardedTransaction } from "./lease.js";

async function putJournal(
  db: PoolClient,
  id: string,
  scope: "explore" | "group",
  entry: ExploreEntry,
  cap: bigint,
) {
  const existing = (
    await db.query(
      "SELECT journal FROM converge_job_transactions WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (existing) {
    assertMatchingIntent(existing.journal.intent, entry.intent);
    if (existing.journal.hash !== entry.hash)
      throw new Error("IMMUTABLE_TRANSACTION");
    await db.query(
      "UPDATE converge_job_transactions SET confirmed=$2,failed=$3,updated_at=now() WHERE id=$1",
      [id, entry.confirmed, entry.failed ?? false],
    );
    return;
  }
  const used = (
    await db.query(
      "SELECT COALESCE(sum(reserved_wei),0)::text AS used FROM converge_job_transactions WHERE scope=$1",
      [scope],
    )
  ).rows[0].used;
  if (BigInt(used) + BigInt(entry.reservedWei) > cap)
    throw new Error("GAS_BUDGET_EXCEEDED");
  await db.query(
    `INSERT INTO converge_job_transactions(id,scope,signer,journal,reserved_wei,confirmed,failed) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [
      id,
      scope,
      entry.intent.from.toLowerCase(),
      JSON.stringify(entry),
      entry.reservedWei,
      entry.confirmed,
      entry.failed ?? false,
    ],
  );
}

export async function pendingSigner(
  pool: Pool,
  signer: string,
  except: string,
) {
  return !!(
    await pool.query(
      "SELECT 1 FROM converge_job_transactions WHERE signer=$1 AND id<>$2 AND NOT confirmed LIMIT 1",
      [signer.toLowerCase(), except],
    )
  ).rowCount;
}

export function explorePersistence(
  pool: Pool,
  lease: JobLease,
): ExplorePersistence {
  return {
    store: new DatabaseExploreStore(pool, lease),
    guard: () => lease.assert(),
    pendingOther: (signer, key) =>
      pendingSigner(pool, signer, `explore:${key}`),
    load: async () => {
      const result = await pool.query(
        "SELECT id,journal,reserved_wei,confirmed,failed FROM converge_job_transactions WHERE scope='explore'",
      );
      return Object.fromEntries(
        result.rows.map((r) => [
          r.id.slice("explore:".length),
          {
            ...r.journal,
            reservedWei: r.reserved_wei,
            confirmed: r.confirmed,
            failed: r.failed,
          },
        ]),
      );
    },
    save: async (key, entry) =>
      guardedTransaction(pool, [lease], (db) =>
        putJournal(
          db,
          `explore:${key}`,
          "explore",
          entry,
          parseEther(process.env.EXPLORE_DEMO_MAX_ETH || "0.06"),
        ),
      ),
    attempt: async (id, data) =>
      guardedTransaction(pool, [lease], async (db) => {
        await db.query(
          "INSERT INTO converge_explore_attempts(id,attempt) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING",
          [id, JSON.stringify(data)],
        );
      }),
  };
}

export class ServerlessGroupRepository extends GroupExecutionRepository {
  constructor(
    pool: Pool,
    readonly lease: JobLease,
    readonly signer: string,
  ) {
    super(pool, (db) => lease.assert(db, true));
  }
  override async save(
    id: string,
    journal: JournalTransaction,
    reserved: bigint,
    cap: bigint,
  ) {
    await guardedTransaction(this.pool, [this.lease], async (db) => {
      await putJournal(
        db,
        `group:${id}`,
        "group",
        { ...journal, reservedWei: String(reserved), confirmed: false },
        cap,
      );
      await db.query(
        "INSERT INTO converge_group_execution(decision_id,transaction_hash,journal,reserved_wei,status) VALUES($1,$2,$3::jsonb,$4,'pending')",
        [id, journal.hash, JSON.stringify(journal), String(reserved)],
      );
    });
  }
  override async pendingOther(id: string) {
    return pendingSigner(this.pool, this.signer, `group:${id}`);
  }
  override async status(
    id: string,
    status: "pending" | "confirmed" | "reverted",
    error: string | null = null,
  ) {
    await guardedTransaction(this.pool, [this.lease], async (db) => {
      await db.query(
        "UPDATE converge_group_execution SET status=$2,error_code=$3,updated_at=now() WHERE decision_id=$1",
        [id, status, error],
      );
      await db.query(
        "UPDATE converge_job_transactions SET confirmed=$2,failed=$3,updated_at=now() WHERE id=$1",
        [`group:${id}`, status !== "pending", status === "reverted"],
      );
    });
  }
}
