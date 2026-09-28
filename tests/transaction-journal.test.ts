import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, type Hex } from "viem";
import {
  executeJournaled,
  type JournalTransaction,
  type TransactionIntent,
} from "../scripts/lib/transaction-journal.js";

async function fixture() {
  const signer = privateKeyToAccount(generatePrivateKey());
  const intent: TransactionIntent = {
    chainId: 11155111,
    from: signer.address,
    to: "0x0000000000000000000000000000000000000001",
    data: "0x1234",
    valueWei: "0",
  };
  const serialized = await signer.signTransaction({
    chainId: 11155111,
    to: intent.to,
    data: intent.data,
    value: 0n,
    nonce: 0,
    gas: 50_000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    type: "eip1559",
  });
  return { intent, serialized, hash: keccak256(serialized) };
}

test("restart after an uncertain broadcast reuses the signed transaction without preparing another", async () => {
  const f = await fixture();
  let saved: JournalTransaction | undefined;
  let prepares = 0;
  let sends = 0;
  const options = {
    intent: f.intent,
    load: async () => saved,
    prepare: async () => {
      prepares++;
      return f.serialized;
    },
    save: async (tx: JournalTransaction) => {
      saved = tx;
    },
    findReceipt: async (_hash: Hex): Promise<string | undefined> => undefined,
    broadcast: async (serialized: Hex) => {
      assert.equal(saved?.serialized, serialized);
      sends++;
      throw new Error("Disconnected after send");
    },
    waitReceipt: async (_hash: Hex) => "mined",
  };
  await assert.rejects(executeJournaled(options), /Disconnected/);
  const result = await executeJournaled({
    ...options,
    broadcast: async (serialized) => {
      sends++;
      assert.equal(serialized, f.serialized);
      return f.hash;
    },
  });
  assert.equal(result.receipt, "mined");
  assert.equal(prepares, 1);
  assert.equal(sends, 2);
});

test("confirmed transactions replay from public hashes without keys or signed payloads", async () => {
  const f = await fixture();
  const unexpected = async (): Promise<never> => {
    throw new Error("Must not submit");
  };
  const result = await executeJournaled({
    intent: f.intent,
    load: async () => ({ intent: f.intent, hash: f.hash }),
    prepare: unexpected,
    save: unexpected,
    findReceipt: async () => "confirmed",
    broadcast: unexpected,
    waitReceipt: unexpected,
  });
  assert.equal(result.receipt, "confirmed");
});

test("changed intent and tampered signed payloads cannot trigger broadcasts", async () => {
  const f = await fixture();
  const unexpected = async (): Promise<never> => {
    throw new Error("Must not submit");
  };
  const options = {
    intent: f.intent,
    prepare: unexpected,
    save: unexpected,
    findReceipt: async () => undefined,
    broadcast: unexpected,
    waitReceipt: unexpected,
  };
  await assert.rejects(
    executeJournaled({
      ...options,
      load: async () => ({
        intent: { ...f.intent, valueWei: "1" },
        hash: f.hash,
        serialized: f.serialized,
      }),
    }),
    /does not match/,
  );
  await assert.rejects(
    executeJournaled({
      ...options,
      load: async () => ({
        intent: f.intent,
        hash: keccak256("0x1234"),
        serialized: f.serialized,
      }),
    }),
    /hash mismatch/,
  );
  const other = await fixture();
  await assert.rejects(
    executeJournaled({
      ...options,
      load: async () => ({
        intent: f.intent,
        hash: other.hash,
        serialized: other.serialized,
      }),
    }),
    /does not match/,
  );
});

test("persistence failure prevents broadcast", async () => {
  const f = await fixture();
  let broadcast = false;
  await assert.rejects(
    executeJournaled({
      intent: f.intent,
      load: async () => undefined,
      prepare: async () => f.serialized,
      save: async () => {
        throw new Error("Disk full");
      },
      findReceipt: async () => undefined,
      broadcast: async () => {
        broadcast = true;
        return f.hash;
      },
      waitReceipt: async () => "mined",
    }),
    /Disk full/,
  );
  assert.equal(broadcast, false);
});
