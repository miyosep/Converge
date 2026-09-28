import { readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { demoRolesSchema } from "../src/lib/demo-roles.js";

async function main(): Promise<void> {
  const rpc = process.env.RPC_URL;
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  const executorKey = process.env.AGENT_EXECUTOR_PRIVATE_KEY;
  if (!rpc || !key || !executorKey)
    throw new Error("Missing local configuration");
  const deployer = privateKeyToAccount(key as Hex);
  const roles = demoRolesSchema.parse(
    JSON.parse(
      await readFile("contracts/deployments/demo-roles.11155111.json", "utf8"),
    ),
  );
  if (privateKeyToAccount(executorKey as Hex).address !== roles.executor)
    throw new Error("Executor key mismatch");
  const deployment = JSON.parse(
    await readFile("contracts/deployments/11155111.json", "utf8"),
  );
  if (deployment.deployer.toLowerCase() !== deployer.address.toLowerCase())
    throw new Error("Deployer mismatch");
  const transport = http(rpc, { timeout: 15_000, retryCount: 2 });
  const client = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({
    account: deployer,
    chain: sepolia,
    transport,
  });
  if ((await client.getChainId()) !== sepolia.id)
    throw new Error("Wrong chain");
  if (
    (await client.getBlock({ blockNumber: 0n })).hash !==
    "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
  )
    throw new Error("Wrong genesis");
  const value = parseEther("0.001");
  const path = "contracts/deployments/demo-executor-funding.11155111.json";
  const header = {
    schemaVersion: 1,
    chainId: sepolia.id,
    from: deployer.address,
    to: roles.executor,
    valueWei: value.toString(),
  };
  let transactionHash: Hex | undefined;
  try {
    const saved = JSON.parse(await readFile(path, "utf8"));
    for (const [field, expected] of Object.entries(header))
      if (saved[field] !== expected) throw new Error("Funding record mismatch");
    if (!/^0x[0-9a-fA-F]{64}$/.test(saved.transactionHash))
      throw new Error("Invalid saved transaction");
    transactionHash = saved.transactionHash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!transactionHash) {
    transactionHash = await wallet.sendTransaction({
      to: roles.executor,
      value,
    });
    await writeFile(
      path,
      `${JSON.stringify({ ...header, transactionHash }, null, 2)}\n`,
      { flag: "wx" },
    );
  }
  const receipt = await client.waitForTransactionReceipt({
    hash: transactionHash,
    timeout: 120_000,
  });
  if (receipt.status !== "success")
    throw new Error("Funding transaction failed");
  const tx = await client.getTransaction({ hash: transactionHash });
  if (
    tx.from.toLowerCase() !== deployer.address.toLowerCase() ||
    tx.to?.toLowerCase() !== roles.executor.toLowerCase() ||
    tx.value !== value ||
    tx.input !== "0x"
  )
    throw new Error("Unexpected funding transaction");
  await writeFile(
    path,
    `${JSON.stringify({ ...header, transactionHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, status: receipt.status }, null, 2)}\n`,
  );
  process.stdout.write(
    `Executor gas funding confirmed: ${transactionHash}\nBalance: ${await client.getBalance({ address: roles.executor })} wei\n`,
  );
}

main().catch(() => {
  process.stderr.write(
    "Executor funding stopped. Inspect the public funding record and local configuration before resuming.\n",
  );
  process.exitCode = 1;
});
