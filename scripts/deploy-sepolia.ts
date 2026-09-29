import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  encodeDeployData,
  keccak256,
  TransactionReceiptNotFoundError,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { waitUntilFinalized } from "./lib/deployment-finality.js";
import { atomicWrite } from "./lib/atomic-file.js";
import {
  executeJournaled,
  type TransactionIntent,
} from "./lib/transaction-journal.js";

type ContractRecord = {
  transactionHash: Hex;
  signedTransaction?: Hex;
  intent?: TransactionIntent;
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
const lockPath = join(deploymentDir, "11155111.pending.lock");

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
  await atomicWrite(pendingPath, `${JSON.stringify(record, null, 2)}\n`);
}

async function confirmContract(
  record: ContractRecord,
  receipt: TransactionReceipt,
): Promise<ContractRecord> {
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(
      `Deployment transaction ${record.transactionHash} did not create a contract`,
    );
  }
  await waitUntilFinalized({
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    finalizedBlockNumber: async () =>
      (await publicClient.getBlock({ blockTag: "finalized" })).number,
    canonicalBlockHash: async (number) =>
      (await publicClient.getBlock({ blockNumber: number })).hash,
  });
  const code = await publicClient.getBytecode({
    address: receipt.contractAddress,
    blockNumber: receipt.blockNumber,
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

async function deployOrRecover(
  record: DeploymentRecord,
  key: "mockUSDC" | "convergeGroupWallet",
  artifact: Artifact,
  args: readonly unknown[],
): Promise<ContractRecord> {
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args,
  });
  const intent: TransactionIntent = {
    chainId: sepolia.id,
    from: account.address,
    to: null,
    data,
    valueWei: "0",
  };
  let pending = record[key];
  let receipt: TransactionReceipt;
  if (pending && !pending.signedTransaction) {
    // Older pending records contain only a hash. Wait for that exact transaction;
    // never prepare a replacement without its signed journal.
    receipt = await publicClient.waitForTransactionReceipt({
      hash: pending.transactionHash,
      confirmations: 1,
      timeout: 120_000,
    });
  } else {
    const result = await executeJournaled<TransactionReceipt>({
      intent,
      load: async () =>
        pending
          ? {
              intent: pending.intent ?? intent,
              hash: pending.transactionHash,
              ...(pending.signedTransaction
                ? { serialized: pending.signedTransaction }
                : {}),
            }
          : undefined,
      prepare: async () => {
        const request = await walletClient.prepareTransactionRequest({
          to: null,
          data,
          value: 0n,
        });
        return walletClient.signTransaction(request);
      },
      save: async (transaction) => {
        const next: ContractRecord = {
          transactionHash: transaction.hash,
          intent: transaction.intent,
          ...(transaction.serialized
            ? { signedTransaction: transaction.serialized }
            : {}),
        };
        pending = next;
        record[key] = next;
        await savePending(record);
      },
      findReceipt: async (hash) => {
        try {
          return await publicClient.getTransactionReceipt({ hash });
        } catch (error) {
          if (error instanceof TransactionReceiptNotFoundError)
            return undefined;
          throw error;
        }
      },
      broadcast: (serialized) =>
        publicClient.sendRawTransaction({ serializedTransaction: serialized }),
      waitReceipt: (hash) =>
        publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
          timeout: 120_000,
        }),
    });
    receipt = result.receipt;
    pending = record[key];
  }
  if (!pending) throw new Error("Missing deployment transaction journal");
  const confirmed = await confirmContract(pending, receipt);
  record[key] = confirmed;
  await savePending(record);
  return confirmed;
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

  record.mockUSDC = await deployOrRecover(
    record,
    "mockUSDC",
    tokenArtifact,
    [],
  );
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

  if ((await publicClient.getChainId()) !== sepolia.id)
    throw new Error("RPC chain changed during deployment");
  record.convergeGroupWallet = await deployOrRecover(
    record,
    "convergeGroupWallet",
    walletArtifact,
    [tokenAddress],
  );
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
  await atomicWrite(finalPath, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(
    `Verified Ethereum Sepolia deployment:\nMockUSDC: ${tokenAddress}\nGroup wallet: ${walletAddress}\nRecord: ${finalPath}\n`,
  );
}

async function lockedMain() {
  await mkdir(deploymentDir, { recursive: true });
  const lock = await open(lockPath, "wx").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST")
        throw new Error(
          `Deployment lock exists at ${lockPath}; inspect the journal before removing it`,
        );
      throw error;
    },
  );
  try {
    await main();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

lockedMain().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${message.replaceAll(rpcUrl, "[RPC_URL]").replaceAll(privateKey, "[PRIVATE_KEY]")}\n`,
  );
  process.exitCode = 1;
});
