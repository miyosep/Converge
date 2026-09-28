import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

type ContractRecord = {
  transactionHash: Hex;
  address?: Address;
  blockNumber?: string;
  blockHash?: Hex;
  deployedCodeHash?: Hex;
};

type DeploymentRecord = {
  schemaVersion: 1;
  chainId: 11155111;
  network: "ethereum-sepolia";
  deployer: Address;
  mockUSDC?: ContractRecord;
  convergeGroupWallet?: ContractRecord;
};

type Artifact = { abi: Abi; bytecode: { object: Hex } };

const rpcUrl = process.env.RPC_URL;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl || !privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error(
    "Set RPC_URL and DEPLOYER_PRIVATE_KEY in the ignored .env file",
  );
}

const account = privateKeyToAccount(privateKey as Hex);
const transport = http(rpcUrl, { timeout: 15_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });
const sepoliaGenesisHash =
  "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9";
const deploymentDir = join("contracts", "deployments");
const pendingPath = join(deploymentDir, "11155111.pending.json");
const finalPath = join(deploymentDir, "11155111.json");

async function artifactFor(name: string): Promise<Artifact> {
  const artifact = JSON.parse(
    await readFile(
      join("contracts", "out", `${name}.sol`, `${name}.json`),
      "utf8",
    ),
  ) as Artifact;
  if (
    !Array.isArray(artifact.abi) ||
    !/^0x[0-9a-fA-F]+$/.test(artifact.bytecode?.object ?? "")
  ) {
    throw new Error(
      `${name} artifact is missing; run pnpm contracts:build first`,
    );
  }
  return artifact;
}

async function readRecord(path: string): Promise<DeploymentRecord | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as DeploymentRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function savePending(record: DeploymentRecord): Promise<void> {
  await mkdir(deploymentDir, { recursive: true });
  await writeFile(pendingPath, `${JSON.stringify(record, null, 2)}\n`);
}

async function confirmContract(
  record: ContractRecord,
): Promise<ContractRecord> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: record.transactionHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(
      `Deployment transaction ${record.transactionHash} did not create a contract`,
    );
  }
  const code = await publicClient.getBytecode({
    address: receipt.contractAddress,
  });
  if (!code || code === "0x")
    throw new Error("Deployment receipt has no contract bytecode");
  return {
    transactionHash: record.transactionHash,
    address: receipt.contractAddress,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    deployedCodeHash: keccak256(code),
  };
}

async function main(): Promise<void> {
  if ((await publicClient.getChainId()) !== sepolia.id) {
    throw new Error("RPC_URL is not connected to Ethereum Sepolia (11155111)");
  }
  const genesis = await publicClient.getBlock({ blockNumber: 0n });
  if (genesis.hash.toLowerCase() !== sepoliaGenesisHash) {
    throw new Error(
      "RPC_URL has the Sepolia chain ID but a different genesis block",
    );
  }
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    throw new Error(
      `Fund deployment wallet ${account.address} with Sepolia ETH before deploying`,
    );
  }

  const tokenArtifact = await artifactFor("MockUSDC");
  const walletArtifact = await artifactFor("ConvergeGroupWallet");
  const existing = await readRecord(finalPath);
  if (existing) {
    throw new Error(
      `Deployment record already exists at ${finalPath}; verify it before another deployment`,
    );
  }
  const record: DeploymentRecord = (await readRecord(pendingPath)) ?? {
    schemaVersion: 1,
    chainId: 11155111,
    network: "ethereum-sepolia",
    deployer: account.address,
  };
  if (
    record.chainId !== sepolia.id ||
    record.deployer.toLowerCase() !== account.address.toLowerCase()
  ) {
    throw new Error("Pending deployment belongs to another chain or deployer");
  }

  if (!record.mockUSDC) {
    const transactionHash = await walletClient.deployContract({
      abi: tokenArtifact.abi,
      bytecode: tokenArtifact.bytecode.object,
      args: [],
    });
    record.mockUSDC = { transactionHash };
    await savePending(record);
  }
  record.mockUSDC = await confirmContract(record.mockUSDC);
  await savePending(record);
  const tokenAddress = record.mockUSDC.address;
  if (!tokenAddress || !isAddress(tokenAddress))
    throw new Error("MockUSDC address is invalid");
  const minter = await publicClient.readContract({
    address: tokenAddress,
    abi: tokenArtifact.abi,
    functionName: "minter",
  });
  if (String(minter).toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("MockUSDC minter does not match the deployer");
  }

  if (!record.convergeGroupWallet) {
    if ((await publicClient.getChainId()) !== sepolia.id)
      throw new Error("RPC chain changed during deployment");
    const transactionHash = await walletClient.deployContract({
      abi: walletArtifact.abi,
      bytecode: walletArtifact.bytecode.object,
      args: [tokenAddress],
    });
    record.convergeGroupWallet = { transactionHash };
    await savePending(record);
  }
  record.convergeGroupWallet = await confirmContract(
    record.convergeGroupWallet,
  );
  await savePending(record);
  const walletAddress = record.convergeGroupWallet.address;
  if (!walletAddress || !isAddress(walletAddress))
    throw new Error("Group wallet address is invalid");
  const configuredToken = await publicClient.readContract({
    address: walletAddress,
    abi: walletArtifact.abi,
    functionName: "token",
  });
  if (String(configuredToken).toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error("Group wallet points to an unexpected token");
  }
  await writeFile(finalPath, `${JSON.stringify(record, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(
    `Verified Ethereum Sepolia deployment:\nMockUSDC: ${tokenAddress}\nGroup wallet: ${walletAddress}\nRecord: ${finalPath}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${message.replaceAll(rpcUrl, "[RPC_URL]").replaceAll(privateKey, "[PRIVATE_KEY]")}\n`,
  );
  process.exitCode = 1;
});
