import assert from "node:assert/strict";
import { join } from "node:path";
import {
  createWalletClient,
  encodeFunctionData,
  http,
  parseEther,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import tokenAbiJson from "../src/lib/abi/mockUSDC.json";
import {
  atomicJson,
  optionalJson,
  withFileLock,
} from "../src/lib/explore/store.js";
import {
  executeJournaled,
  type JournalTransaction,
} from "./lib/transaction-journal.js";
import { ExploreWorker } from "./lib/explore-worker.js";

const tokenAbi = tokenAbiJson as typeof tokenAbiJson;
const tokenTarget = 30_000_000n;
const allowanceTarget = 30_000_000n;
const batch = process.env.EXPLORE_PREP_BATCH || "first";
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(batch))
  throw new Error("Invalid EXPLORE_PREP_BATCH");
const execute = process.argv.includes("--execute");
if (
  process.argv.slice(2).some((arg) => arg !== "--execute" && arg !== "--check")
)
  throw new Error("Usage: demo:explore-prepare [--check|--execute]");

async function main() {
  const worker = new ExploreWorker();
  await worker.init();
  const journalPath = join(
    worker.store.root,
    "private",
    `bot-preparation-${batch}.json`,
  );
  const journal =
    (await optionalJson<Record<string, JournalTransaction>>(journalPath)) || {};
  const targets = [
    ...worker.bots.map((account, index) => ({
      account,
      name: `bot-${index + 2}`,
      eth: parseEther(index === 0 ? "0.004" : "0.002"),
      tokens: true,
    })),
    {
      account: worker.executor,
      name: "executor",
      eth: parseEther("0.001"),
      tokens: false,
    },
  ];
  const inspect = async () =>
    Promise.all(
      targets.map(async (target) => ({
        ...target,
        balance: await worker.client.getBalance({
          address: target.account.address,
        }),
        tokenBalance: target.tokens
          ? ((await worker.readToken("balanceOf", [
              target.account.address,
            ])) as bigint)
          : 0n,
        allowance: target.tokens
          ? ((await worker.readToken("allowance", [
              target.account.address,
              worker.escrow,
            ])) as bigint)
          : 0n,
      })),
    );
  const before = await inspect();
  const totalEth = before.reduce(
    (sum, item) =>
      sum + (item.balance < item.eth ? item.eth - item.balance : 0n),
    0n,
  );
  if (totalEth > parseEther("0.02"))
    throw new Error("Preparation exceeds the 0.02 ETH top-up cap");
  const deployerBalance = await worker.client.getBalance({
    address: worker.deployer.address,
  });
  if (deployerBalance < totalEth + parseEther("0.003"))
    throw new Error(
      "Deployer needs more Sepolia ETH for preparation and the next judge",
    );
  for (const item of before)
    console.log(
      `${item.name}: ETH ${item.balance}/${item.eth}, MockUSDC ${item.tokenBalance}/${item.tokens ? tokenTarget : 0n}, allowance ${item.allowance}/${item.tokens ? allowanceTarget : 0n}`,
    );
  if (!execute) {
    console.log(`Read-only check. ETH top-ups needed: ${totalEth} wei.`);
    return;
  }

  await withFileLock(join(worker.store.root, "worker.lock"), async () => {
    if (Object.values(worker.ledger).some((entry) => !entry.confirmed))
      throw new Error(
        "Finish pending Explore transactions before preparing bots",
      );
    const current = await inspect();
    const requiredEth = current.reduce(
      (sum, item) =>
        sum + (item.balance < item.eth ? item.eth - item.balance : 0n),
      0n,
    );
    if (requiredEth > parseEther("0.02"))
      throw new Error("Preparation exceeds the 0.02 ETH top-up cap");
    if (
      (await worker.client.getBalance({ address: worker.deployer.address })) <
      requiredEth + parseEther("0.003")
    )
      throw new Error("Deployer balance changed; replenish Sepolia ETH first");
    const send = async (
      label: string,
      account: PrivateKeyAccount,
      to: Address,
      data: Hex = "0x",
      value = 0n,
    ) => {
      const intent = {
        chainId: sepolia.id,
        from: account.address,
        to,
        data,
        valueWei: value.toString(),
      };
      const wallet = createWalletClient({
        account,
        chain: sepolia,
        transport: http(process.env.RPC_URL!, { timeout: 20_000 }),
      });
      const outcome = await executeJournaled<TransactionReceipt>({
        intent,
        load: async () => journal[label],
        prepare: async () => {
          const request = await wallet.prepareTransactionRequest({
            account,
            to,
            data,
            value,
          });
          if (request.gas !== undefined) request.gas += request.gas / 4n;
          return wallet.signTransaction(request);
        },
        save: async (transaction) => {
          journal[label] = transaction;
          await atomicJson(journalPath, journal);
        },
        findReceipt: async (hash) => {
          try {
            return await worker.client.getTransactionReceipt({ hash });
          } catch (error) {
            if (error instanceof TransactionReceiptNotFoundError)
              return undefined;
            throw error;
          }
        },
        broadcast: (serialized) =>
          worker.client.sendRawTransaction({
            serializedTransaction: serialized,
          }),
        waitReceipt: (hash) =>
          worker.client.waitForTransactionReceipt({
            hash,
            confirmations: 2,
            timeout: 180_000,
          }),
      });
      assert.equal(outcome.receipt.status, "success", `${label} reverted`);
      const confirmed = await worker.client.waitForTransactionReceipt({
        hash: outcome.transaction.hash,
        confirmations: 2,
        timeout: 180_000,
      });
      assert.equal(confirmed.status, "success", `${label} reverted`);
      assert.equal(
        (await worker.client.getBlock({ blockNumber: confirmed.blockNumber }))
          .hash,
        confirmed.blockHash,
      );
      console.log(`${label}: ${outcome.transaction.hash}`);
    };

    for (const item of current) {
      if (item.balance < item.eth)
        await send(
          `${item.name}:eth`,
          worker.deployer,
          item.account.address,
          "0x",
          journal[`${item.name}:eth`]
            ? BigInt(journal[`${item.name}:eth`]!.intent.valueWei)
            : item.eth - item.balance,
        );
      if (!item.tokens) continue;
      if (item.tokenBalance < tokenTarget)
        await send(
          `${item.name}:mint`,
          worker.deployer,
          worker.token,
          encodeFunctionData({
            abi: tokenAbi,
            functionName: "mint",
            args: [item.account.address, tokenTarget - item.tokenBalance],
          }),
        );
      if (item.allowance < allowanceTarget)
        await send(
          `${item.name}:approve`,
          item.account,
          worker.token,
          encodeFunctionData({
            abi: tokenAbi,
            functionName: "approve",
            args: [worker.escrow, allowanceTarget],
          }),
        );
    }
    const afterApproval = await inspect();
    for (const item of afterApproval) {
      if (item.balance < item.eth)
        await send(
          `${item.name}:eth-after-approval`,
          worker.deployer,
          item.account.address,
          "0x",
          journal[`${item.name}:eth-after-approval`]
            ? BigInt(
                journal[`${item.name}:eth-after-approval`]!.intent.valueWei,
              )
            : item.eth - item.balance,
        );
    }
    const after = await inspect();
    for (const item of after) {
      assert.ok(item.balance >= item.eth, `${item.name} gas shortfall`);
      if (item.tokens) {
        assert.ok(
          item.tokenBalance >= tokenTarget,
          `${item.name} token shortfall`,
        );
        assert.ok(
          item.allowance >= allowanceTarget,
          `${item.name} allowance shortfall`,
        );
      }
    }
    console.log(
      "Five Explore bots and the executor are ready for the next demo.",
    );
  });
}

main().catch((error) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(
    `Bot preparation failed (${name}). Preserve the private transaction journal and inspect local RPC configuration.`,
  );
  process.exitCode = 1;
});
