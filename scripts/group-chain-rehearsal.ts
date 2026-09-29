import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  type Abi,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  groupChainTransaction,
  readGroupChain,
  verifyGroupSigningPolicy,
  type GroupChainAction,
} from "../src/lib/group-chain.js";
import { hashPolicy, policySchema } from "../src/lib/signing-policy.js";
import type {
  SigningPolicy,
  GroupPolicyConfig,
} from "../src/lib/group-policy.js";
import {
  GroupExecutionWorker,
  type ExecutionStore,
} from "./lib/group-execution-worker.js";
import type { JournalTransaction } from "./lib/transaction-journal.js";
import type { GroupChainEvent } from "../src/lib/group-execution.js";

class MemoryExecutionStore implements ExecutionStore {
  journal: JournalTransaction | undefined;
  saves = 0;
  executionStatus = "";
  events: GroupChainEvent[] = [];
  cursor: { blockNumber: string; blockHash: Hex } | undefined;
  async checkpoint() {
    return this.cursor;
  }
  async record(
    _id: string,
    state: Awaited<ReturnType<typeof readGroupChain>>,
    hash: Hex,
    from: bigint,
    events: GroupChainEvent[],
  ) {
    this.cursor = { blockNumber: state.blockNumber, blockHash: hash };
    this.events = this.events
      .filter((e) => BigInt(e.blockNumber) < from)
      .concat(events);
  }
  async load() {
    return this.journal;
  }
  async save(
    _id: string,
    entry: JournalTransaction,
    reserved: bigint,
    cap: bigint,
  ) {
    assert.ok(reserved <= cap);
    this.saves++;
    this.journal = structuredClone(entry);
    this.executionStatus = "pending";
  }
  async pendingOther() {
    return false;
  }
  async status(_id: string, status: string) {
    this.executionStatus = status;
  }
}

// Disposable local EVM only. No environment credentials or Sepolia writes.
async function main() {
  const version = process.argv.includes("--v2") ? 2 : 1;
  const memberCount =
    version === 2
      ? Number(
          process.argv.includes("--members")
            ? process.argv[process.argv.indexOf("--members") + 1]
            : 4,
        )
      : 6;
  if (!Number.isInteger(memberCount) || memberCount < 2 || memberCount > 100)
    throw new Error("Invalid member count");
  const funding = String(memberCount * 10000000);
  const payment = String(memberCount * 7500000);
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  const child = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "11155111",
      "--silent",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  try {
    const transport = http(`http://127.0.0.1:${port}`, {
      retryCount: 0,
      timeout: 2000,
    });
    const reader = createPublicClient({
      chain: sepolia,
      transport,
      cacheTime: 0,
    });
    const rpc = async (method: string, params: unknown[] = []) => {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = (await response.json()) as { error?: unknown };
      if (body.error) throw new Error(JSON.stringify(body.error));
    };
    for (let retry = 0; ; retry++) {
      if (spawnError) throw spawnError;
      try {
        await reader.getChainId();
        break;
      } catch {
        if (retry === 30) throw new Error("Anvil did not start");
        await sleep(100);
      }
    }
    const accounts = Array.from({ length: memberCount + 1 }, () =>
      privateKeyToAccount(generatePrivateKey()),
    );
    const members = accounts.slice(0, memberCount);
    for (const account of accounts)
      await rpc("anvil_setBalance", [account.address, "0x8ac7230489e80000"]);
    const wallet = (index: number) =>
      createWalletClient({
        account: accounts[index]!,
        chain: sepolia,
        transport,
      });
    const confirmed = async (hash: Hex) => {
      const receipt = await reader.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success");
      await rpc("evm_mine");
      return receipt;
    };
    const tokenArtifact = JSON.parse(
      await readFile("contracts/out/MockUSDC.sol/MockUSDC.json", "utf8"),
    ) as { abi: Abi; bytecode: { object: Hex } };
    const escrowArtifact = JSON.parse(
      await readFile(
        version === 2
          ? "contracts/out-v2/ConvergeGroupWalletV2.sol/ConvergeGroupWalletV2.json"
          : "contracts/out/ConvergeGroupWallet.sol/ConvergeGroupWallet.json",
        "utf8",
      ),
    ) as { abi: Abi; bytecode: { object: Hex } };
    const token = (
      await confirmed(
        await wallet(0).deployContract({
          abi: tokenArtifact.abi,
          bytecode: tokenArtifact.bytecode.object,
        }),
      )
    ).contractAddress!;
    const escrow = (
      await confirmed(
        await wallet(0).deployContract({
          abi: escrowArtifact.abi,
          bytecode: escrowArtifact.bytecode.object,
          args: [token],
        }),
      )
    ).contractAddress!;
    const config: GroupPolicyConfig = {
      policyVersion: version,
      chainId: 11155111,
      verifyingContract: escrow,
      token,
      executor: accounts[memberCount]!.address,
    };
    const now = Number((await reader.getBlock()).timestamp);
    const policy = policySchema.parse({
      ...config,
      policyVersion: version,
      decisionId: keccak256(stringToHex("ordinary-group")),
      merchant: privateKeyToAccount(generatePrivateKey()).address,
      participants: members.map((a) => a.address),
      approvalThreshold: memberCount,
      contributionPerParticipant: "10000000",
      paymentAmount: payment,
      maxDeposit: funding,
      maxTotalSpend: funding,
      expiry: now + 3600,
      reservationReference: keccak256(stringToHex("reservation")),
    });
    const saved: SigningPolicy = {
      policy,
      policyHash: hashPolicy(policy),
      createdAt: new Date().toISOString(),
    };
    const state = (index = 0, input = saved) =>
      readGroupChain(reader, input, config, accounts[index]!.address);
    const send = async (
      index: number,
      action: GroupChainAction,
      input = saved,
    ) => {
      const snapshot = await state(index, input);
      const tx = groupChainTransaction(
        input,
        config,
        accounts[index]!.address,
        snapshot,
        action,
      );
      await reader.call({ ...tx, account: accounts[index]!.address });
      return confirmed(await wallet(index).sendTransaction(tx));
    };
    assert.equal((await state()).registered, false);
    assert.throws(
      () =>
        verifyGroupSigningPolicy(saved, config, accounts[memberCount]!.address),
      /NOT_POLICY_PARTICIPANT/,
    );
    assert.throws(
      () =>
        verifyGroupSigningPolicy(
          {
            ...saved,
            policy: { ...policy, paymentAmount: String(BigInt(payment) - 1n) },
          },
          config,
          members[0]!.address,
        ),
      /POLICY_HASH_MISMATCH/,
    );
    await send(0, "register");
    assert.equal((await state()).registered, true);
    await assert.rejects(send(1, "register"), /REGISTRATION_UNAVAILABLE/);
    const changed = { ...policy, paymentAmount: String(BigInt(payment) - 1n) };
    await assert.rejects(
      state(0, { ...saved, policy: changed, policyHash: hashPolicy(changed) }),
      /CHAIN_POLICY_MISMATCH/,
    );
    await assert.rejects(send(0, "allowance"), /INSUFFICIENT_MOCKUSDC/);
    for (let index = 0; index < memberCount; index++) {
      await confirmed(
        await wallet(0).writeContract({
          address: token,
          abi: tokenArtifact.abi,
          functionName: "mint",
          args: [members[index]!.address, 20000000n],
        }),
      );
      await assert.rejects(send(index, "contribute"), /ALLOWANCE_REQUIRED/);
      await send(index, "allowance");
      await send(index, "contribute");
      await assert.rejects(
        send(index, "contribute"),
        /CONTRIBUTION_UNAVAILABLE/,
      );
    }
    const active = await state();
    assert.equal(active.status, 1);
    assert.equal(active.approvals, memberCount);
    assert.equal(active.contributed, funding);
    assert.ok(
      active.members.every((member) => member.contribution === "10000000"),
    );
    await send(Math.min(2, memberCount - 1), "cancel");
    for (let index = 0; index < memberCount; index++) {
      assert.equal((await state(index)).refund, "10000000");
      await send(index, "refund");
      await assert.rejects(send(index, "refund"), /REFUND_UNAVAILABLE/);
    }
    assert.equal((await state()).refunded, funding);
    const nextPolicy = {
      ...policy,
      decisionId: keccak256(stringToHex("expired-group")),
    };
    const next = {
      ...saved,
      policy: nextPolicy,
      policyHash: hashPolicy(nextPolicy),
    };
    await send(0, "register", next);
    await send(0, "allowance", next);
    await send(0, "contribute", next);
    await rpc("evm_increaseTime", [4000]);
    await rpc("evm_mine");
    await rpc("evm_mine");
    await assert.rejects(
      send(1, "allowance", next),
      /CONTRIBUTION_UNAVAILABLE/,
    );
    await send(0, "refund", next);
    assert.equal((await state(0, next)).refunded, "10000000");
    const payPolicy = {
      ...policy,
      decisionId: keccak256(stringToHex("agent-payment")),
      expiry: Number((await reader.getBlock()).timestamp) + 3600,
    };
    const pay = {
      ...saved,
      policy: payPolicy,
      policyHash: hashPolicy(payPolicy),
      groupId: "isolated-group",
    };
    const store = new MemoryExecutionStore();
    const worker = new GroupExecutionWorker(
      reader,
      transport,
      accounts[memberCount]!,
      config,
      store,
      0n,
      10000000000000000n,
    );
    await send(0, "register", pay);
    for (let index = 0; index < memberCount; index++) {
      await send(index, "allowance", pay);
      await send(index, "contribute", pay);
      if (index === memberCount - 2) {
        await worker.tick(pay);
        assert.equal(store.journal, undefined);
      }
    }
    const interruptedClient = {
      ...reader,
      sendRawTransaction: async (
        ...args: Parameters<typeof reader.sendRawTransaction>
      ) => {
        await reader.sendRawTransaction(...args);
        throw new Error("Simulated lost broadcast response");
      },
    };
    const interrupted = new GroupExecutionWorker(
      interruptedClient,
      transport,
      accounts[memberCount]!,
      config,
      store,
      0n,
      10000000000000000n,
    );
    await assert.rejects(
      interrupted.tick(pay),
      /Simulated lost broadcast response/,
    );
    assert.equal(store.saves, 1);
    const originalHash = store.journal!.hash;
    await rpc("evm_mine");
    const resumed = new GroupExecutionWorker(
      reader,
      transport,
      accounts[memberCount]!,
      config,
      store,
      0n,
      10000000000000000n,
    );
    await resumed.tick(pay);
    await resumed.tick(pay);
    assert.equal(store.saves, 1);
    assert.equal(store.journal!.hash, originalHash);
    assert.equal(store.executionStatus, "confirmed");
    assert.equal((await state(0, pay)).spent, payment);
    assert.equal(
      store.events.filter((e) => e.kind === "PaymentExecuted").length,
      1,
    );
    for (let index = 0; index < memberCount; index++)
      await send(index, "refund", pay);
    await resumed.tick(pay);
    assert.equal((await state(0, pay)).refunded, String(memberCount * 2500000));
    assert.equal(
      store.events.filter((e) => e.kind === "RefundClaimed").length,
      memberCount,
    );
    store.cursor!.blockHash = `0x${"0".repeat(64)}`;
    await resumed.tick(pay);
    assert.equal(
      store.events.filter((e) => e.kind === "PaymentExecuted").length,
      1,
    );
    assert.equal(
      store.events.filter((e) => e.kind === "RefundClaimed").length,
      memberCount,
    );
    console.log(
      "PASS: agent executes only after all contributions; lost broadcast response resumes the same signed hash; history replay is idempotent; all participant refunds recorded.",
    );
    console.log(
      "PASS: ordinary-group registration, exact allowances, all contributions, hash/member checks, duplicate prevention, cancellation, expiry and refunds on disposable Anvil.",
    );
  } finally {
    child.kill();
  }
}
main().catch((error: unknown) => {
  console.error("Group chain rehearsal failed.", error);
  process.exitCode = 1;
});
