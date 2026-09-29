import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import tokenAbiJson from "../src/lib/abi/mockUSDC.json";
import walletAbiJson from "../src/lib/abi/convergeGroupWallet.json";
import {
  ExploreStore,
  atomicJson,
  optionalJson,
} from "../src/lib/explore/store.js";
import type { ExploreRun, ExploreView } from "../src/lib/explore/types.js";
import { hashPolicy, policySchema } from "../src/lib/policy.js";

const origin = process.env.APP_ORIGIN || "http://localhost:3000";
const tokenAbi = tokenAbiJson as Abi;
const walletAbi = walletAbiJson as Abi;
const store = new ExploreStore();
const privatePath = join(store.root, "private", "judge-rehearsal.json");
const preferenceText = "Under $35 per person, and somewhere quiet.";
const timeout = Date.now() + 20 * 60_000;

async function post(path: string, body: unknown, cookie = "") {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as {
    error?: string;
    run?: ExploreRun;
    challengeId?: string;
    message?: string;
  };
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${result.error || "unknown"}`);
  return { response, result };
}
async function main() {
  if (
    !origin.startsWith("http://localhost:") &&
    !origin.startsWith("http://127.0.0.1:")
  )
    throw new Error("This rehearsal requires a local web server");
  if (!process.env.RPC_URL) throw new Error("RPC_URL missing");
  await store.init();
  const saved = await optionalJson<{ privateKey: Hex }>(privatePath);
  const privateKey = saved?.privateKey || generatePrivateKey();
  if (!saved) await atomicJson(privatePath, { privateKey });
  const judge = privateKeyToAccount(privateKey);
  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.RPC_URL, { timeout: 20000 }),
  });
  const wallet = createWalletClient({
    account: judge,
    chain: sepolia,
    transport: http(process.env.RPC_URL, { timeout: 20000 }),
  });
  assert.equal(await client.getChainId(), sepolia.id);
  const challenge = (
    await post("/api/auth/challenge", { address: judge.address })
  ).result;
  assert.ok(challenge.message && challenge.challengeId);
  const signature = await judge.signMessage({ message: challenge.message });
  const verified = await post("/api/auth/verify", {
    challengeId: challenge.challengeId,
    signature,
  });
  const cookie = verified.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const getView = async () => {
    const response = await fetch(`${origin}/api/demo`, {
      headers: { Cookie: cookie },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Demo status HTTP ${response.status}`);
    return response.json() as Promise<ExploreView>;
  };
  let view = await getView();
  assert.equal(view.enabled, true);
  assert.equal(view.workerOnline, true);
  if (!view.run) {
    view.run = (
      await post(
        "/api/demo",
        {
          action: "start",
          accessCode: process.env.EXPLORE_DEMO_ACCESS_CODE || "",
        },
        cookie,
      )
    ).result.run!;
    console.log(
      "Session admitted with a new judge address. No funds sent yet.",
    );
  }
  const runId = view.run.id;
  const wait = async (label: string, test: (run: ExploreRun) => boolean) => {
    let phase = "";
    while (Date.now() < timeout) {
      const latest = await getView();
      assert.equal(latest.run?.id, runId);
      if (latest.run.phase !== phase) {
        phase = latest.run.phase;
        console.log(`${label}: ${phase}`);
      }
      if (latest.run.error && !latest.run.error.startsWith("WAITING"))
        throw new Error(`${label}: ${latest.run.error}`);
      if (test(latest.run)) return latest.run;
      await sleep(4000);
    }
    throw new Error(
      `${label} timed out; rerun this script to resume the same judge wallet and journal`,
    );
  };
  if (
    view.run.phase === "preferences" &&
    !view.run.command &&
    !view.run.extraction
  ) {
    await post(
      "/api/demo",
      { action: "extract", text: preferenceText },
      cookie,
    );
  }
  let run = await wait(
    "Kiln extraction",
    (state) => state.phase === "review" || !!state.policy,
  );
  if (run.phase === "review" && !run.command) {
    assert.ok(run.extraction);
    assert.deepEqual(run.extraction.clarifications, []);
    assert.deepEqual(run.extraction.unsupportedRequirements, []);
    await post(
      "/api/demo",
      { action: "confirm", revision: run.revision, extraction: run.extraction },
      cookie,
    );
  }
  run = await wait(
    "Policy proposal",
    (state) =>
      state.phase === "proposal" ||
      ["preparing", "approval", "contributing", "completed"].includes(
        state.phase,
      ),
  );
  assert.equal(run.evaluation?.status, "PROPOSAL_READY");
  assert.ok(run.policy && run.policyHash);
  const policy = policySchema.parse(run.policy);
  assert.equal(hashPolicy(policy), run.policyHash);
  assert.equal(
    policy.participants[0]!.toLowerCase(),
    judge.address.toLowerCase(),
  );
  assert.equal(
    new Set(policy.participants.map((address) => address.toLowerCase())).size,
    6,
  );
  console.log(
    `Policy ${policy.decisionId} selects ${run.restaurant}; judge is participant 1 of 6.`,
  );
  if (run.phase === "proposal" && !run.command)
    await post("/api/demo", { action: "prepare" }, cookie);
  run = await wait("Test funds and on-chain policy", (state) =>
    ["approval", "contributing", "completed"].includes(state.phase),
  );
  const tokenBalance = (await client.readContract({
    address: policy.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [judge.address],
  })) as bigint;
  assert.ok(tokenBalance >= 10_000_000n);
  const judgeEth = await client.getBalance({ address: judge.address });
  assert.ok(judgeEth > 0n);
  console.log(
    "Judge received 10 MockUSDC and Sepolia gas; policy exists on-chain.",
  );
  const ownContribution = async () =>
    client.readContract({
      address: policy.verifyingContract,
      abi: walletAbi,
      functionName: "contributionOf",
      args: [policy.decisionId, judge.address],
    }) as Promise<bigint>;
  const journalPath = join(store.root, "private", "judge-transactions.json");
  type JudgeJournal = Record<
    string,
    { serialized: Hex; hash: Hex; confirmed: boolean }
  >;
  const journal = (await optionalJson<JudgeJournal>(journalPath)) || {};
  async function judgeTx(
    name: string,
    to: Address,
    abi: Abi,
    functionName: string,
    args: unknown[],
  ) {
    const data = encodeFunctionData({ abi, functionName, args });
    let entry = journal[name];
    if (!entry) {
      const request = await wallet.prepareTransactionRequest({
        account: judge,
        to,
        data,
      });
      const serialized = await wallet.signTransaction(request);
      entry = { serialized, hash: keccak256(serialized), confirmed: false };
      journal[name] = entry;
      await atomicJson(journalPath, journal);
    }
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: entry.hash });
    } catch {
      try {
        await client.sendRawTransaction({
          serializedTransaction: entry.serialized,
        });
      } catch {
        /* A broadcast can already be pending after a transport timeout. */
      }
      receipt = await client.waitForTransactionReceipt({
        hash: entry.hash,
        timeout: 120000,
      });
    }
    if (receipt.status !== "success") throw new Error(`Judge ${name} reverted`);
    const finalized = await client.waitForTransactionReceipt({
      hash: entry.hash,
      confirmations: 2,
      timeout: 120000,
    });
    assert.equal(
      finalized.blockHash,
      (await client.getBlock({ blockNumber: finalized.blockNumber })).hash,
    );
    entry.confirmed = true;
    await atomicJson(journalPath, journal);
    console.log(`Judge ${name}: ${entry.hash}`);
  }
  if ((await ownContribution()) === 0n) {
    const allowance = (await client.readContract({
      address: policy.token,
      abi: tokenAbi,
      functionName: "allowance",
      args: [judge.address, policy.verifyingContract],
    })) as bigint;
    if (allowance < 10_000_000n)
      await judgeTx("allowance", policy.token, tokenAbi, "approve", [
        policy.verifyingContract,
        10_000_000n,
      ]);
    await judgeTx(
      "contribution",
      policy.verifyingContract,
      walletAbi,
      "approveAndContribute",
      [policy.decisionId, run.policyHash],
    );
  }
  run = await wait(
    "Five automated contributions and payment",
    (state) => state.phase === "completed",
  );
  assert.equal(run.approvals, 6);
  assert.equal(run.rejection?.reason, "MaxDepositExceeded");
  assert.ok(
    run.transactions.some(
      (transaction) =>
        transaction.label === "Reservation payment" && transaction.confirmed,
    ),
  );
  if (!run.refunded)
    await judgeTx(
      "refund",
      policy.verifyingContract,
      walletAbi,
      "claimRefund",
      [policy.decisionId],
    );
  run = await wait(
    "Judge refund",
    (state) =>
      state.refunded &&
      state.transactions.some(
        (transaction) => transaction.label === "Your refund",
      ),
  );
  const decision = (await client.readContract({
    address: policy.verifyingContract,
    abi: walletAbi,
    functionName: "getDecision",
    args: [policy.decisionId],
  })) as [Hex, number, bigint, bigint, bigint, bigint];
  assert.equal(decision[0], run.policyHash);
  assert.equal(decision[1], 2);
  assert.equal(decision[2], 6n);
  assert.equal(decision[4], BigInt(policy.paymentAmount));
  assert.equal(await ownContribution(), 10_000_000n);
  const publicEvidence = {
    schemaVersion: 1,
    scope: "wallet-connected-explore-live-rehearsal",
    network: "ethereum-sepolia",
    chainId: sepolia.id,
    runId,
    judge: judge.address,
    automatedParticipants: policy.participants.slice(1),
    policy,
    policyHash: run.policyHash,
    restaurant: run.restaurant,
    evaluation: run.evaluation,
    rejection: run.rejection,
    transactions: [
      ...Object.entries(journal).map(([label, entry]) => ({
        label: `Judge ${label}`,
        hash: entry.hash,
        confirmed: entry.confirmed,
      })),
      ...run.transactions,
    ],
    approvalCount: Number(decision[2]),
    spent: String(decision[4]),
    refunded: run.refunded,
    extractedFromLiveKiln: true,
    automatedPreferences: "synthetic",
    judgeSigner: "single-operator-rehearsal",
    recordedAt: new Date().toISOString(),
  };
  await writeFile(
    join("docs", "evidence", `explore-live-${runId.slice(0, 12)}.json`),
    JSON.stringify(publicEvidence, null, 2) + "\n",
  );
  console.log(
    `Live Sepolia Explore rehearsal completed. Evidence: docs/evidence/explore-live-${runId.slice(0, 12)}.json`,
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Rehearsal failed");
  process.exitCode = 1;
});
