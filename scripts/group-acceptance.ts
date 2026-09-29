import assert from "node:assert/strict";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import {
  BaseError,
  ContractFunctionRevertedError,
  TransactionReceiptNotFoundError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  keccak256,
  parseEther,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import { sepolia } from "viem/chains";
import deployment from "../contracts/deployments/11155111.json";
import roles from "../contracts/deployments/demo-roles.11155111.json";
import participantsManifest from "../contracts/deployments/demo-participants.11155111.json";
import tokenJson from "../src/lib/abi/mockUSDC.json";
import walletJson from "../src/lib/abi/convergeGroupWallet.json";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import {
  GroupExecutionRepository,
  type ExecutionPolicy,
} from "../src/lib/db/group-execution.js";
import { groupPolicyConfig } from "../src/lib/server/group-config.js";
import {
  groupChainTransaction,
  readGroupChain,
  type GroupChainAction,
} from "../src/lib/group-chain.js";
import type { GroupOverview } from "../src/lib/group-view.js";
import type { PreferenceState } from "../src/lib/preferences.js";
import { hashPolicy } from "../src/lib/policy.js";
import {
  atomicJson,
  optionalJson,
  withFileLock,
  demoDirectory,
} from "../src/lib/explore/store.js";
import {
  executeJournaled,
  assertMatchingIntent,
  type JournalTransaction,
} from "./lib/transaction-journal.js";
import { GroupExecutionWorker } from "./lib/group-execution-worker.js";

const runId = process.argv[2] || "group-acceptance-001";
const mode = process.argv[3] || "--run";
if (
  !/^[a-z0-9][a-z0-9-]{0,47}$/.test(runId) ||
  !["--prepare", "--run", "--verify"].includes(mode)
)
  throw new Error("Use a run ID and --prepare, --run, or --verify");
const origin = process.env.ACCEPTANCE_ORIGIN || "http://localhost:3010";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Local acceptance server required");
if (process.env.NEON_BRANCH !== "dev-preferences")
  throw new Error("Isolated dev-preferences database required");
const root = join(demoDirectory(), "private", runId);
const walletAbi = walletJson as Abi,
  tokenAbi = tokenJson as Abi;
const scenarios = [
  {
    id: "baseline",
    budget: 3500,
    permitted: ["A", "B", "C", "D", "E"],
    winner: "A",
    amount: "45000000",
    refund: "2500000",
    rejection: 8,
    rejectionName: "MAX_DEPOSIT_EXCEEDED",
  },
  {
    id: "lower-budget",
    budget: 2500,
    permitted: ["A", "B", "C", "D", "E"],
    winner: "B",
    amount: "36000000",
    refund: "4000000",
    rejection: 8,
    rejectionName: "MAX_DEPOSIT_EXCEEDED",
  },
  {
    id: "merchant-excluded",
    budget: 3500,
    permitted: ["B", "C", "D", "E"],
    winner: "B",
    amount: "36000000",
    refund: "4000000",
    rejection: 6,
    rejectionName: "MERCHANT_NOT_ALLOWED",
  },
] as const;
type Scenario = (typeof scenarios)[number];
type State = {
  runId: string;
  createdAt: string;
  wallets: Address[];
  outsiderKey: Hex;
  groups: Record<string, string>;
  checks: Record<string, string[]>;
  recovery: Record<string, unknown>;
};
type PublicReceipt = {
  label: string;
  hash: Hex;
  status: string;
  blockNumber: string;
  blockHash: Hex;
  from: Address;
  to: Address | null;
  gasUsed: string;
  events: { name: string; args: unknown; logIndex: number }[];
};

async function main() {
  for (const name of [
    "DATABASE_URL_UNPOOLED",
    "RPC_URL",
    "KILN_API_KEY",
    "AGENT_EXECUTOR_PRIVATE_KEY",
    "DEPLOYER_PRIVATE_KEY",
  ])
    if (!process.env[name]) throw new Error(`Missing ${name}`);
  await mkdir(root, { recursive: true });
  const people = Array.from({ length: 6 }, (_, i) =>
    privateKeyToAccount(
      process.env[`DEMO_PARTICIPANT_${i + 1}_PRIVATE_KEY`] as Hex,
    ),
  );
  const executor = privateKeyToAccount(
    process.env.AGENT_EXECUTOR_PRIVATE_KEY as Hex,
  );
  const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  assert.deepEqual(
    people.map((p) => p.address.toLowerCase()),
    participantsManifest.participants.map((p) => p.address.toLowerCase()),
  );
  assert.equal(executor.address.toLowerCase(), roles.executor.toLowerCase());
  assert.equal(
    deployer.address.toLowerCase(),
    deployment.deployer.toLowerCase(),
  );
  assert.equal(
    new Set([
      ...people.map((p) => p.address),
      executor.address,
      deployer.address,
    ]).size,
    8,
  );
  const statePath = join(root, "state.json");
  const state: State = (await optionalJson<State>(statePath)) || {
    runId,
    createdAt: new Date().toISOString(),
    wallets: people.map((p) => p.address),
    outsiderKey: generatePrivateKey(),
    groups: {},
    checks: {},
    recovery: {},
  };
  assert.equal(state.runId, runId);
  assert.deepEqual(
    state.wallets,
    people.map((p) => p.address),
  );
  const save = () => atomicJson(statePath, state);
  await save();
  const transport = http(process.env.RPC_URL, {
    timeout: 20000,
    retryCount: 2,
  });
  const client = createPublicClient({ chain: sepolia, transport });
  assert.equal(await client.getChainId(), 11155111);
  assert.equal(
    (await client.getBlock({ blockNumber: 0n })).hash,
    "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9",
  );
  for (const contract of [deployment.mockUSDC, deployment.convergeGroupWallet])
    assert.equal(
      keccak256(
        (await client.getBytecode({ address: contract.address as Address }))!,
      ),
      contract.deployedCodeHash,
    );
  const pool = new Pool({
    connectionString: verifiedPostgresUrl(process.env.DATABASE_URL_UNPOOLED!),
    max: 4,
    connectionTimeoutMillis: 15000,
  });
  const repo = new GroupExecutionRepository(pool);
  const cookies: string[] = [];
  async function request(
    path: string,
    cookie?: string,
    body?: unknown,
    requestOrigin = origin,
  ) {
    return fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: requestOrigin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120000),
    });
  }
  async function json<T>(
    path: string,
    cookie?: string,
    body?: unknown,
  ): Promise<T> {
    const response = await request(path, cookie, body);
    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(
        `${path}: HTTP ${response.status} ${error.error || "REQUEST_FAILED"}`,
      );
    }
    return response.json() as Promise<T>;
  }
  async function login(account: PrivateKeyAccount) {
    const challenge = await json<{ challengeId: string; message: string }>(
      "/api/auth/challenge",
      undefined,
      { address: account.address },
    );
    const body = {
      challengeId: challenge.challengeId,
      signature: await account.signMessage({ message: challenge.message }),
    };
    const response = await request("/api/auth/verify", undefined, body);
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    assert.notEqual(
      (await request("/api/auth/verify", undefined, body)).status,
      200,
      "SIWE replay must fail",
    );
    return cookie;
  }
  const overview = (id: string, index = 0) =>
    json<GroupOverview>(`/api/groups/${id}/overview`, cookies[index]);
  async function prepare(scenario: Scenario) {
    let id = state.groups[scenario.id];
    if (!id) {
      const created = await json<{ groupId: string }>(
        "/api/groups",
        cookies[0],
        {
          name: `Acceptance ${runId} ${scenario.id}`,
          displayName: "Synthetic Alice",
          slot: {
            startsAt: new Date(Date.now() + 172800000)
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z"),
            timeZone: "Asia/Seoul",
          },
          permittedRestaurantIds: [...scenario.permitted],
        },
      );
      id = created.groupId;
      state.groups[scenario.id] = id;
      await save();
    }
    const path = `/api/groups/${id}`;
    let view = await overview(id);
    assert.deepEqual(view.group.permittedRestaurantIds, [
      ...scenario.permitted,
    ]);
    if (state.checks[scenario.id]?.length === 12 && view.signingPolicy) {
      assert.equal(view.evaluation?.winnerId, scenario.winner);
      assert.equal(view.signingPolicy.policy.paymentAmount, scenario.amount);
      console.log(
        `${scenario.id}: resuming the previously verified group and immutable policy`,
      );
      return;
    }
    for (let i = 1; i < 6; i++)
      if (
        !view.participants.some(
          (p) =>
            p.walletAddress.toLowerCase() === people[i]!.address.toLowerCase(),
        )
      ) {
        const invite = await json<{ token: string; inviteToken?: string }>(
          `${path}/invite`,
          cookies[0],
          {},
        );
        await json(`${path}/join`, cookies[i], {
          inviteToken: invite.inviteToken ?? invite.token,
          displayName: `Synthetic participant ${i + 1}`,
        });
        view = await overview(id);
      }
    assert.equal(view.participants.length, 6);
    for (let i = 0; i < 6; i++) {
      let { preference } = await json<{ preference: PreferenceState | null }>(
        `${path}/preferences`,
        cookies[i],
      );
      if (!preference || preference.status === "PARSE_FAILED") {
        const budget = i === 0 ? scenario.budget / 100 : 35;
        const text = `My maximum meal budget is ${budget} USD per person, inclusive. I prefer a quiet restaurant. I have no other requirements.`;
        ({ preference } = await json<{ preference: PreferenceState }>(
          `${path}/preferences`,
          cookies[i],
          { text, expectedRevisionId: preference?.revisionId ?? null },
        ));
      }
      assert.ok(preference?.extraction);
      assert.deepEqual(preference.extraction.clarifications, []);
      assert.deepEqual(preference.extraction.unsupportedRequirements, []);
      assert.ok(
        preference.extraction.constraints.some(
          (c) =>
            c.field === "budget_per_person_cents" &&
            c.value === (i === 0 ? scenario.budget : 3500),
        ),
        "Live extraction must reflect the submitted budget",
      );
      if (preference.status !== "CONFIRMED") {
        assert.equal(preference.status, "AWAITING_CONFIRMATION");
        await json(`${path}/confirm`, cookies[i], {
          revisionId: preference.revisionId,
        });
      }
      const own = await json<{ preference: PreferenceState }>(
        `${path}/preferences?walletAddress=${people[(i + 1) % 6]!.address}`,
        cookies[i],
      );
      assert.equal(
        own.preference.participant.toLowerCase(),
        people[i]!.address.toLowerCase(),
      );
      console.log(
        `${scenario.id}: participant ${i + 1} live extraction confirmed in its own session`,
      );
    }
    const outsider = cookies[6]!;
    for (const endpoint of [
      `${path}/overview`,
      `${path}/preferences`,
      `${path}/chain`,
      `${path}/history`,
      `/api/insights/${id}`,
    ]) {
      assert.equal((await request(endpoint)).status, 401);
      assert.notEqual((await request(endpoint, outsider)).status, 200);
    }
    assert.equal(
      (
        await request(
          `${path}/evaluate`,
          cookies[0],
          {},
          "https://invalid.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(`${path}/evaluate`, cookies[0], {
          permittedRestaurantIds: ["A"],
        })
      ).status,
      400,
    );
    assert.notEqual(
      (await request(`${path}/invite`, cookies[1], {})).status,
      201,
    );
    const otherRevision = (
      await json<{ preference: PreferenceState }>(
        `${path}/preferences`,
        cookies[1],
      )
    ).preference.revisionId;
    assert.notEqual(
      (
        await request(`${path}/confirm`, cookies[0], {
          revisionId: otherRevision,
        })
      ).status,
      200,
    );
    view = await json<GroupOverview>(`${path}/evaluate`, cookies[0], {});
    assert.equal(view.evaluation?.winnerId, scenario.winner);
    assert.equal(view.group.locked, true);
    const shared = JSON.stringify(view);
    assert.doesNotMatch(
      shared,
      /rawText|confirmedRevisionId|unsupportedRequirements|budget_per_person_cents/,
    );
    const insights = await json<{
      explanation: { source: string; text: string };
      usage: {
        flow: string;
        attempts: number;
        successfulAttempts: number;
        inputTokens: number | null;
      }[];
      cacheHit: boolean;
    }>(`/api/insights/${id}`, cookies[0], {});
    assert.equal(
      insights.explanation.source,
      "kiln",
      "Acceptance requires a live Kiln explanation",
    );
    assert.ok(
      insights.usage.find((flow) => flow.flow === "constraint_extraction")!
        .successfulAttempts >= 6,
    );
    assert.ok(
      insights.usage.find((flow) => flow.flow === "decision_explanation")!
        .successfulAttempts >= 1,
    );
    const cached = await json<typeof insights>(
      `/api/insights/${id}`,
      cookies[1],
      {},
    );
    assert.equal(cached.cacheHit, true);
    assert.equal(cached.explanation.text, insights.explanation.text);
    assert.deepEqual(
      cached.usage.map((f) => f.attempts),
      insights.usage.map((f) => f.attempts),
    );
    view = await json<GroupOverview>(`${path}/decisions`, cookies[0], {});
    assert.ok(view.signingPolicy);
    assert.equal(view.signingPolicy.policy.paymentAmount, scenario.amount);
    assert.equal(
      hashPolicy(view.signingPolicy.policy),
      view.signingPolicy.policyHash,
    );
    for (let i = 0; i < 6; i++)
      assert.equal(
        (await overview(id, i)).signingPolicy?.policyHash,
        view.signingPolicy.policyHash,
      );
    assert.equal(
      (await json<GroupOverview>(`${path}/decisions`, cookies[2], {}))
        .signingPolicy?.policyHash,
      view.signingPolicy.policyHash,
    );
    assert.notEqual(
      (
        await request(`${path}/preferences`, cookies[0], {
          text: "Changed input",
          expectedRevisionId: otherRevision,
        })
      ).status,
      201,
    );
    state.checks[scenario.id] = [
      "six separate wallet signatures and cookie sessions",
      "SIWE challenge replay rejected",
      "unauthenticated and outsider reads rejected",
      "actor spoofing query returns only own preference",
      "cross-participant confirmation rejected",
      "non-creator invite rejected",
      "foreign Origin rejected",
      "client merchant override rejected",
      "shared view omits private constraints",
      "all six clients see the same policy hash",
      "frozen input mutation rejected",
      "explanation cache avoids another provider call",
    ];
    await save();
    console.log(
      `${scenario.id}: ${scenario.winner} selected; six confirmations, policy and explanation verified`,
    );
  }

  async function receiptRecord(
    label: string,
    receipt: TransactionReceipt,
  ): Promise<PublicReceipt> {
    assert.equal(receipt.status, "success", `${label} reverted`);
    assert.equal(
      (await client.getBlock({ blockNumber: receipt.blockNumber })).hash,
      receipt.blockHash,
    );
    return {
      label,
      hash: receipt.transactionHash,
      status: receipt.status,
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash,
      from: receipt.from,
      to: receipt.to,
      gasUsed: String(receipt.gasUsed),
      events: receipt.logs.flatMap((log) => {
        const abi =
          log.address.toLowerCase() === groupPolicyConfig.token.toLowerCase()
            ? tokenAbi
            : log.address.toLowerCase() ===
                groupPolicyConfig.verifyingContract.toLowerCase()
              ? walletAbi
              : null;
        if (!abi) return [];
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        });
        return [
          {
            name: decoded.eventName!,
            args: decoded.args,
            logIndex: log.logIndex,
          },
        ];
      }),
    };
  }
  async function send(
    label: string,
    account: PrivateKeyAccount,
    to: Address,
    data: Hex,
    value = 0n,
  ) {
    const file = join(root, `${label}.tx.json`);
    const wallet = createWalletClient({ account, chain: sepolia, transport });
    const intent = {
      chainId: 11155111,
      from: account.address,
      to,
      data,
      valueWei: String(value),
    };
    const result = await executeJournaled({
      intent,
      load: () => optionalJson<JournalTransaction>(file),
      prepare: async () => {
        const request = await wallet.prepareTransactionRequest({
          account,
          to,
          data,
          value,
        });
        assert.ok(request.gas !== undefined);
        request.gas += request.gas / 4n;
        assert.ok(
          request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n) +
            value <=
            parseEther("0.01"),
          "Per-transaction rehearsal cost cap",
        );
        return wallet.signTransaction(request);
      },
      save: (entry) => atomicJson(file, entry),
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
        client.waitForTransactionReceipt({
          hash,
          confirmations: 2,
          timeout: 240000,
          pollingInterval: 4000,
        }),
    });
    const receipt = await client.waitForTransactionReceipt({
      hash: result.transaction.hash,
      confirmations: 2,
      timeout: 240000,
      pollingInterval: 4000,
    });
    const actual = await client.getTransaction({
      hash: receipt.transactionHash,
    });
    assertMatchingIntent(
      {
        chainId: actual.chainId!,
        from: actual.from,
        to: actual.to,
        data: actual.input,
        valueWei: String(actual.value),
      },
      intent,
    );
    const record = await receiptRecord(label, receipt);
    await atomicJson(join(root, `${label}.receipt.json`), record);
    console.log(`${label}: ${receipt.transactionHash}`);
    return receipt;
  }
  async function fund() {
    for (const [i, person] of [...people, executor].entries()) {
      const target = parseEther(
        i === 0 ? "0.004" : i === 6 ? "0.001" : "0.002",
      );
      const balance = await client.getBalance({ address: person.address });
      const label = `fund-eth-${i}`;
      const existing = await optionalJson<JournalTransaction>(
        join(root, `${label}.tx.json`),
      );
      if (existing || balance < target)
        await send(
          label,
          deployer,
          person.address,
          "0x",
          existing ? BigInt(existing.intent.valueWei) : target - balance,
        );
      if (i < 6) {
        const amount = (await client.readContract({
          address: groupPolicyConfig.token,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [person.address],
        })) as bigint;
        const mintLabel = `fund-token-${i}`;
        const mint = await optionalJson<JournalTransaction>(
          join(root, `${mintLabel}.tx.json`),
        );
        if (mint || amount < 30000000n)
          await send(
            mintLabel,
            deployer,
            groupPolicyConfig.token,
            mint?.intent.data ??
              encodeFunctionData({
                abi: tokenAbi,
                functionName: "mint",
                args: [person.address, 30000000n - amount],
              }),
          );
      }
    }
  }
  async function policy(scenario: Scenario): Promise<ExecutionPolicy> {
    const groupId = state.groups[scenario.id]!;
    const saved = (await overview(groupId)).signingPolicy;
    assert.ok(saved);
    return { ...saved, groupId };
  }
  async function action(
    scenario: Scenario,
    saved: ExecutionPolicy,
    index: number,
    kind: GroupChainAction,
  ) {
    const label = `${scenario.id}-${kind}-${index}`;
    const existing = await optionalJson<JournalTransaction>(
      join(root, `${label}.tx.json`),
    );
    const person = people[index]!;
    if (existing)
      return send(label, person, existing.intent.to!, existing.intent.data);
    const chain = await readGroupChain(
      client,
      saved,
      groupPolicyConfig,
      person.address,
      1,
    );
    if (
      kind === "allowance" &&
      chain.members.some(
        (member) =>
          member.address.toLowerCase() === person.address.toLowerCase() &&
          BigInt(member.contribution) > 0n,
      )
    )
      return;
    if (kind === "allowance" && BigInt(chain.allowance) >= 10000000n) return;
    const intent = groupChainTransaction(
      saved,
      groupPolicyConfig,
      person.address,
      chain,
      kind,
    );
    return send(label, person, intent.to, intent.data);
  }
  async function rejection(scenario: Scenario, saved: ExecutionPolicy) {
    const path = join(root, `${scenario.id}-rejection.json`);
    if (await optionalJson(path)) return;
    const block = await client.getBlock();
    const merchant =
      scenario.id === "merchant-excluded"
        ? (roles.merchants.A as Address)
        : saved.policy.merchant;
    const amount =
      scenario.id === "merchant-excluded"
        ? BigInt(saved.policy.paymentAmount)
        : 80000000n;
    const result = (await client.readContract({
      address: saved.policy.verifyingContract,
      abi: walletAbi,
      functionName: "validatePayment",
      args: [saved.policy.decisionId, executor.address, merchant, amount],
      blockNumber: block.number,
    })) as [boolean, number];
    assert.deepEqual(result, [false, scenario.rejection]);
    await assert.rejects(
      client.simulateContract({
        account: executor,
        address: saved.policy.verifyingContract,
        abi: walletAbi,
        functionName: "executePayment",
        args: [saved.policy.decisionId, merchant, amount],
        blockNumber: block.number,
      }),
      (error: unknown) => {
        const reverted =
          error instanceof BaseError
            ? error.walk((e) => e instanceof ContractFunctionRevertedError)
            : null;
        return (
          reverted instanceof ContractFunctionRevertedError &&
          reverted.data?.errorName === "PaymentNotAllowed" &&
          Number(reverted.data.args?.[0]) === scenario.rejection
        );
      },
    );
    await atomicJson(path, {
      kind: "eth_call_simulation",
      transactionSubmitted: false,
      decisionId: saved.policy.decisionId,
      policyHash: saved.policyHash,
      merchant,
      amount: String(amount),
      reason: scenario.rejectionName,
      reasonCode: scenario.rejection,
      blockNumber: String(block.number),
      blockHash: block.hash,
      validationAndEnforcingFunctionAgree: true,
    });
  }
  async function chainRun(scenario: Scenario) {
    const saved = await policy(scenario);
    const registration = await action(scenario, saved, 0, "register");
    assert.ok(registration);
    const worker = () =>
      new GroupExecutionWorker(
        client,
        transport,
        executor,
        groupPolicyConfig,
        repo,
        registration.blockNumber,
        parseEther("0.03"),
      );
    let current = await readGroupChain(
      client,
      saved,
      groupPolicyConfig,
      people[0]!.address,
    );
    if (current.status !== 2) {
      await Promise.all(
        people.map((_, i) => action(scenario, saved, i, "allowance")),
      );
      await Promise.all(
        people
          .slice(0, 5)
          .map((_, i) => action(scenario, saved, i, "contribute")),
      );
      current = await readGroupChain(
        client,
        saved,
        groupPolicyConfig,
        people[0]!.address,
      );
      if (current.approvals === 5) {
        await worker().tick(saved);
        assert.equal(await repo.load(saved.policy.decisionId), undefined);
      }
      await action(scenario, saved, 5, "contribute");
      await rejection(scenario, saved);
      const prior = await repo.load(saved.policy.decisionId);
      if (!prior && scenario.id === "baseline") {
        const interruptedClient = {
          ...client,
          sendRawTransaction: async (
            ...args: Parameters<typeof client.sendRawTransaction>
          ) => {
            await client.sendRawTransaction(...args);
            throw new Error("INJECTED_LOST_BROADCAST_RESPONSE");
          },
        };
        const interrupted = new GroupExecutionWorker(
          interruptedClient,
          transport,
          executor,
          groupPolicyConfig,
          repo,
          registration.blockNumber,
          parseEther("0.03"),
        );
        await assert.rejects(
          interrupted.tick(saved),
          /INJECTED_LOST_BROADCAST_RESPONSE/,
        );
        const journal = await repo.load(saved.policy.decisionId);
        assert.ok(journal);
        state.recovery[scenario.id] = {
          fault:
            "live broadcast succeeded; client response deliberately discarded",
          originalHash: journal.hash,
        };
        await save();
      }
      if (scenario.id === "lower-budget" && !state.recovery[scenario.id]) {
        let failed = false;
        const store = new Proxy(repo, {
          get(target, key) {
            if (key === "status")
              return async (...args: Parameters<typeof repo.status>) => {
                if (args[1] === "confirmed" && !failed) {
                  failed = true;
                  throw new Error("INJECTED_DB_CONFIRMATION_FAILURE");
                }
                return target.status(...args);
              };
            const value: unknown = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const interrupted = new GroupExecutionWorker(
          client,
          transport,
          executor,
          groupPolicyConfig,
          store,
          registration.blockNumber,
          parseEther("0.03"),
        );
        const faultDeadline = Date.now() + 240000;
        while (!failed) {
          try {
            await interrupted.tick(saved);
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.message !== "INJECTED_DB_CONFIRMATION_FAILURE"
            )
              throw error;
          }
          if (Date.now() > faultDeadline)
            throw new Error("Waiting for payment before DB recovery check");
          if (!failed) await sleep(4000);
        }
        const original = await repo.load(saved.policy.decisionId);
        assert.ok(original);
        state.recovery[scenario.id] = {
          fault:
            "successful on-chain payment followed by deliberately failed database confirmation write",
          originalHash: original.hash,
        };
        await save();
      }
      const deadline = Date.now() + 240000;
      do {
        await worker().tick(saved);
        const history = await repo.history(saved.groupId, people[0]!.address);
        if (history.execution?.status === "confirmed") break;
        if (Date.now() > deadline)
          throw new Error("Payment pending; rerun the same run ID");
        await sleep(4000);
      } while (true);
    }
    const journal = await repo.load(saved.policy.decisionId);
    assert.ok(journal);
    await atomicJson(
      join(root, `${scenario.id}-payment.receipt.json`),
      await receiptRecord(
        `${scenario.id}-payment`,
        await client.getTransactionReceipt({ hash: journal.hash }),
      ),
    );
    await Promise.all(
      people.map((_, i) => action(scenario, saved, i, "refund")),
    );
    await worker().tick(saved);
    await worker().tick(saved);
    const history = await repo.history(saved.groupId, people[0]!.address);
    assert.equal(
      history.events.filter((event) => event.kind === "PaymentExecuted").length,
      1,
    );
    for (const person of people) {
      const refunds = history.events.filter(
        (event) =>
          event.kind === "RefundClaimed" &&
          event.participant?.toLowerCase() === person.address.toLowerCase(),
      );
      const contributions = history.events.filter(
        (event) =>
          event.kind === "ParticipantApproved" &&
          event.participant?.toLowerCase() === person.address.toLowerCase(),
      );
      assert.equal(refunds.length, 1);
      assert.equal(refunds[0]!.amount, scenario.refund);
      assert.equal(contributions.length, 1);
      assert.equal(contributions[0]!.amount, "10000000");
    }
    assert.equal(
      history.events.filter((event) => event.kind === "RefundClaimed").length,
      6,
    );
    assert.equal(
      history.snapshot?.state.refunded,
      String(BigInt(scenario.refund) * 6n),
    );
    const apiHistory = await json<typeof history>(
      `/api/groups/${saved.groupId}/history`,
      cookies[0],
    );
    assert.deepEqual(apiHistory.events, history.events);
    assert.doesNotMatch(
      JSON.stringify(apiHistory),
      /serialized|journal|privateKey/,
    );
    if (state.recovery[scenario.id]) {
      const recovery = state.recovery[scenario.id] as { originalHash: string };
      assert.equal(recovery.originalHash, journal.hash);
      state.recovery[scenario.id] = {
        ...recovery,
        resumedHash: journal.hash,
        paymentEventCount: 1,
        refundEventCount: 6,
        duplicateEventsAfterReplay: 0,
        recovered: true,
      };
      await save();
    }
    console.log(
      `${scenario.id}: paid ${scenario.amount}, six refunds of ${scenario.refund}, persistent history verified`,
    );
    await exportScenario(scenario, false);
  }
  async function exportScenario(scenario: Scenario, requireFinalized: boolean) {
    const saved = await policy(scenario);
    const history = await repo.history(saved.groupId, people[0]!.address);
    assert.equal(history.execution?.status, "confirmed");
    const files = (await readdir(root)).filter(
      (file) =>
        file.startsWith(`${scenario.id}-`) && file.endsWith(".receipt.json"),
    );
    const receipts: PublicReceipt[] = [];
    for (const file of files) {
      const previous = JSON.parse(
        await readFile(join(root, file), "utf8"),
      ) as PublicReceipt;
      const receipt = await client.getTransactionReceipt({
        hash: previous.hash,
      });
      receipts.push(await receiptRecord(previous.label, receipt));
    }
    const latest = receipts.reduce(
      (max, receipt) =>
        BigInt(receipt.blockNumber) > max ? BigInt(receipt.blockNumber) : max,
      0n,
    );
    const finalized = await client.getBlock({ blockTag: "finalized" });
    if (requireFinalized)
      assert.ok(
        finalized.number >= latest,
        `Finality pending for ${scenario.id}`,
      );
    const last = await readGroupChain(
      client,
      saved,
      groupPolicyConfig,
      people[0]!.address,
    );
    assert.equal(last.status, 2);
    assert.equal(last.spent, scenario.amount);
    assert.equal(last.refunded, String(BigInt(scenario.refund) * 6n));
    const usage = await json(`/api/insights/${saved.groupId}`, cookies[0]);
    const attempts = await pool.query(
      `SELECT revision_id, usage, http_status, error_code, cost_usd, cached_input_tokens, reasoning_tokens FROM converge_kiln_attempts WHERE group_id=$1 ORDER BY created_at`,
      [saved.groupId],
    );
    const explanationAttempts = await pool.query(
      `SELECT evaluation_id, usage, http_status, error_code, cost_usd, cached_input_tokens, reasoning_tokens FROM converge_kiln_evaluation_attempts WHERE group_id=$1 ORDER BY created_at`,
      [saved.groupId],
    );
    const inputs = await Promise.all(
      people.map(
        async (_, i) =>
          (
            await json<{ preference: PreferenceState }>(
              `/api/groups/${saved.groupId}/preferences`,
              cookies[i],
            )
          ).preference,
      ),
    );
    const rejected = await optionalJson<{
      blockNumber: string;
      blockHash: Hex;
      reasonCode: number;
      merchant: Address;
      amount: string;
    }>(join(root, `${scenario.id}-rejection.json`));
    assert.ok(rejected);
    assert.equal(
      (await client.getBlock({ blockNumber: BigInt(rejected.blockNumber) }))
        .hash,
      rejected.blockHash,
    );
    assert.deepEqual(
      await client.readContract({
        address: saved.policy.verifyingContract,
        abi: walletAbi,
        functionName: "validatePayment",
        args: [
          saved.policy.decisionId,
          executor.address,
          rejected.merchant,
          BigInt(rejected.amount),
        ],
        blockNumber: BigInt(rejected.blockNumber),
      }),
      [false, rejected.reasonCode],
    );
    const migrations = (
      await pool.query(
        "SELECT name,sha256,applied_at FROM converge_schema_migrations ORDER BY name",
      )
    ).rows;
    await atomicJson(`docs/evidence/${runId}-${scenario.id}.json`, {
      schemaVersion: 1,
      scope: "ordinary-group-live-http-acceptance",
      runId,
      scenario: scenario.id,
      status:
        finalized.number >= latest
          ? "finalized"
          : "confirmed-awaiting-finality",
      checkedAt: new Date().toISOString(),
      chainId: 11155111,
      model: "qwen3-32b",
      fixtureVersion: "restaurants-v2",
      syntheticInputs: true,
      participantControl:
        "six distinct private keys and isolated SIWE cookie sessions operated by one test runner; not six independent humans",
      groupId: saved.groupId,
      changedConditions: {
        aliceBudgetCents: scenario.budget,
        permittedRestaurantIds: scenario.permitted,
      },
      inputs,
      evaluation: (await overview(saved.groupId)).evaluation,
      policy: saved.policy,
      policyHash: saved.policyHash,
      rejection: rejected,
      receipts,
      usage,
      extractionAttempts: attempts.rows,
      explanationAttempts: explanationAttempts.rows,
      history,
      accessChecks: state.checks[scenario.id],
      recovery: state.recovery[scenario.id] ?? null,
      migrations,
      finality: {
        requiredThroughBlock: String(latest),
        finalizedBlock: String(finalized.number),
        finalizedBlockHash: finalized.hash,
        allReceiptsFinalized: finalized.number >= latest,
      },
      platform: {
        os: process.platform,
        architecture: process.arch,
        node: process.version,
      },
    });
  }
  try {
    for (const person of [...people, privateKeyToAccount(state.outsiderKey)])
      cookies.push(await login(person));
    if (mode !== "--verify")
      for (const scenario of scenarios) await prepare(scenario);
    if (mode === "--prepare") return;
    if (mode === "--run")
      await withFileLock(join(demoDirectory(), "worker.lock"), async () => {
        const lock = await pool.connect();
        try {
          assert.equal(
            (
              await lock.query(
                "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
                [`converge:executor:${executor.address.toLowerCase()}`],
              )
            ).rows[0].locked,
            true,
          );
          await fund();
          for (const scenario of scenarios) {
            await lock.query("SELECT 1");
            await chainRun(scenario);
          }
        } finally {
          await lock.query("SELECT pg_advisory_unlock_all()").catch(() => {});
          lock.release();
        }
      });
    if (mode === "--verify")
      for (const scenario of scenarios) await exportScenario(scenario, true);
    console.log(
      `${runId}: ${mode === "--verify" ? "finalized read-only verification passed" : "all three lifecycles completed; run --verify after finality"}`,
    );
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  // Do not print nested RPC, database, cookie, or signer details.
  console.error(
    error instanceof Error && !(error instanceof BaseError)
      ? `${error.name}: ${error.message.slice(0, 350)}`
      : "Acceptance stopped at an external request. Preserve the journal and resume the same run ID.",
  );
  process.exitCode = 1;
});
