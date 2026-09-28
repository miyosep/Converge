import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hex,
  type TransactionSerialized,
} from "viem";

export type TransactionIntent = {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  valueWei: string;
};
export type JournalTransaction = {
  intent: TransactionIntent;
  hash: Hex;
  serialized?: Hex;
};

export function assertMatchingIntent(
  actual: TransactionIntent,
  expected: TransactionIntent,
): void {
  if (
    actual.chainId !== expected.chainId ||
    actual.from.toLowerCase() !== expected.from.toLowerCase() ||
    actual.to.toLowerCase() !== expected.to.toLowerCase() ||
    actual.data.toLowerCase() !== expected.data.toLowerCase() ||
    actual.valueWei !== expected.valueWei
  ) {
    throw new Error("Saved transaction does not match the requested action");
  }
}

// A signed transaction is persisted before broadcast, so retries keep the same nonce and hash.
export async function executeJournaled<T>(options: {
  intent: TransactionIntent;
  load: () => Promise<JournalTransaction | undefined>;
  prepare: () => Promise<Hex>;
  save: (transaction: JournalTransaction) => Promise<void>;
  findReceipt: (hash: Hex) => Promise<T | undefined>;
  broadcast: (serialized: Hex) => Promise<Hex>;
  waitReceipt: (hash: Hex) => Promise<T>;
}): Promise<{ transaction: JournalTransaction; receipt: T }> {
  let transaction = await options.load();
  if (!transaction) {
    const serialized = await options.prepare();
    transaction = {
      intent: options.intent,
      hash: keccak256(serialized),
      serialized,
    };
    await options.save(transaction);
  }
  assertMatchingIntent(transaction.intent, options.intent);
  const existing = await options.findReceipt(transaction.hash);
  if (existing !== undefined) return { transaction, receipt: existing };
  const serialized = transaction.serialized;
  if (!serialized)
    throw new Error(
      "Pending transaction requires its local signed journal; do not create a replacement run",
    );
  if (keccak256(serialized) !== transaction.hash)
    throw new Error("Signed transaction hash mismatch");
  const parsed = parseTransaction(serialized);
  if (!parsed.to || parsed.chainId === undefined)
    throw new Error("Invalid signed transaction domain");
  assertMatchingIntent(
    {
      chainId: parsed.chainId,
      from: await recoverTransactionAddress({
        serializedTransaction: serialized as TransactionSerialized,
      }),
      to: parsed.to,
      data: parsed.data ?? "0x",
      valueWei: (parsed.value ?? 0n).toString(),
    },
    options.intent,
  );
  try {
    const hash = await options.broadcast(serialized);
    if (hash !== transaction.hash)
      throw new Error("RPC returned a different transaction hash");
  } catch (error) {
    const mined = await options.findReceipt(transaction.hash);
    if (mined !== undefined) return { transaction, receipt: mined };
    throw error;
  }
  return { transaction, receipt: await options.waitReceipt(transaction.hash) };
}
