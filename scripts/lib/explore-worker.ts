import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseEther,
  stringToHex,
  TransactionReceiptNotFoundError,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import tokenAbiJson from "../../src/lib/abi/mockUSDC.json";
import walletAbiJson from "../../src/lib/abi/convergeGroupWallet.json";
import deployment from "../../contracts/deployments/11155111.json";
import participantManifest from "../../contracts/deployments/demo-participants.11155111.json";
import roleManifest from "../../contracts/deployments/demo-roles.11155111.json";
import { demoRolesSchema } from "../../src/lib/demo-roles.js";
import {
  ExploreStore,
  atomicJson,
  optionalJson,
} from "../../src/lib/explore/store.js";
import type { ExploreRun } from "../../src/lib/explore/types.js";
import {
  hashPolicy,
  policySchema,
  toContractPolicy,
} from "../../src/lib/policy.js";
import {
  evaluateDecision,
  publicEvaluation,
} from "../../src/lib/decision-engine.js";
import { createBaselinePreferences } from "../../src/lib/fixtures/preferences.js";
import { createRestaurantCatalog } from "../../src/lib/fixtures/restaurants.js";
import {
  EXPLORE_DEMO_SLOT,
  confirmMockReservation,
  reconcileMockReservation,
  requestMockReservation,
  type MockPaymentEvidence,
} from "../../src/lib/explore/mock-reservation.js";
import { createKilnClient } from "../../src/lib/kiln/client.js";
import { extractPreferences } from "../../src/lib/kiln/extraction.js";
import { discoverWithXapi } from "../../src/lib/discovery/xapi.js";
import { EXPLORE_SEARCH_LOCATION } from "../../src/lib/discovery/types.js";
import { proposeLivePlace } from "../../src/lib/explore/live-proposal.js";
import { validateLiveCommand } from "../../src/lib/explore/store.js";
import {
  assembleDemoMembers,
  chooseDemoPlace,
  findDemoGroupCandidates,
} from "../../src/lib/explore/group-decision.js";
import {
  assertMatchingIntent,
  executeJournaled,
  type JournalTransaction,
} from "./transaction-journal.js";

const tokenAbi = tokenAbiJson as Abi;
const walletAbi = walletAbiJson as Abi;
type Account = ReturnType<typeof privateKeyToAccount>;
export type ExploreEntry = JournalTransaction & {
  reservedWei: string;
  confirmed: boolean;
  failed?: boolean;
};
export type ExplorePersistence = {
  store: ExploreStore;
  load: () => Promise<Record<string, ExploreEntry>>;
  save: (key: string, entry: ExploreEntry) => Promise<void>;
  attempt: (id: string, data: unknown) => Promise<void>;
  guard: () => Promise<void>;
  pendingOther: (signer: string, key: string) => Promise<boolean>;
};
export class ExploreWorker {
  readonly store: ExploreStore;
  readonly roles = demoRolesSchema.parse(roleManifest);
  readonly token = deployment.mockUSDC.address as Address;
  readonly escrow = deployment.convergeGroupWallet.address as Address;
  readonly client;
  readonly transport;
  readonly bots: Account[];
  readonly deployer: Account;
  readonly executor: Account;
  readonly ledgerPath: string;
  ledger: Record<string, ExploreEntry> = {};
  snapshotBlock: bigint | undefined;
  constructor(readonly persistence?: ExplorePersistence) {
    this.store = persistence?.store ?? new ExploreStore();
    if (!process.env.RPC_URL) throw new Error("RPC_URL is required");
    this.transport = http(process.env.RPC_URL, {
      timeout: 15000,
      retryCount: 1,
    });
    this.client = createPublicClient({
      chain: sepolia,
      transport: this.transport,
    });
    const signer = (name: string, expected: string) => {
      const key = process.env[name];
      if (!key) throw new Error(`${name} is missing`);
      const account = privateKeyToAccount(key as Hex);
      if (account.address.toLowerCase() !== expected.toLowerCase())
        throw new Error(`${name} does not match the manifest`);
      return account;
    };
    this.deployer = signer("DEPLOYER_PRIVATE_KEY", deployment.deployer);
    this.executor = signer("AGENT_EXECUTOR_PRIVATE_KEY", this.roles.executor);
    this.bots = participantManifest.participants
      .slice(1)
      .map((person, index) =>
        signer(`DEMO_PARTICIPANT_${index + 2}_PRIVATE_KEY`, person.address),
      );
    this.ledgerPath = join(this.store.root, "private", "transactions.json");
  }
  async init() {
    await this.store.init();
    if (!this.persistence)
      await mkdir(join(this.store.root, "private"), {
        recursive: true,
        mode: 0o700,
      });
    this.ledger = this.persistence
      ? await this.persistence.load()
      : ((await optionalJson<Record<string, ExploreEntry>>(this.ledgerPath)) ??
        {});
    if (
      (await this.client.getChainId()) !== sepolia.id ||
      (await this.client.getBlock({ blockNumber: 0n })).hash !==
        "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
    )
      throw new Error("Expected Ethereum Sepolia");
    for (const contract of [
      deployment.mockUSDC,
      deployment.convergeGroupWallet,
    ]) {
      const code = await this.client.getBytecode({
        address: contract.address as Address,
      });
      if (!code || keccak256(code) !== contract.deployedCodeHash)
        throw new Error("Contract bytecode mismatch");
    }
    const owner = (await this.readToken("minter", [])) as Address;
    if (owner.toLowerCase() !== this.deployer.address.toLowerCase())
      throw new Error("MockUSDC owner mismatch");
  }
  async saveEntry(key: string) {
    if (this.persistence) await this.persistence.save(key, this.ledger[key]!);
    else await atomicJson(this.ledgerPath, this.ledger);
  }
  readToken(functionName: string, args: unknown[]) {
    return this.client.readContract({
      address: this.token,
      abi: tokenAbi,
      functionName,
      args,
    });
  }
  readWallet(functionName: string, args: unknown[]) {
    return this.client.readContract({
      address: this.escrow,
      abi: walletAbi,
      functionName,
      args,
      ...(this.snapshotBlock === undefined
        ? {}
        : { blockNumber: this.snapshotBlock }),
    });
  }
  async transact(
    run: ExploreRun,
    label: string,
    account: Account,
    to: Address,
    data: Hex = "0x",
    value = 0n,
    broadcastOnly = false,
  ) {
    const key = `${run.id}:${label}`;
    const wallet = createWalletClient({
      account,
      chain: sepolia,
      transport: this.transport,
    });
    const saved = this.ledger[key];
    const intent = {
      chainId: sepolia.id,
      from: account.address,
      to,
      data,
      valueWei: String(value),
    };
    if (saved) assertMatchingIntent(saved.intent, intent);
    if (
      intent.from.toLowerCase() !== account.address.toLowerCase() ||
      intent.to?.toLowerCase() !== to.toLowerCase()
    )
      throw new Error("Journal signer or recipient mismatch");
    const receipt = async (hash: Hex) => {
      try {
        return await this.client.getTransactionReceipt({ hash });
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return undefined;
        throw error;
      }
    };
    let reservedWei = saved?.reservedWei ?? "0";
    const outcome = await executeJournaled({
      intent,
      load: async () => this.ledger[key],
      prepare: async () => {
        await this.persistence?.guard();
        if (await this.persistence?.pendingOther(account.address, key))
          throw new Error("WAITING_FOR_OTHER_TRANSACTION");
        if (
          Object.values(this.ledger).some(
            (entry) =>
              !entry.confirmed &&
              entry.intent.from.toLowerCase() === account.address.toLowerCase(),
          )
        )
          throw new Error("WAITING_FOR_OTHER_TRANSACTION");
        const request = await wallet.prepareTransactionRequest({
          account,
          to,
          data,
          value,
        });
        if (request.gas !== undefined) request.gas += request.gas / 4n;
        const fee = request.maxFeePerGas ?? request.gasPrice;
        if (fee === undefined || request.gas === undefined)
          throw new Error("Missing gas estimate");
        reservedWei = String(request.gas * fee + value);
        const alreadyReserved = Object.values(this.ledger).reduce(
          (sum, entry) => sum + BigInt(entry.reservedWei),
          0n,
        );
        const cap = parseEther(process.env.EXPLORE_DEMO_MAX_ETH || "0.06");
        if (alreadyReserved + BigInt(reservedWei) > cap)
          throw new Error("DEMO_ETH_BUDGET_EXCEEDED");
        return wallet.signTransaction(request);
      },
      save: async (transaction) => {
        this.ledger[key] = { ...transaction, reservedWei, confirmed: false };
        await this.saveEntry(key);
        run.transactions.push({
          label,
          hash: transaction.hash,
          confirmed: false,
        });
        await this.store.save(run);
      },
      findReceipt: receipt,
      broadcast: async (serialized) => {
        await this.persistence?.guard();
        return this.client.sendRawTransaction({
          serializedTransaction: serialized,
        });
      },
      waitReceipt: (hash) =>
        broadcastOnly || this.persistence
          ? Promise.resolve(null)
          : this.client.waitForTransactionReceipt({
              hash,
              timeout: 25000,
              confirmations: 1,
            }),
    });
    if (broadcastOnly) return;
    if (!outcome.receipt) throw new Error("WAITING_FOR_CONFIRMATIONS");
    // Interactive progress uses two confirmations, not a claim of finalized evidence.
    if (
      (await this.client.getBlockNumber({ cacheTime: 0 })) <
      outcome.receipt.blockNumber + 1n
    )
      throw new Error("WAITING_FOR_CONFIRMATIONS");
    const block = await this.client.getBlock({
      blockNumber: outcome.receipt.blockNumber,
    });
    if (block.hash !== outcome.receipt.blockHash)
      throw new Error("WAITING_FOR_CANONICAL_RECEIPT");
    this.ledger[key]!.confirmed = true;
    if (outcome.receipt.status !== "success") this.ledger[key]!.failed = true;
    await this.saveEntry(key);
    let visible = run.transactions.find((item) => item.label === label);
    if (!visible) {
      visible = { label, hash: outcome.transaction.hash, confirmed: true };
      run.transactions.push(visible);
    }
    visible.confirmed = true;
    if (outcome.receipt.status !== "success") visible.failed = true;
    await this.store.save(run);
    if (outcome.receipt.status !== "success")
      throw new Error(`Transaction reverted: ${label}`);
  }
  async contract(
    run: ExploreRun,
    label: string,
    account: Account,
    address: Address,
    abi: Abi,
    functionName: string,
    args: unknown[],
    broadcastOnly = false,
  ) {
    let transactionLabel = label;
    for (
      let attempt = 1;
      this.ledger[`${run.id}:${transactionLabel}`]?.failed;
      attempt++
    ) {
      if (attempt > 2)
        throw new Error(`Transaction retries exhausted: ${label}`);
      transactionLabel = `${label} retry ${attempt}`;
    }
    await this.transact(
      run,
      transactionLabel,
      account,
      address,
      encodeFunctionData({ abi, functionName, args }),
      0n,
      broadcastOnly,
    );
  }
  async provision(
    run: ExploreRun,
    address: Address,
    name: string,
    targetEth: string,
    tokens: boolean,
  ) {
    const gasLabel = `Gas for ${name}`;
    const gasEntry = this.ledger[`${run.id}:${gasLabel}`];
    if (gasEntry) {
      if (!gasEntry.confirmed) {
        await this.transact(
          run,
          gasLabel,
          this.deployer,
          address,
          gasEntry.intent.data,
          BigInt(gasEntry.intent.valueWei),
        );
        return false;
      }
    } else {
      const balance = await this.client.getBalance({ address });
      const target = parseEther(targetEth);
      if (balance < target) {
        await this.transact(
          run,
          gasLabel,
          this.deployer,
          address,
          "0x",
          target - balance,
        );
        return false;
      }
    }
    if (tokens) {
      const label = `MockUSDC for ${name}`;
      const entry = this.ledger[`${run.id}:${label}`];
      if (entry) {
        if (!entry.confirmed) {
          await this.transact(
            run,
            label,
            this.deployer,
            this.token,
            entry.intent.data,
            BigInt(entry.intent.valueWei),
          );
          return false;
        }
      } else {
        const balance = (await this.readToken("balanceOf", [
          address,
        ])) as bigint;
        if (balance < 10_000_000n) {
          await this.contract(
            run,
            label,
            this.deployer,
            this.token,
            tokenAbi,
            "mint",
            [address, 10_000_000n - balance],
          );
          return false;
        }
      }
    }
    return true;
  }
  async tick(run: ExploreRun) {
    await this.persistence?.guard();
    this.snapshotBlock = undefined;
    // Recover signed work before deriving the next action from current balances.
    for (const [key, entry] of Object.entries(this.ledger)) {
      if (!key.startsWith(`${run.id}:`) || entry.confirmed) continue;
      const signer = [this.deployer, this.executor, ...this.bots].find(
        (account) =>
          account.address.toLowerCase() === entry.intent.from.toLowerCase(),
      );
      if (!signer || !entry.intent.to)
        throw new Error("Journal signer missing");
      await this.transact(
        run,
        key.slice(run.id.length + 1),
        signer,
        entry.intent.to,
        entry.intent.data,
        BigInt(entry.intent.valueWei),
      );
      return;
    }
    const reserved = [
      this.deployer.address,
      this.executor.address,
      this.token,
      this.escrow,
      ...Object.values(this.roles.merchants),
      ...participantManifest.participants.map((person) => person.address),
    ];
    if (
      reserved.some(
        (address) => address.toLowerCase() === run.judge.toLowerCase(),
      )
    )
      throw new Error("Use a separate judge wallet, not an operator account");
    const command = run.command;
    if (command) {
      // Keep the command until its result is durable, so a terminated request
      // resumes it. Extraction counters are charged only once across retries.
      if (command.action === "group_search") {
        // Persist candidates before the second Qwen call. Recovery can resume
        // selection without repeating a paid xAPI search.
        const resumeChoice =
          run.searchInFlight &&
          run.groupDecision?.stage === "choosing" &&
          run.discovery;
        if (run.searchInFlight && !resumeChoice) {
          delete run.searchInFlight;
          delete run.command;
          if (run.groupDecision) run.groupDecision.stage = "failed";
          run.error = "SEARCH_INTERRUPTED_RETRY_EXPLICITLY";
          await this.store.save(run);
          return;
        }
        if (!resumeChoice) {
          validateLiveCommand(run, command);
          const members = assembleDemoMembers(
            run.judge,
            command.preference,
            this.bots.map((bot) => bot.address),
          );
          run.searchCalls = (run.searchCalls ?? 0) + 1;
          run.revision++;
          run.text = command.text;
          run.searchInFlight = true;
          run.phase = "preferences";
          run.groupDecision = { stage: "aggregating", members };
          delete run.discovery;
          delete run.extraction;
          delete run.evaluation;
          delete run.selectedPlace;
          delete run.restaurant;
          await this.store.save(run);
        }
        try {
          if (!process.env.KILN_API_KEY || !process.env.XAPI_KEY)
            throw new Error("SEARCH_NOT_CONFIGURED");
          const kiln = createKilnClient({
            apiKey: process.env.KILN_API_KEY,
            maxAttempts: 2,
            timeoutMs: 25000,
            onAttempt: async (attempt) => {
              if (this.persistence)
                await this.persistence.attempt(
                  `${run.id}:${run.revision}:${attempt.usage.requestId}:${attempt.usage.attempt}`,
                  attempt,
                );
            },
          });
          const decision = run.groupDecision!;
          if (!resumeChoice) {
            const result = await findDemoGroupCandidates({
              client: kiln,
              xapiKey: process.env.XAPI_KEY,
              runId: `group-${run.id.slice(0, 20)}-${run.revision}`,
              members: decision.members,
              onSearching: async () => {
                decision.stage = "searching";
                await this.store.save(run);
              },
            });
            run.discovery = {
              intent: {
                area: EXPLORE_SEARCH_LOCATION,
                cuisine: "",
                koreanQuery: result.query || "Group dinner",
                budget: null,
                people: 6,
                facilities: [],
                otherRequirements: [],
                clarifications: result.conflicts,
              },
              query: result.query,
              searchedAt: result.searchedAt,
              places: result.places,
              excludedCount: 0,
              source: "xAPI (Google Maps)",
            };
            if (result.conflicts.length || !result.places.length) {
              decision.stage = "blocked";
              decision.rationale =
                result.conflicts[0] ??
                "No places were found for the group's preferences. Update your request and try again.";
              run.phase = "review";
              delete run.command;
              delete run.searchInFlight;
              await this.store.save(run);
              return;
            }
            decision.stage = "choosing";
            await this.store.save(run);
          }
          const choice = await chooseDemoPlace(
            kiln,
            `choice-${run.id.slice(0, 20)}-${run.revision}`,
            decision.members,
            run.discovery!.places,
          );
          decision.rationale = choice.rationale;
          decision.uncertainties = choice.uncertainties;
          if (!choice.placeId) {
            decision.stage = "blocked";
            run.phase = "review";
          } else {
            decision.selectedId = choice.placeId;
            const place = run.discovery!.places.find(
              (candidate) => candidate.id === choice.placeId,
            )!;
            run.selectedPlace = structuredClone(place);
            run.restaurant = place.name;
            run.phase = "review";
            decision.stage = "ready";
          }
        } catch (error) {
          if (error instanceof Error && error.message === "JOB_LEASE_LOST")
            throw error;
          if (run.groupDecision) run.groupDecision.stage = "failed";
          run.error = "GROUP_DECISION_FAILED";
        }
        delete run.command;
        delete run.searchInFlight;
        await this.store.save(run);
        return;
      } else if (command.action === "search") {
        // An interrupted paid request is not silently repeated on worker recovery.
        if (run.searchInFlight) {
          delete run.searchInFlight;
          delete run.command;
          run.error = "SEARCH_INTERRUPTED_RETRY_EXPLICITLY";
          await this.store.save(run);
          return;
        }
        validateLiveCommand(run, command);
        run.searchCalls = (run.searchCalls ?? 0) + 1;
        run.revision++;
        run.searchInFlight = true;
        run.text = command.text;
        run.phase = "preferences";
        delete run.discovery;
        delete run.extraction;
        delete run.evaluation;
        run.searchUsage ??= [];
        await this.store.save(run);
        try {
          if (!process.env.KILN_API_KEY || !process.env.XAPI_KEY)
            throw new Error("SEARCH_NOT_CONFIGURED");
          run.discovery = await discoverWithXapi({
            kilnKey: process.env.KILN_API_KEY,
            xapiKey: process.env.XAPI_KEY,
            input: {
              scope: "explore",
              category: "restaurant",
              location: EXPLORE_SEARCH_LOCATION,
              text: command.text,
            },
            onUsage: async (usage) => {
              run.searchUsage!.push(usage);
              await this.store.save(run);
            },
          });
          if (
            run.discovery.intent.people &&
            run.discovery.intent.people !== 6
          ) {
            run.discovery.intent.clarifications.push(
              "This demo has six participants. Please revise the request for six people.",
            );
            run.discovery.places = [];
          }
          run.phase = "review";
        } catch {
          run.error = "LIVE_SEARCH_FAILED";
        }
        delete run.searchInFlight;
      } else if (command.action === "select_place") {
        proposeLivePlace(run, command, {
          escrow: this.escrow,
          token: this.token,
          merchant: this.roles.merchants.A,
          executor: this.executor.address,
          participants: [
            run.judge,
            ...this.bots.map((account) => account.address),
          ],
          blockTimestamp: Number((await this.client.getBlock()).timestamp),
        });
      } else if (command.action === "extract") {
        if (!run.extractionInFlight) {
          run.extractionCalls++;
          run.revision++;
          run.extractionInFlight = true;
          run.extractionAttempts = 0;
        }
        if ((run.extractionAttempts ?? 0) >= 3) {
          delete run.command;
          delete run.extractionInFlight;
          run.error = "EXTRACTION_FAILED";
          await this.store.save(run);
          return;
        }
        run.extractionAttempts = (run.extractionAttempts ?? 0) + 1;
        run.text = command.text;
        delete run.extraction;
        run.phase = "preferences";
        await this.store.save(run);
        if (!process.env.KILN_API_KEY)
          throw new Error("KILN_API_KEY is missing");
        const kiln = createKilnClient({
          apiKey: process.env.KILN_API_KEY,
          onAttempt: async (attempt) => {
            if (this.persistence) {
              await this.persistence.attempt(
                `${run.id}:${run.revision}:${attempt.usage.requestId}:${attempt.usage.attempt}`,
                attempt,
              );
              return;
            }
            await atomicJson(
              join(
                this.store.root,
                "private",
                `${run.id}-kiln-${run.revision}-${attempt.usage.attempt}.json`,
              ),
              attempt,
            );
          },
        });
        run.extraction = await extractPreferences(kiln, {
          runId: `explore-${run.id.slice(0, 20)}-${run.revision}`,
          text: command.text,
        });
        run.phase = "review";
        delete run.extractionInFlight;
        delete run.extractionAttempts;
      } else if (command.action === "confirm") {
        if (command.revision !== run.revision || run.phase !== "review")
          throw new Error("STALE_REVISION");
        run.extraction = command.extraction;
        const members = [
          run.judge,
          ...this.bots.map((account) => account.address),
        ];
        const slot = EXPLORE_DEMO_SLOT;
        const preferences = createBaselinePreferences(members);
        preferences[0]!.extraction = command.extraction;
        const catalog = createRestaurantCatalog(this.roles, [slot.startsAt]);
        run.evaluation = publicEvaluation(
          evaluateDecision({
            members,
            preferences,
            slot,
            permittedMerchants: Object.values(this.roles.merchants),
            contributionPerParticipant: "10000000",
            maxDeposit: "60000000",
            maxTotalSpend: "60000000",
            catalog,
          }),
        );
        if (run.evaluation.status === "PROPOSAL_READY") {
          const winner = catalog.restaurants.find(
            (candidate) => candidate.id === run.evaluation!.winnerId,
          )!;
          run.restaurant = winner.name;
          run.policy = policySchema.parse({
            policyVersion: 1,
            chainId: sepolia.id,
            verifyingContract: this.escrow,
            decisionId: keccak256(
              stringToHex(`Converge:explore:${run.id}:${run.createdAt}`),
            ),
            token: this.token,
            merchant: winner.merchant,
            executor: this.executor.address,
            participants: members,
            approvalThreshold: 6,
            contributionPerParticipant: "10000000",
            paymentAmount: winner.depositBaseUnits,
            maxDeposit: "60000000",
            maxTotalSpend: "60000000",
            expiry:
              Number((await this.client.getBlock()).timestamp) + 23 * 3600,
            reservationReference: keccak256(
              stringToHex(`explore:${run.id}:${winner.id}`),
            ),
          });
          run.policyHash = hashPolicy(run.policy);
          run.reservation = requestMockReservation(
            run.policy,
            run.restaurant,
            slot.startsAt,
          );
          run.phase = "proposal";
        }
      } else {
        if (run.phase !== "proposal" || !run.policy)
          throw new Error("POLICY_NOT_READY");
        run.phase = "preparing";
      }
      delete run.command;
      await this.store.save(run);
      return;
    }
    if (
      !run.policy ||
      ["preferences", "review", "proposal"].includes(run.phase)
    )
      return;
    const policy = run.policy;
    const id = policy.decisionId;
    const createEntry = this.ledger[`${run.id}:Create policy`];
    if (!createEntry?.confirmed) {
      if (Number((await this.client.getBlock()).timestamp) >= policy.expiry) {
        run.phase = "expired";
        const reservation = reconcileMockReservation(
          run.reservation,
          policy,
          "expired",
        );
        if (reservation) run.reservation = reservation;
        return;
      }
      if (!(await this.provision(run, run.judge, "you", "0.001", true))) return;
      if (
        !(await this.provision(
          run,
          this.bots[0]!.address,
          "creator",
          "0.004",
          false,
        ))
      )
        return;
      await this.contract(
        run,
        "Create policy",
        this.bots[0]!,
        this.escrow,
        walletAbi,
        "createDecision",
        [toContractPolicy(policy)],
      );
      return;
    }
    this.snapshotBlock =
      (await this.client.getBlockNumber({ cacheTime: 0 })) - 1n;
    const [storedHash, status, approvalCount] = (await this.readWallet(
      "getDecision",
      [id],
    )) as [Hex, number, bigint, bigint, bigint, bigint];
    if (storedHash !== run.policyHash)
      throw new Error("On-chain policy hash mismatch");
    run.approvals = Number(approvalCount);
    run.contributions = [];
    for (const address of policy.participants)
      run.contributions.push(
        String(await this.readWallet("contributionOf", [id, address])),
      );
    run.refund = String(
      await this.readWallet("refundEntitlement", [id, run.judge]),
    );
    run.refunded = (await this.readWallet("refundClaimed", [
      id,
      run.judge,
    ])) as boolean;
    run.lastCheckedAt = new Date().toISOString();
    const creationReceipt = await this.client.getTransactionReceipt({
      hash: createEntry.hash,
    });
    const logs = await this.client.getContractEvents({
      address: this.escrow,
      abi: walletAbi,
      fromBlock: creationReceipt.blockNumber,
      toBlock: this.snapshotBlock,
    });
    let paymentEvidence: MockPaymentEvidence | undefined;
    for (const log of logs) {
      const event = log as unknown as {
        eventName: string;
        args: {
          decisionId?: string;
          participant?: string;
          merchant?: string;
          amount?: bigint;
        };
        transactionHash: Hex;
      };
      if (
        event.eventName === "PaymentExecuted" &&
        event.args.decisionId === id &&
        event.args.merchant &&
        event.args.amount !== undefined
      )
        paymentEvidence = {
          hash: event.transactionHash,
          decisionId: id,
          merchant: event.args.merchant,
          amount: event.args.amount,
        };
      if (
        event.args.decisionId !== id ||
        event.args.participant?.toLowerCase() !== run.judge.toLowerCase()
      )
        continue;
      const label =
        event.eventName === "ParticipantApproved"
          ? "Your contribution"
          : event.eventName === "RefundClaimed"
            ? "Your refund"
            : event.eventName === "DecisionCancelled"
              ? "Your cancellation"
              : null;
      if (
        label &&
        !run.transactions.some((item) => item.hash === event.transactionHash)
      )
        run.transactions.push({
          label,
          hash: event.transactionHash,
          confirmed: true,
        });
    }
    const expired =
      Number(
        (await this.client.getBlock({ blockNumber: this.snapshotBlock }))
          .timestamp,
      ) >= policy.expiry;
    if (status >= 2 || expired) {
      run.phase =
        status === 2 ? "completed" : status === 3 ? "cancelled" : "expired";
      const reservation = reconcileMockReservation(
        run.reservation,
        policy,
        run.phase,
      );
      if (reservation) run.reservation = reservation;
      if (status === 2 && run.reservation && paymentEvidence)
        run.reservation = confirmMockReservation(
          run.reservation,
          policy,
          paymentEvidence,
        );
      const refundBots: Account[] = [];
      for (const bot of this.bots) {
        const contributed = (await this.readWallet("contributionOf", [
          id,
          bot.address,
        ])) as bigint;
        const claimed = (await this.readWallet("refundClaimed", [
          id,
          bot.address,
        ])) as boolean;
        if (contributed > 0n && !claimed) refundBots.push(bot);
      }
      for (const bot of refundBots)
        await this.contract(
          run,
          `Refund ${bot.address}`,
          bot,
          this.escrow,
          walletAbi,
          "claimRefund",
          [id],
          true,
        );
      run.automationComplete = refundBots.length === 0;
      return;
    }
    if (run.contributions[0] !== "10000000") {
      run.phase = "approval";
      return;
    }
    run.phase = "contributing";
    const remaining = this.bots.filter(
      (_bot, index) => run.contributions[index + 1] !== "10000000",
    );
    for (const bot of remaining) {
      const index = this.bots.indexOf(bot);
      if (
        !(await this.provision(
          run,
          bot.address,
          `participant ${index + 2}`,
          "0.001",
          true,
        ))
      )
        return;
    }
    const missingAllowances: Account[] = [];
    for (const bot of remaining) {
      const allowance = (await this.readToken("allowance", [
        bot.address,
        this.escrow,
      ])) as bigint;
      if (allowance < 10_000_000n) missingAllowances.push(bot);
    }
    if (missingAllowances.length) {
      for (const bot of missingAllowances)
        await this.contract(
          run,
          `Allowance ${bot.address}`,
          bot,
          this.token,
          tokenAbi,
          "approve",
          [this.escrow, 10_000_000n],
          true,
        );
      return;
    }
    if (remaining.length) {
      for (const bot of remaining)
        await this.contract(
          run,
          `Contribution ${bot.address}`,
          bot,
          this.escrow,
          walletAbi,
          "approveAndContribute",
          [id, run.policyHash],
          true,
        );
      return;
    }
    if (
      !(await this.provision(
        run,
        this.executor.address,
        "executor",
        "0.001",
        false,
      ))
    )
      return;
    const rejected = (await this.readWallet("validatePayment", [
      id,
      this.executor.address,
      policy.merchant,
      80_000_000n,
    ])) as [boolean, number];
    if (rejected[0] || Number(rejected[1]) !== 8)
      throw new Error("Expected the 80 MockUSDC cap check to fail");
    run.rejection = {
      amount: "80000000",
      reason: "MaxDepositExceeded",
      kind: "eth_call",
      block: String(await this.client.getBlockNumber()),
    };
    await this.store.save(run);
    await this.contract(
      run,
      "Reservation payment",
      this.executor,
      this.escrow,
      walletAbi,
      "executePayment",
      [id, policy.merchant, BigInt(policy.paymentAmount)],
    );
  }
}
