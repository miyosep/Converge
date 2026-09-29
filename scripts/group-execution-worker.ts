import { mkdir } from "node:fs/promises";
import { assertLocalWorker } from "../src/lib/jobs/config.js";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
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
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { GroupExecutionRepository } from "../src/lib/db/group-execution.js";
import {
  groupPolicyConfig,
  groupPolicyConfigFor,
  groupDeploymentV2,
  currentGroupPolicyConfig,
} from "../src/lib/server/group-config.js";
import { demoDirectory, withFileLock } from "../src/lib/explore/store.js";
import deployment from "../contracts/deployments/11155111.json";
import { GroupExecutionWorker } from "./lib/group-execution-worker.js";

async function main() {
  assertLocalWorker();
  if (
    !process.env.DATABASE_URL_UNPOOLED ||
    !process.env.RPC_URL ||
    !process.env.AGENT_EXECUTOR_PRIVATE_KEY
  )
    throw new Error("Missing worker configuration");
  const url = new URL(process.env.DATABASE_URL_UNPOOLED);
  if (url.hostname.includes("-pooler"))
    throw new Error(
      "Worker advisory locks require a direct database connection",
    );
  const pool = new Pool({
    connectionString: verifiedPostgresUrl(url.toString()),
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  try {
    const account = privateKeyToAccount(
      process.env.AGENT_EXECUTOR_PRIVATE_KEY as Hex,
    );
    if (
      account.address.toLowerCase() !== groupPolicyConfig.executor.toLowerCase()
    )
      throw new Error("Executor mismatch");
    const transport = http(process.env.RPC_URL, {
      timeout: 15000,
      retryCount: 0,
    });
    const client = createPublicClient({ chain: sepolia, transport });
    if (
      (await client.getChainId()) !== 11155111 ||
      (await client.getBlock({ blockNumber: 0n })).hash !==
        "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
    )
      throw new Error("Wrong chain");
    for (const contract of [
      deployment.mockUSDC,
      deployment.convergeGroupWallet,
      ...(groupDeploymentV2 ? [groupDeploymentV2] : []),
    ]) {
      const code = await client.getBytecode({
        address: contract.address as Address,
      });
      if (!code || keccak256(code) !== contract.deployedCodeHash)
        throw new Error("Wrong deployed bytecode");
    }
    const repo = new GroupExecutionRepository(pool);
    await repo.policies();
    await pool.query("SELECT 1 FROM converge_group_execution LIMIT 1");
    if (process.argv.includes("--check")) {
      console.log(
        "Group executor preflight passed. No transactions submitted.",
      );
      return;
    }
    if (process.env.GROUP_EXECUTION_ENABLED !== "true")
      throw new Error(
        "Set GROUP_EXECUTION_ENABLED=true to enable the group worker",
      );
    const cap = parseEther(process.env.GROUP_EXECUTION_MAX_ETH || "0.01");
    if (cap <= 0n) throw new Error("Invalid gas budget");
    await mkdir(demoDirectory(), { recursive: true });
    // The Explore worker uses this same exclusive lock and executor key.
    await withFileLock(join(demoDirectory(), "worker.lock"), async () => {
      const lock = await pool.connect();
      try {
        const result = await lock.query(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
          [`converge:executor:${account.address.toLowerCase()}`],
        );
        if (!result.rows[0].locked) throw new Error("Executor already running");
        let stopping = false;
        lock.on("error", () => {
          stopping = true;
        });
        process.on("SIGINT", () => {
          stopping = true;
        });
        process.on("SIGTERM", () => {
          stopping = true;
        });
        const legacyWorker = new GroupExecutionWorker(
          client,
          transport,
          account,
          groupPolicyConfig,
          repo,
          BigInt(deployment.convergeGroupWallet.blockNumber),
          cap,
        );
        const currentWorker = groupDeploymentV2
          ? new GroupExecutionWorker(
              client,
              transport,
              account,
              currentGroupPolicyConfig(),
              repo,
              BigInt(groupDeploymentV2.blockNumber),
              cap,
            )
          : null;
        console.log(
          "Group executor ready. Watching saved ordinary-group policies.",
        );
        do {
          for (const policy of await repo.policies()) {
            if (stopping) break;
            // Probe the dedicated lock connection before every execution cycle.
            await lock.query("SELECT 1");
            try {
              groupPolicyConfigFor(policy.policy);
              const worker =
                policy.policy.policyVersion === 1
                  ? legacyWorker
                  : currentWorker;
              if (!worker) throw new Error("PAYMENT_NOT_CONFIGURED");
              await worker.tick(policy);
            } catch {
              console.error(
                `Group ${policy.groupId}: verification or execution pending. Provider details withheld.`,
              );
            }
          }
          if (!stopping && !process.argv.includes("--once")) await sleep(5000);
        } while (!stopping && !process.argv.includes("--once"));
      } finally {
        await lock.query("SELECT pg_advisory_unlock_all()").catch(() => {});
        lock.release();
      }
    });
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Group executor stopped. Check configuration, database migration and worker locks. No credentials printed.",
  );
  process.exitCode = 1;
});
