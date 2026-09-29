import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  TransactionReceiptNotFoundError,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addressSchema } from "../src/lib/schemas/primitives.js";
import {
  assertMatchingIntent,
  executeJournaled,
  type JournalTransaction,
} from "./lib/transaction-journal.js";

async function main(): Promise<void> {
  const [batchId, amount, selection, ...extra] = process.argv.slice(2);
  if (
    !batchId ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/.test(batchId) ||
    !amount ||
    !/^0\.[0-9]{1,6}$/.test(amount) ||
    !["all", "alice"].includes(selection ?? "") ||
    extra.length
  )
    throw new Error(
      "Usage: demo:gas-topup <batch-id> <ETH-amount> <all|alice>",
    );
  const value = parseEther(amount);
  if (value <= 0n) throw new Error("Amount must be positive");
  const rpc = process.env.RPC_URL;
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rpc || !key) throw new Error("Missing deployer configuration");
  const account = privateKeyToAccount(key as Hex);
  const deployment = JSON.parse(
    await readFile("contracts/deployments/11155111.json", "utf8"),
  );
  if (deployment.deployer.toLowerCase() !== account.address.toLowerCase())
    throw new Error("Wrong deployer");
  const manifest = JSON.parse(
    await readFile(
      "contracts/deployments/demo-participants.11155111.json",
      "utf8",
    ),
  );
  if (manifest.chainId !== sepolia.id || manifest.participants.length !== 6)
    throw new Error("Wrong participant manifest");
  const addresses = manifest.participants.map((p: { address: string }) =>
    addressSchema.parse(p.address),
  ) as ReturnType<typeof addressSchema.parse>[];
  if (new Set(addresses).size !== 6) throw new Error("Duplicate participants");
  const recipients = selection === "alice" ? addresses.slice(0, 1) : addresses;
  const transport = http(rpc, { timeout: 15_000, retryCount: 2 });
  const client = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  if (
    (await client.getChainId()) !== sepolia.id ||
    (await client.getBlock({ blockNumber: 0n })).hash !==
      "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
  )
    throw new Error("Wrong RPC network");
  const path = `docs/evidence/gas-topup-${batchId}.json`;
  const privateDir = `docs/evidence/private/gas-topup-${batchId}`;
  await mkdir(privateDir, { recursive: true });
  const lockPath = `${privateDir}/run.lock`;
  const lock = await open(lockPath, "wx");
  const atomicWrite = async (file: string, data: unknown) => {
    await writeFile(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(`${file}.tmp`, file);
  };
  const readOptional = async <T>(file: string): Promise<T | undefined> => {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };
  try {
    const header = {
      schemaVersion: 1,
      chainId: sepolia.id,
      from: account.address,
      amountWei: value.toString(),
      selection,
      recipients,
    };
    type Entry = Omit<JournalTransaction, "serialized"> & {
      blockNumber?: string;
      blockHash?: Hex;
      status?: string;
    };
    const previous = await readOptional<{
      header: typeof header;
      transactions: Record<string, Entry>;
    }>(path);
    if (previous && JSON.stringify(previous.header) !== JSON.stringify(header))
      throw new Error("Existing top-up record differs");
    const record = previous ?? { header, transactions: {} };
    for (const [index, to] of recipients.entries()) {
      const name = String(index + 1);
      const localPath = `${privateDir}/${name}.json`;
      const intent = {
        chainId: sepolia.id,
        from: account.address,
        to,
        data: "0x" as Hex,
        valueWei: value.toString(),
      };
      const { transaction, receipt } = await executeJournaled({
        intent,
        load: async () => {
          const local = await readOptional<JournalTransaction>(localPath);
          const published = record.transactions[name];
          if (local && published && local.hash !== published.hash)
            throw new Error("Journal mismatch");
          return local ?? published;
        },
        prepare: async () =>
          wallet.signTransaction(
            await wallet.prepareTransactionRequest({ account, to, value }),
          ),
        save: async (transaction) => {
          await atomicWrite(localPath, transaction);
          record.transactions[name] = { intent, hash: transaction.hash };
          await atomicWrite(path, record);
        },
        findReceipt: async (hash) => {
          try {
            return await client.getTransactionReceipt({ hash });
          } catch (error) {
            if (error instanceof TransactionReceiptNotFoundError)
              return undefined;
            throw error;
          }
        },
        broadcast: (serialized) =>
          client.sendRawTransaction({ serializedTransaction: serialized }),
        waitReceipt: (hash) =>
          client.waitForTransactionReceipt({ hash, timeout: 180_000 }),
      });
      if (receipt.status !== "success")
        throw new Error("Top-up transaction failed");
      const tx = await client.getTransaction({ hash: transaction.hash });
      if (!tx.to) throw new Error("Invalid recipient");
      assertMatchingIntent(
        {
          chainId: tx.chainId ?? sepolia.id,
          from: tx.from,
          to: tx.to,
          data: tx.input,
          valueWei: tx.value.toString(),
        },
        intent,
      );
      record.transactions[name] = {
        intent,
        hash: transaction.hash,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        status: receipt.status,
      };
      await atomicWrite(path, record);
      process.stdout.write(`Gas top-up ${name}: ${transaction.hash}\n`);
    }
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch(() => {
  process.stderr.write(
    "Gas top-up stopped. Keep its journals and resume with the same batch ID, amount, and recipients.\n",
  );
  process.exitCode = 1;
});
