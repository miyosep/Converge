import {
  createPublicClient,
  http,
  keccak256,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { databasePool } from "../db/pool.js";
import { ExploreWorker } from "../../../scripts/lib/explore-worker.js";
import { GroupExecutionWorker } from "../../../scripts/lib/group-execution-worker.js";
import deployment from "../../../contracts/deployments/11155111.json";
import {
  groupDeploymentV2,
  groupPolicyConfig,
  groupPolicyConfigFor,
} from "../server/group-config.js";
import { explorePersistence, ServerlessGroupRepository } from "./journal.js";
import { JobBusy, withJobLease } from "./lease.js";
import { jobsEnabled } from "./config.js";
import { jobSchema, type Job } from "./client.js";
import type { ExploreRun } from "../explore/types.js";
import type { ExecutionPolicy } from "../db/group-execution.js";

export function exploreNeedsWork(run: ExploreRun) {
  return (
    !!run.command ||
    run.transactions?.some((tx) => !tx.confirmed) ||
    (!!run.policy &&
      !run.automationComplete &&
      !["preferences", "review", "proposal", "approval"].includes(run.phase))
  );
}

export async function runJob(input: Job): Promise<boolean> {
  const job = jobSchema.parse(input);
  if (!jobsEnabled()) return false;
  if (job.kind === "explore" && process.env.EXPLORE_DEMO_ENABLED !== "true")
    return false;
  if (job.kind === "group" && process.env.GROUP_EXECUTION_ENABLED !== "true")
    return false;
  const pool = databasePool();
  try {
    return await withJobLease(pool, "chain-execution", async (lease) => {
      if (job.kind === "explore") {
        if (process.env.EXPLORE_DEMO_ENABLED !== "true") return false;
        const persistence = explorePersistence(pool, lease);
        const worker = new ExploreWorker(persistence);
        await worker.init();
        return persistence.store.withRunLock(job.id, async () => {
          const run = await persistence.store.read(job.id);
          if (!run) return false;
          delete run.error;
          try {
            await worker.tick(run);
          } catch (error) {
            const code = error instanceof Error ? error.message : "";
            if (code === "JOB_LEASE_LOST") throw error;
            run.error = code.startsWith("WAITING_FOR_")
              ? code
              : "RUNNER_ACTION_PENDING_OR_FAILED";
          }
          await persistence.store.save(run);
          return exploreNeedsWork(run);
        });
      }
      if (process.env.GROUP_EXECUTION_ENABLED !== "true") return false;
      const url = process.env.RPC_URL,
        key = process.env.AGENT_EXECUTOR_PRIVATE_KEY;
      if (!url || !key) throw new Error("MISSING_CHAIN_CONFIGURATION");
      const account = privateKeyToAccount(key as Hex);
      if (
        account.address.toLowerCase() !==
        groupPolicyConfig.executor.toLowerCase()
      )
        throw new Error("WRONG_EXECUTOR");
      const result = await pool.query(
        "SELECT group_id,policy,policy_hash,created_at FROM converge_group_policies WHERE group_id=$1",
        [job.id],
      );
      const row = result.rows[0];
      if (!row) return false;
      const saved: ExecutionPolicy = {
        groupId: row.group_id,
        policy: row.policy,
        policyHash: row.policy_hash,
        createdAt: row.created_at.toISOString(),
      };
      const transport = http(url, { timeout: 15000, retryCount: 0 });
      const client = createPublicClient({ chain: sepolia, transport });
      const contract =
        saved.policy.policyVersion === 1
          ? deployment.convergeGroupWallet
          : groupDeploymentV2;
      if (
        !contract ||
        (await client.getChainId()) !== sepolia.id ||
        (await client.getBlock({ blockNumber: 0n })).hash !==
          "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
      )
        throw new Error("WRONG_CHAIN");
      for (const target of [deployment.mockUSDC, contract]) {
        const code = await client.getBytecode({
          address: target.address as Address,
        });
        if (!code || keccak256(code) !== target.deployedCodeHash)
          throw new Error("WRONG_BYTECODE");
      }
      const repo = new ServerlessGroupRepository(pool, lease, account.address);
      const cap = parseEther(process.env.GROUP_EXECUTION_MAX_ETH || "0.01");
      if (cap <= 0n) throw new Error("INVALID_GAS_BUDGET");
      const worker = new GroupExecutionWorker(
        client,
        transport,
        account,
        groupPolicyConfigFor(saved.policy),
        repo,
        BigInt(contract.blockNumber),
        cap,
        () => lease.assert(),
        4000n,
      );
      await worker.tick(saved);
      const progress = (
        await pool.query(
          "SELECT s.state,e.status FROM converge_group_chain_snapshots s LEFT JOIN converge_group_execution e USING(decision_id) WHERE s.decision_id=$1",
          [saved.policy.decisionId],
        )
      ).rows[0];
      return (
        worker.historyPending ||
        progress?.status === "pending" ||
        progress?.state.status === 1
      );
    });
  } catch (error) {
    if (error instanceof JobBusy) return true;
    // Provider messages can contain RPC URLs. Never send them to Inngest logs.
    throw new Error("BACKGROUND_ACTION_PENDING_OR_FAILED");
  }
}
