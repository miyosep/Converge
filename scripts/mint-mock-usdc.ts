import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { tokenAmountSchema } from "../src/lib/schemas/primitives.js";

const rpcUrl = process.env.RPC_URL;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
const [recipientInput, amountInput] = process.argv.slice(2);
if (!rpcUrl || !privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error(
    "Set RPC_URL and DEPLOYER_PRIVATE_KEY in the ignored .env file",
  );
}
if (
  !recipientInput ||
  !isAddress(recipientInput) ||
  recipientInput.toLowerCase() === zeroAddress
) {
  throw new Error("Pass a nonzero recipient EVM address");
}
const amountResult = tokenAmountSchema.safeParse(amountInput);
if (!amountResult.success || BigInt(amountResult.data) === 0n) {
  throw new Error("Pass a positive MockUSDC amount in six-decimal base units");
}

const recipient = getAddress(recipientInput);
const amount = BigInt(amountResult.data);
const account = privateKeyToAccount(privateKey as Hex);
const transport = http(rpcUrl, { timeout: 15_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });
const genesisHash =
  "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9";

async function main(): Promise<void> {
  if ((await publicClient.getChainId()) !== sepolia.id)
    throw new Error("RPC is not Ethereum Sepolia");
  if (
    (await publicClient.getBlock({ blockNumber: 0n })).hash.toLowerCase() !==
    genesisHash
  ) {
    throw new Error(
      "RPC has the Sepolia chain ID but a different genesis block",
    );
  }
  const deployment = JSON.parse(
    await readFile(join("contracts", "deployments", "11155111.json"), "utf8"),
  ) as { mockUSDC?: { address?: Address } };
  const tokenAddress = deployment.mockUSDC?.address;
  if (!tokenAddress || !isAddress(tokenAddress))
    throw new Error("Verified MockUSDC deployment is missing");
  const tokenAbi = JSON.parse(
    await readFile(join("src", "lib", "abi", "mockUSDC.json"), "utf8"),
  ) as Abi;
  const minter = await publicClient.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "minter",
  });
  if (String(minter).toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Configured deployer is not the MockUSDC minter");
  }
  const { request } = await publicClient.simulateContract({
    account,
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "mint",
    args: [recipient, amount],
  });
  const transactionHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== "success")
    throw new Error(`Mint transaction reverted: ${transactionHash}`);
  const matchedTransfer = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({
        abi: tokenAbi,
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as {
        from: Address;
        to: Address;
        value: bigint;
      };
      return (
        decoded.eventName === "Transfer" &&
        args.from === zeroAddress &&
        args.to.toLowerCase() === recipient.toLowerCase() &&
        args.value === amount
      );
    } catch {
      return false;
    }
  });
  if (!matchedTransfer)
    throw new Error(
      `Mint receipt lacks the expected Transfer event: ${transactionHash}`,
    );
  process.stdout.write(
    `Minted ${amount} base units to ${recipient}; transaction: ${transactionHash}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${message.replaceAll(rpcUrl, "[RPC_URL]").replaceAll(privateKey, "[PRIVATE_KEY]")}\n`,
  );
  process.exitCode = 1;
});
