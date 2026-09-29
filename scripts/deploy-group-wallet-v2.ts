import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  http,
  keccak256,
  parseEther,
  TransactionReceiptNotFoundError,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import legacy from "../contracts/deployments/11155111.json";
import {
  atomicJson,
  demoDirectory,
  optionalJson,
  withFileLock,
} from "../src/lib/explore/store.js";
import {
  executeJournaled,
  type JournalTransaction,
} from "./lib/transaction-journal.js";

async function main() {
  if (!process.env.RPC_URL || !process.env.DEPLOYER_PRIVATE_KEY)
    throw new Error("Missing deployment configuration");
  const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  if (account.address.toLowerCase() !== legacy.deployer.toLowerCase())
    throw new Error("Wrong deployer");
  const transport = http(process.env.RPC_URL, {
    timeout: 15000,
    retryCount: 1,
  });
  const client = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  if (
    (await client.getChainId()) !== 11155111 ||
    (await client.getBlock({ blockNumber: 0n })).hash !==
      "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
  )
    throw new Error("Wrong chain");
  const tokenCode = await client.getBytecode({
    address: legacy.mockUSDC.address as Hex,
  });
  if (!tokenCode || keccak256(tokenCode) !== legacy.mockUSDC.deployedCodeHash)
    throw new Error("Wrong token deployment");
  const artifact = JSON.parse(
    await readFile(
      "contracts/out-v2/ConvergeGroupWalletV2.sol/ConvergeGroupWalletV2.json",
      "utf8",
    ),
  ) as { abi: Abi; bytecode: { object: Hex } };
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [legacy.mockUSDC.address],
  });
  const manifestPath = "contracts/deployments/11155111-v2.json";
  const existing = await optionalJson<{
    convergeGroupWallet: {
      address: Hex;
      deployedCodeHash: Hex;
      blockHash: Hex;
      blockNumber: string;
    } | null;
  }>(manifestPath);
  if (existing?.convergeGroupWallet) {
    const record = existing.convergeGroupWallet;
    const code = await client.getBytecode({ address: record.address });
    if (
      !code ||
      keccak256(code) !== record.deployedCodeHash ||
      (await client.getBlock({ blockNumber: BigInt(record.blockNumber) }))
        .hash !== record.blockHash
    )
      throw new Error("Deployment verification failed");
    console.log(`Verified existing v2 deployment: ${record.address}`);
    return;
  }
  const cap = parseEther("0.005");
  const prepare = async () => {
    const latest = await client.getTransactionCount({
      address: account.address,
      blockTag: "latest",
    });
    const pending = await client.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    if (latest !== pending)
      throw new Error("Deployer has pending transactions");
    const request = await wallet.prepareTransactionRequest({
      to: null,
      data,
      value: 0n,
    });
    const maximumFee =
      request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n);
    const balance = await client.getBalance({ address: account.address });
    if (!process.argv.includes("--execute"))
      console.log(
        JSON.stringify({
          deployer: account.address,
          balanceWei: String(balance),
          maximumFeeWei: String(maximumFee),
          gas: String(request.gas),
        }),
      );
    if (maximumFee <= 0n || maximumFee > cap || balance < maximumFee)
      throw new Error("Deployment fee or balance limit");
    return { request, maximumFee };
  };
  if (!process.argv.includes("--execute")) {
    const preview = await prepare();
    console.log(
      JSON.stringify({
        chainId: 11155111,
        contract: "ConvergeGroupWalletV2",
        token: legacy.mockUSDC.address,
        maximumFeeWei: String(preview.maximumFee),
        maximumAllowedFeeWei: String(cap),
        transactionSent: false,
      }),
    );
    return;
  }
  const root = demoDirectory();
  await mkdir(join(root, "private"), { recursive: true });
  await withFileLock(join(root, "worker.lock"), async () => {
    const journalPath = join(
      root,
      "private",
      "group-wallet-v2-deployment.json",
    );
    const intent = {
      chainId: 11155111,
      from: account.address,
      to: null,
      data,
      valueWei: "0",
    };
    const result = await executeJournaled({
      intent,
      load: () => optionalJson<JournalTransaction>(journalPath),
      prepare: async () => wallet.signTransaction((await prepare()).request),
      save: (transaction) => atomicJson(journalPath, transaction),
      findReceipt: async (hash) => {
        try {
          return await client.getTransactionReceipt({ hash });
        } catch (error) {
          if (error instanceof TransactionReceiptNotFoundError)
            return undefined;
          throw error;
        }
      },
      broadcast: (serializedTransaction) =>
        client.sendRawTransaction({ serializedTransaction }),
      waitReceipt: (hash) =>
        client.waitForTransactionReceipt({
          hash,
          confirmations: 2,
          timeout: 120000,
        }),
    });
    const receipt = await client.waitForTransactionReceipt({
      hash: result.transaction.hash,
      confirmations: 2,
      timeout: 120000,
    });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error("Deployment failed");
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash)
      throw new Error("Deployment reorganized");
    const address = receipt.contractAddress;
    const code = await client.getBytecode({ address });
    const version = await client.readContract({
      address,
      abi: artifact.abi,
      functionName: "POLICY_VERSION",
    });
    const token = await client.readContract({
      address,
      abi: artifact.abi,
      functionName: "token",
    });
    if (
      !code ||
      version !== 2n ||
      String(token).toLowerCase() !== legacy.mockUSDC.address.toLowerCase()
    )
      throw new Error("Wrong deployed contract");
    await atomicJson(manifestPath, {
      schemaVersion: 2,
      chainId: 11155111,
      deployer: account.address,
      mockUSDC: legacy.mockUSDC.address,
      convergeGroupWallet: {
        address,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        blockHash: receipt.blockHash,
        deployedCodeHash: keccak256(code),
      },
      verification: {
        minimumConfirmations: 2,
        finalizedAtVerification:
          (await client.getBlock({ blockTag: "finalized" })).number >=
          receipt.blockNumber,
      },
    });
    console.log(
      `Deployed and verified ConvergeGroupWalletV2: ${address} (${receipt.transactionHash})`,
    );
  });
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const safe = [
    "DEMO_BUSY",
    "Deployer has pending transactions",
    "Deployment fee or balance limit",
    "Wrong deployer",
  ];
  console.error(
    safe.includes(message)
      ? message
      : "V2 deployment failed; inspect configuration and saved journal. No credentials printed.",
  );
  process.exitCode = 1;
});
