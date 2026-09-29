import { Pool, type PoolClient } from "pg";
import type { Hex } from "viem";
import type { SigningPolicy } from "../group-policy.js";
import type { GroupChainState } from "../group-chain.js";
import type { GroupChainEvent, GroupHistory } from "../group-execution.js";
import type { JournalTransaction } from "../../../scripts/lib/transaction-journal.js";

export type ExecutionPolicy = SigningPolicy & { groupId: string };
export type ChainCheckpoint = { blockNumber: string; blockHash: Hex };
export class GroupExecutionRepository {
  constructor(
    readonly pool: Pool,
    readonly fence?: (db: PoolClient) => Promise<void>,
  ) {}
  async policies(): Promise<ExecutionPolicy[]> {
    const result = await this.pool.query(
      `SELECT p.group_id, p.policy, p.policy_hash, p.created_at FROM converge_group_policies p LEFT JOIN converge_group_execution e USING(decision_id) ORDER BY (e.status = 'pending') DESC NULLS LAST, p.created_at`,
    );
    return result.rows.map((row) => ({
      groupId: row.group_id,
      policy: row.policy,
      policyHash: row.policy_hash,
      createdAt: row.created_at.toISOString(),
    }));
  }
  async checkpoint(id: string): Promise<ChainCheckpoint | undefined> {
    const result = await this.pool.query(
      `SELECT block_number, block_hash FROM converge_group_chain_snapshots WHERE decision_id=$1`,
      [id],
    );
    return result.rows[0]
      ? {
          blockNumber: result.rows[0].block_number,
          blockHash: result.rows[0].block_hash,
        }
      : undefined;
  }
  async record(
    id: string,
    state: GroupChainState,
    hash: Hex,
    fromBlock: bigint,
    events: GroupChainEvent[],
  ) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await this.fence?.(db);
      await db.query(
        "DELETE FROM converge_group_chain_events WHERE decision_id=$1 AND block_number >= $2",
        [id, String(fromBlock)],
      );
      for (const event of events)
        await db.query(
          `INSERT INTO converge_group_chain_events(decision_id,transaction_hash,log_index,block_number,event) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(decision_id,transaction_hash,log_index) DO UPDATE SET block_number=EXCLUDED.block_number,event=EXCLUDED.event`,
          [
            id,
            event.hash,
            event.logIndex,
            event.blockNumber,
            JSON.stringify(event),
          ],
        );
      const publicState = {
        status: state.status,
        approvals: state.approvals,
        contributed: state.contributed,
        spent: state.spent,
        refunded: state.refunded,
      };
      await db.query(
        `INSERT INTO converge_group_chain_snapshots(decision_id,block_number,block_hash,state) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(decision_id) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,state=EXCLUDED.state,checked_at=now()`,
        [id, state.blockNumber, hash, JSON.stringify(publicState)],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async load(id: string): Promise<JournalTransaction | undefined> {
    return (
      await this.pool.query(
        "SELECT journal FROM converge_group_execution WHERE decision_id=$1",
        [id],
      )
    ).rows[0]?.journal;
  }
  async save(
    id: string,
    journal: JournalTransaction,
    reserved: bigint,
    cap: bigint,
  ) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('converge:group-execution-budget'))",
      );
      const used = await db.query(
        "SELECT COALESCE(sum(reserved_wei),0)::text AS used FROM converge_group_execution",
      );
      if (BigInt(used.rows[0].used) + reserved > cap)
        throw new Error("GROUP_GAS_BUDGET_EXCEEDED");
      await db.query(
        "INSERT INTO converge_group_execution(decision_id,transaction_hash,journal,reserved_wei,status) VALUES($1,$2,$3::jsonb,$4,'pending')",
        [id, journal.hash, JSON.stringify(journal), String(reserved)],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async pendingOther(id: string) {
    return (
      (
        await this.pool.query(
          "SELECT 1 FROM converge_group_execution WHERE decision_id<>$1 AND status='pending' LIMIT 1",
          [id],
        )
      ).rowCount !== 0
    );
  }
  async status(
    id: string,
    status: "pending" | "confirmed" | "reverted",
    error: string | null = null,
  ) {
    await this.pool.query(
      "UPDATE converge_group_execution SET status=$2,error_code=$3,updated_at=now() WHERE decision_id=$1",
      [id, status, error],
    );
  }
  async history(groupId: string, actor: string): Promise<GroupHistory> {
    const allowed = await this.pool.query(
      `SELECT p.decision_id FROM converge_group_policies p JOIN converge_participants m ON m.group_id=p.group_id WHERE p.group_id=$1 AND m.wallet_address=$2`,
      [groupId, actor.toLowerCase()],
    );
    const id = allowed.rows[0]?.decision_id;
    if (!id) return { snapshot: null, events: [], execution: null };
    const [snap, events, execution] = await Promise.all([
      this.pool.query(
        "SELECT block_number,checked_at,state FROM converge_group_chain_snapshots WHERE decision_id=$1",
        [id],
      ),
      this.pool.query(
        "SELECT event FROM converge_group_chain_events WHERE decision_id=$1 ORDER BY block_number,log_index",
        [id],
      ),
      this.pool.query(
        "SELECT transaction_hash,status,error_code,updated_at FROM converge_group_execution WHERE decision_id=$1",
        [id],
      ),
    ]);
    const s = snap.rows[0],
      e = execution.rows[0];
    return {
      snapshot: s
        ? {
            blockNumber: s.block_number,
            checkedAt: s.checked_at.toISOString(),
            state: s.state,
          }
        : null,
      events: events.rows.map((r) => r.event),
      execution: e
        ? {
            hash: e.transaction_hash,
            status: e.status,
            errorCode: e.error_code,
            updatedAt: e.updated_at.toISOString(),
          }
        : null,
    };
  }
}
