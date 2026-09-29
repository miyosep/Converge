import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { DatabaseExploreStore } from "../src/lib/explore/database-store.js";
import { explorePersistence } from "../src/lib/jobs/journal.js";
import { JobBusy, withJobLease } from "../src/lib/jobs/lease.js";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ExploreWorker } from "./lib/explore-worker.js";
import { ExploreStore, optionalJson } from "../src/lib/explore/store.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";

// This harness injects disposable local accounts into the worker. Production init
// remains pinned to Sepolia genesis, deployment bytecode, and public manifests.
async function main() {
  const useDatabase = process.argv.includes("--database");
  const livePlace = process.argv.includes("--live-place");
  const repeatWallet = process.argv.includes("--repeat-wallet");
  if (
    useDatabase &&
    (process.env.NEON_BRANCH !== "dev-vercel-inngest" ||
      !process.env.DATABASE_URL)
  )
    throw new Error("Isolated test branch required");
  const pool = useDatabase
    ? new Pool({
        connectionString: verifiedPostgresUrl(process.env.DATABASE_URL!),
        max: 5,
      })
    : undefined;
  const savedIds: string[] = [];
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
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
  const root = await mkdtemp(join(tmpdir(), "converge-explore-chain-"));
  try {
    const transport = http(`http://127.0.0.1:${port}`, {
      retryCount: 0,
      timeout: 1000,
    });
    const client = createPublicClient({
      chain: sepolia,
      transport,
      cacheTime: 0,
    });
    const rpc = async (method: string, params: unknown[] = []) => {
      const result = (await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }).then((response) => response.json())) as { error?: unknown };
      if (result.error) throw new Error(JSON.stringify(result.error));
    };
    for (let retry = 0; ; retry++) {
      if (spawnError) throw spawnError;
      try {
        await client.getChainId();
        break;
      } catch {
        if (retry === 30) throw new Error("Anvil did not start");
        await sleep(100);
      }
    }
    const deployer = privateKeyToAccount(generatePrivateKey());
    const executor = privateKeyToAccount(generatePrivateKey());
    const bots = Array.from({ length: 5 }, () =>
      privateKeyToAccount(generatePrivateKey()),
    );
    const merchants = Object.fromEntries(
      ["A", "B", "C", "D", "E"].map((id) => [
        id,
        privateKeyToAccount(generatePrivateKey()).address,
      ]),
    );
    await rpc("anvil_setBalance", [
      deployer.address,
      `0x${parseEther("10").toString(16)}`,
    ]);
    const deployWallet = createWalletClient({
      account: deployer,
      chain: sepolia,
      transport,
    });
    const tokenArtifact = JSON.parse(
      await readFile("contracts/out/MockUSDC.sol/MockUSDC.json", "utf8"),
    ) as { abi: Abi; bytecode: { object: Hex } };
    const walletArtifact = JSON.parse(
      await readFile(
        "contracts/out/ConvergeGroupWallet.sol/ConvergeGroupWallet.json",
        "utf8",
      ),
    ) as { abi: Abi; bytecode: { object: Hex } };
    const token = (
      await client.waitForTransactionReceipt({
        hash: await deployWallet.deployContract({
          abi: tokenArtifact.abi,
          bytecode: tokenArtifact.bytecode.object,
        }),
      })
    ).contractAddress!;
    const escrow = (
      await client.waitForTransactionReceipt({
        hash: await deployWallet.deployContract({
          abi: walletArtifact.abi,
          bytecode: walletArtifact.bytecode.object,
          args: [token],
        }),
      })
    ).contractAddress!;
    const store = pool
      ? new DatabaseExploreStore(pool)
      : new ExploreStore(root);
    await mkdir(join(root, "private"));
    const worker = Object.assign(
      Object.create(ExploreWorker.prototype) as ExploreWorker,
      {
        store,
        roles: {
          schemaVersion: 1,
          chainId: 11155111,
          mode: "single-operator-demo",
          executor: executor.address,
          merchants,
        },
        token,
        escrow,
        client,
        transport,
        bots,
        deployer,
        executor,
        ledgerPath: join(root, "private", "transactions.json"),
        ledger: {},
      },
    );
    const read = (name: string, args: unknown[]) =>
      client.readContract({
        address: escrow,
        abi: walletArtifact.abi,
        functionName: name,
        args,
      });
    const maxPending = new Map<string, number>();
    async function advanceState(id: string) {
      // Reload the signed journal on every pass, exercising restart recovery.
      worker.ledger = worker.persistence
        ? await worker.persistence.load()
        : ((await optionalJson<typeof worker.ledger>(worker.ledgerPath)) ?? {});
      const state = (await worker.store.read(id))!;
      try {
        await worker.tick(state);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "WAITING_FOR_CONFIRMATIONS"
        )
          throw error;
      }
      await worker.store.save(state);
      const pending = Object.entries(worker.ledger).filter(
        ([key, entry]) => key.startsWith(`${id}:`) && !entry.confirmed,
      ).length;
      maxPending.set(id, Math.max(maxPending.get(id) ?? 0, pending));
      await rpc("evm_mine");
      return state;
    }
    async function withRuntime<T>(id: string, work: () => Promise<T>) {
      if (!pool) return work();
      for (let attempt = 0; ; attempt++) {
        try {
          return await withJobLease(pool, "chain-execution", async (lease) => {
            const persistence = explorePersistence(pool, lease);
            Object.assign(worker, { persistence, store: persistence.store });
            return worker.store.withRunLock(id, work);
          });
        } catch (error) {
          if (!(error instanceof JobBusy) || attempt >= 60) throw error;
          await sleep(5000);
        }
      }
    }
    const advance = (id: string) => withRuntime(id, () => advanceState(id));
    const sharedJudge = privateKeyToAccount(generatePrivateKey());
    let previousRunId: string | undefined;
    for (const scenario of ["payment", "cancel", "expiry"] as const) {
      const judge = repeatWallet
        ? sharedJudge
        : privateKeyToAccount(generatePrivateKey());
      const judgeWallet = createWalletClient({
        account: judge,
        chain: sepolia,
        transport,
      });
      const state = await store.create(
        judge.address,
        5,
        repeatWallet ? previousRunId : undefined,
      );
      assert.ok(!savedIds.includes(state.id));
      previousRunId = state.id;
      savedIds.push(state.id);
      state.phase = "review";
      state.revision = 1;
      state.extraction = createBaselinePreferences([
        judge.address,
        ...bots.map((bot) => bot.address),
      ])[0]!.extraction;
      if (livePlace) {
        delete state.extraction;
        state.discovery = {
          source: "xAPI (Google Maps)",
          query: "Japanese restaurants near Gangnam Station",
          searchedAt: new Date().toISOString(),
          excludedCount: 0,
          intent: {
            area: "Gangnam Station, Seoul",
            cuisine: "Japanese",
            koreanQuery: "Japanese restaurants near Gangnam Station",
            budget: null,
            people: 6,
            facilities: [],
            otherRequirements: [],
            clarifications: [],
          },
          places: [
            {
              id: "local-fixture",
              name: "Local chain rehearsal venue (fixture)",
              address: "Gangnam Station",
              mapsUrl:
                "https://www.google.com/maps/search/?api=1&query=Gangnam",
              websiteUrl: null,
              price: null,
              evidence: [],
              attributions: [],
            },
          ],
        };
      }
      await store.withRunLock(state.id, () => store.save(state));
      await store.queue(
        judge.address,
        livePlace
          ? {
              action: "select_place",
              revision: 1,
              placeId: "local-fixture",
              depositUsdc: 48,
              acknowledgeDemo: true,
            }
          : {
              action: "confirm",
              revision: 1,
              extraction: state.extraction,
            },
        state.id,
      );
      await advance(state.id);
      assert.equal((await store.read(state.id))!.phase, "proposal");
      await store.queue(judge.address, { action: "prepare" }, state.id);
      for (let i = 0; i < 30; i++) {
        if ((await advance(state.id)).phase === "approval") break;
      }
      const ready = (await store.read(state.id))!;
      if (livePlace) {
        assert.equal(ready.policy!.paymentAmount, "48000000");
        assert.equal(ready.selectedPlace?.id, "local-fixture");
        assert.equal(ready.reservation?.source, "live-place-demo");
        await assert.rejects(
          store.queue(
            judge.address,
            {
              action: "search",
              text: "New restaurant",
            },
            state.id,
          ),
          /POLICY_LOCKED/,
        );
      }
      assert.equal(ready.phase, "approval");
      assert.equal(ready.reservation?.status, "REQUESTED");
      assert.equal(
        ready.reservation?.reference,
        ready.policy?.reservationReference,
      );
      assert.equal(
        ready.approvals,
        0,
        "Bots must wait for the judge's actual contribution",
      );
      assert.equal(
        await client.readContract({
          address: token,
          abi: tokenArtifact.abi,
          functionName: "balanceOf",
          args: [judge.address],
        }),
        10_000_000n,
      );
      const id = ready.policy!.decisionId;
      async function judgeCall(functionName: string) {
        const hash = await judgeWallet.writeContract({
          address: escrow,
          abi: walletArtifact.abi,
          functionName,
          args:
            functionName === "approveAndContribute"
              ? [id, ready.policyHash]
              : [id],
        });
        assert.equal(
          (await client.waitForTransactionReceipt({ hash })).status,
          "success",
        );
        await rpc("evm_mine");
      }
      await client.waitForTransactionReceipt({
        hash: await judgeWallet.writeContract({
          address: token,
          abi: tokenArtifact.abi,
          functionName: "approve",
          args: [escrow, 10_000_000n],
        }),
      });
      await judgeCall("approveAndContribute");
      if (scenario === "cancel") await judgeCall("cancelDecision");
      if (scenario === "expiry") {
        await rpc("evm_increaseTime", [24 * 3600]);
        await rpc("evm_mine");
      }
      let finished = ready;
      for (let i = 0; i < 140; i++) {
        finished = await advance(state.id);
        if (["completed", "cancelled", "expired"].includes(finished.phase)) {
          let refunded = true;
          for (const bot of bots)
            if (
              (await read("contributionOf", [id, bot.address])) !== 0n &&
              !(await read("refundClaimed", [id, bot.address]))
            )
              refunded = false;
          if (
            refunded &&
            !Object.entries(worker.ledger).some(
              ([key, entry]) =>
                key.startsWith(`${state.id}:`) && !entry.confirmed,
            )
          )
            break;
        }
      }
      assert.equal(
        finished.phase,
        scenario === "payment"
          ? "completed"
          : scenario === "cancel"
            ? "cancelled"
            : "expired",
      );
      assert.equal(
        finished.reservation?.status,
        scenario === "payment"
          ? "DEMO_CONFIRMED"
          : scenario === "cancel"
            ? "CANCELLED"
            : "EXPIRED",
      );
      assert.equal(
        finished.refund,
        scenario === "payment"
          ? livePlace
            ? "2000000"
            : "2500000"
          : "10000000",
      );
      if (scenario === "payment") {
        assert.equal(finished.approvals, 6);
        assert.equal(finished.rejection?.reason, "MaxDepositExceeded");
        assert.ok(
          (maxPending.get(state.id) ?? 0) >= 5,
          "Five independent automated wallet transactions must be broadcast in one pass",
        );
      }
      await judgeCall("claimRefund");
      await advance(state.id);
      assert.equal((await store.read(state.id))!.refunded, true);
      assert.equal(
        await client.readContract({
          address: token,
          abi: tokenArtifact.abi,
          functionName: "balanceOf",
          args: [judge.address],
        }),
        scenario === "payment"
          ? livePlace
            ? 2_000_000n
            : 2_500_000n
          : 10_000_000n,
      );
      const count = Object.keys(worker.ledger).length;
      await advance(state.id);
      assert.equal(
        Object.keys(worker.ledger).length,
        count,
        "Refresh/restart must not duplicate payments or grants",
      );
      await withRuntime(state.id, async () => {
        const entry = Object.values(worker.ledger)[0]!;
        entry.confirmed = false;
        await assert.rejects(
          worker.transact(
            finished,
            "Blocked concurrency test",
            deployer,
            judge.address,
          ),
          /WAITING_FOR_OTHER_TRANSACTION/,
        );
        entry.confirmed = true;
        const previousCap = process.env.EXPLORE_DEMO_MAX_ETH;
        process.env.EXPLORE_DEMO_MAX_ETH = "0";
        try {
          await assert.rejects(
            worker.transact(
              finished,
              "Blocked budget test",
              deployer,
              judge.address,
            ),
            /DEMO_ETH_BUDGET_EXCEEDED/,
          );
        } finally {
          if (previousCap === undefined)
            delete process.env.EXPLORE_DEMO_MAX_ETH;
          else process.env.EXPLORE_DEMO_MAX_ETH = previousCap;
        }
        assert.equal(
          Object.keys(worker.ledger).length,
          count,
          "Blocked work must never be signed or broadcast",
        );
      });
      console.log(
        `Local Explore ${scenario}: passed, including judge refund and restart idempotency.`,
      );
    }
    if (repeatWallet) {
      assert.equal((await store.listRuns(sharedJudge.address)).length, 3);
      assert.equal((await store.owned(sharedJudge.address))?.id, previousRunId);
      console.log(
        "Same wallet: three independent rounds preserved with their payment/refund records.",
      );
    }
    console.log(
      "Explore integration rehearsal passed on disposable Anvil. No Sepolia transactions or live Kiln calls.",
    );
  } finally {
    if (pool) {
      for (const id of savedIds) {
        await pool.query(
          "DELETE FROM converge_job_transactions WHERE id LIKE $1",
          [`explore:${id}:%`],
        );
        await pool.query("DELETE FROM converge_explore_runs WHERE id=$1", [id]);
      }
      await pool.end();
    }
    if (child.pid !== undefined && child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
