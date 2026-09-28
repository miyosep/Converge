import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
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
  stringToHex,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { BASELINE_AMOUNTS } from "../src/lib/constants.js";
import {
  assertSeparateDemoRoles,
  demoRolesSchema,
} from "../src/lib/demo-roles.js";
import {
  hashPolicy,
  policySchema,
  toContractPolicy,
  type Policy,
} from "../src/lib/policy.js";
import { addressSchema } from "../src/lib/schemas/primitives.js";
import {
  assertMatchingIntent,
  executeJournaled,
  type JournalTransaction,
  type TransactionIntent,
} from "./lib/transaction-journal.js";

type DecodedEvent = {
  address: Address;
  name: string;
  args: Record<string, unknown>;
  logIndex: number;
};
type PublicTransaction = Omit<JournalTransaction, "serialized"> & {
  receipt?: {
    status: string;
    blockNumber: string;
    blockHash: Hex;
    gasUsed: string;
    events: DecodedEvent[];
  };
};
type Snapshot = {
  blockNumber: string;
  blockHash: Hex;
  participants: string[];
  merchant: string;
  escrow: string;
  totalSupply: string;
};
type Run = {
  schemaVersion: 1;
  scope: "blockchain-only-baseline";
  runId: string;
  mode: "single-operator-demo";
  policy: Policy;
  policyHash: Hex;
  before: Snapshot;
  transactions: Record<string, PublicTransaction>;
  rejection?: {
    kind: "eth_call_simulation";
    amount: string;
    reason: "MaxDepositExceeded";
    reasonCode: 8;
    blockNumber: string;
    blockHash: Hex;
    transactionSubmitted: false;
  };
  after?: Snapshot;
  status: "in-progress" | "completed";
};
const json = (value: unknown) =>
  `${JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`;
async function readOptional<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function atomicWrite(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.tmp`, json(value), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

async function main(): Promise<void> {
  const [runId = "baseline-001", ...extra] = process.argv.slice(2);
  const verifyOnly = extra.length === 1 && extra[0] === "--verify-only";
  if ((extra.length && !verifyOnly) || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(runId))
    throw new Error("Use one simple run ID");
  const rpc = process.env.RPC_URL;
  if (!rpc) throw new Error("RPC_URL missing");
  const dir = "docs/evidence";
  const privateDir = `${dir}/private/${runId}`;
  await mkdir(privateDir, { recursive: true });
  const lockPath = `${privateDir}/run.lock`;
  const lock = await open(lockPath, "wx");
  try {
    const path = `${dir}/${runId}.json`;
    const readJson = async (file: string) =>
      JSON.parse(await readFile(file, "utf8"));
    const deployment = await readJson("contracts/deployments/11155111.json");
    if (deployment.chainId !== sepolia.id)
      throw new Error("Wrong deployment chain");
    const roles = demoRolesSchema.parse(
      await readJson("contracts/deployments/demo-roles.11155111.json"),
    );
    const manifest = await readJson(
      "contracts/deployments/demo-participants.11155111.json",
    );
    if (manifest.chainId !== sepolia.id || manifest.participants.length !== 6)
      throw new Error("Wrong participant manifest");
    const participants = manifest.participants.map((p: { address: string }) =>
      addressSchema.parse(p.address),
    ) as Address[];
    const token = addressSchema.parse(deployment.mockUSDC.address);
    const escrow = addressSchema.parse(deployment.convergeGroupWallet.address);
    assertSeparateDemoRoles(roles, [
      ...participants,
      token,
      escrow,
      deployment.deployer,
    ]);
    const signer = (name: string, address: Address) => {
      const key = process.env[name];
      if (!key) throw new Error("Missing local signer");
      const account = privateKeyToAccount(key as Hex);
      if (account.address !== address) throw new Error("Local signer mismatch");
      return account;
    };
    const accounts = participants.map((address, i) =>
      signer(`DEMO_PARTICIPANT_${i + 1}_PRIVATE_KEY`, address),
    );
    const executor = signer("AGENT_EXECUTOR_PRIVATE_KEY", roles.executor);
    const transport = http(rpc, { timeout: 15_000, retryCount: 2 });
    const client = createPublicClient({ chain: sepolia, transport });
    if ((await client.getChainId()) !== sepolia.id)
      throw new Error("Wrong RPC chain");
    if (
      (await client.getBlock({ blockNumber: 0n })).hash !==
      "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
    )
      throw new Error("Wrong RPC genesis");
    for (const [address, expected] of [
      [token, deployment.mockUSDC.deployedCodeHash],
      [escrow, deployment.convergeGroupWallet.deployedCodeHash],
    ] as const) {
      const code = await client.getBytecode({ address });
      if (!code || keccak256(code) !== expected)
        throw new Error("Deployed code mismatch");
    }
    const tokenAbi = (await readJson("src/lib/abi/mockUSDC.json")) as Abi;
    const escrowAbi = (await readJson(
      "src/lib/abi/convergeGroupWallet.json",
    )) as Abi;
    const tokenRead = (
      functionName: string,
      args: readonly unknown[] = [],
      blockNumber?: bigint,
    ) =>
      client.readContract({
        address: token,
        abi: tokenAbi,
        functionName,
        args,
        ...(blockNumber === undefined ? {} : { blockNumber }),
      });
    const walletRead = (
      functionName: string,
      args: readonly unknown[],
      blockNumber?: bigint,
    ) =>
      client.readContract({
        address: escrow,
        abi: escrowAbi,
        functionName,
        args,
        ...(blockNumber === undefined ? {} : { blockNumber }),
      });
    async function snapshot(blockNumber: bigint): Promise<Snapshot> {
      const block = await client.getBlock({ blockNumber });
      const balances: string[] = [];
      for (const address of participants)
        balances.push(
          String(await tokenRead("balanceOf", [address], blockNumber)),
        );
      return {
        blockNumber: blockNumber.toString(),
        blockHash: block.hash,
        participants: balances,
        merchant: String(
          await tokenRead("balanceOf", [roles.merchants.A], blockNumber),
        ),
        escrow: String(await tokenRead("balanceOf", [escrow], blockNumber)),
        totalSupply: String(await tokenRead("totalSupply", [], blockNumber)),
      };
    }
    let run = await readOptional<Run>(path);
    if (verifyOnly && run?.status !== "completed")
      throw new Error("Read-only verification requires a completed run");
    const currentBlock = await client.getBlock();
    const expectedPolicy = policySchema.parse({
      policyVersion: 1,
      chainId: sepolia.id,
      verifyingContract: escrow,
      decisionId: keccak256(
        stringToHex(
          `Converge:blockchain-baseline:${sepolia.id}:${escrow}:${runId}`,
        ),
      ),
      token,
      merchant: roles.merchants.A,
      executor: roles.executor,
      participants,
      approvalThreshold: 6,
      contributionPerParticipant: BASELINE_AMOUNTS.contributionPerParticipant,
      paymentAmount: BASELINE_AMOUNTS.paymentAmount,
      maxDeposit: BASELINE_AMOUNTS.maxDeposit,
      maxTotalSpend: BASELINE_AMOUNTS.maxTotalSpend,
      expiry: run?.policy.expiry ?? Number(currentBlock.timestamp + 86_400n),
      reservationReference: keccak256(
        stringToHex(`synthetic:RestaurantA:${runId}`),
      ),
    });
    if (run) {
      if (
        run.schemaVersion !== 1 ||
        run.scope !== "blockchain-only-baseline" ||
        run.mode !== "single-operator-demo" ||
        run.runId !== runId ||
        run.policyHash !== hashPolicy(expectedPolicy) ||
        hashPolicy(run.policy) !== run.policyHash
      )
        throw new Error("Saved run does not match the current configuration");
    } else {
      const before = await snapshot(currentBlock.number);
      if (before.participants.some((balance) => BigInt(balance) < 10_000_000n))
        throw new Error("Insufficient participant tokens");
      for (const address of [...participants, roles.executor])
        if ((await client.getBalance({ address })) === 0n)
          throw new Error("Signer requires gas");
      run = {
        schemaVersion: 1,
        scope: "blockchain-only-baseline",
        runId,
        mode: "single-operator-demo",
        policy: expectedPolicy,
        policyHash: hashPolicy(expectedPolicy),
        before,
        transactions: {},
        status: "in-progress",
      };
      await atomicWrite(path, run);
    }
    const record = run;
    const save = () => atomicWrite(path, record);
    const id = record.policy.decisionId as Hex;
    async function step(
      name: string,
      account: typeof executor,
      address: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
      expectedEvent: string,
      expectedArgs: Record<string, unknown>,
    ): Promise<TransactionReceipt> {
      const data = encodeFunctionData({ abi, functionName, args });
      const intent: TransactionIntent = {
        chainId: sepolia.id,
        from: account.address,
        to: address,
        data,
        valueWei: "0",
      };
      const wallet = createWalletClient({ account, chain: sepolia, transport });
      const privatePath = `${privateDir}/${name}.json`;
      const { transaction, receipt } = await executeJournaled({
        intent,
        load: async () => {
          const local = await readOptional<JournalTransaction>(privatePath);
          const published = record.transactions[name];
          if (local && published && local.hash !== published.hash)
            throw new Error("Transaction journal mismatch");
          return local ?? published;
        },
        prepare: async () => {
          if (verifyOnly)
            throw new Error(
              "Read-only verification cannot prepare a transaction",
            );
          await client.simulateContract({
            account,
            address,
            abi,
            functionName,
            args,
          });
          const request = await wallet.prepareTransactionRequest({
            account,
            to: address,
            data,
            value: 0n,
          });
          return wallet.signTransaction(request);
        },
        save: async (transaction) => {
          await atomicWrite(privatePath, transaction);
          record.transactions[name] = {
            intent: transaction.intent,
            hash: transaction.hash,
          };
          await save();
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
        broadcast: (serialized) => {
          if (verifyOnly)
            throw new Error(
              "Read-only verification cannot broadcast a transaction",
            );
          return client.sendRawTransaction({
            serializedTransaction: serialized,
          });
        },
        waitReceipt: (hash) =>
          client.waitForTransactionReceipt({
            hash,
            timeout: 180_000,
            confirmations: 1,
          }),
      });
      if (receipt.status !== "success")
        throw new Error(`Transaction failed: ${name}`);
      const tx = await client.getTransaction({ hash: transaction.hash });
      if (!tx.to) throw new Error("Unexpected deployment transaction");
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
      const events: DecodedEvent[] = [];
      for (const log of receipt.logs) {
        const logAbi =
          log.address.toLowerCase() === token.toLowerCase()
            ? tokenAbi
            : log.address.toLowerCase() === escrow.toLowerCase()
              ? escrowAbi
              : undefined;
        if (!logAbi) continue;
        const decoded = decodeEventLog({
          abi: logAbi,
          data: log.data,
          topics: log.topics,
        });
        if (!decoded.eventName)
          throw new Error("Unnamed event in contract receipt");
        events.push({
          address: log.address,
          name: decoded.eventName,
          args: JSON.parse(json(decoded.args)),
          logIndex: log.logIndex,
        });
      }
      const matches = (actual: unknown, expected: unknown) =>
        String(actual).toLowerCase() === String(expected).toLowerCase();
      if (
        !events.some(
          (event) =>
            event.address.toLowerCase() === address.toLowerCase() &&
            event.name === expectedEvent &&
            Object.entries(expectedArgs).every(([key, value]) =>
              matches(event.args[key], value),
            ),
        )
      )
        throw new Error(`Expected event missing: ${name}`);
      if (
        functionName === "executePayment" ||
        functionName === "claimRefund" ||
        functionName === "approveAndContribute"
      ) {
        const from =
          functionName === "approveAndContribute" ? account.address : escrow;
        const to =
          functionName === "executePayment"
            ? roles.merchants.A
            : functionName === "claimRefund"
              ? account.address
              : escrow;
        const value =
          functionName === "executePayment"
            ? 45_000_000n
            : functionName === "claimRefund"
              ? 2_500_000n
              : 10_000_000n;
        if (
          !events.some(
            (event) =>
              event.address.toLowerCase() === token.toLowerCase() &&
              event.name === "Transfer" &&
              matches(event.args.from, from) &&
              matches(event.args.to, to) &&
              matches(event.args.value, value),
          )
        )
          throw new Error(`Token transfer missing: ${name}`);
      }
      record.transactions[name] = {
        intent,
        hash: transaction.hash,
        receipt: {
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          gasUsed: receipt.gasUsed.toString(),
          events,
        },
      };
      await save();
      process.stdout.write(`${name}: confirmed ${transaction.hash}\n`);
      return receipt;
    }
    await step(
      "create",
      accounts[0]!,
      escrow,
      escrowAbi,
      "createDecision",
      [toContractPolicy(record.policy)],
      "DecisionCreated",
      {
        decisionId: id,
        policyHash: record.policyHash,
        creator: participants[0]!,
      },
    );
    const storedPolicy = (await walletRead("getPolicy", [id])) as Record<
      string,
      unknown
    >;
    const contractPolicy = toContractPolicy(record.policy);
    if (
      keccak256(
        encodeFunctionData({
          abi: escrowAbi,
          functionName: "createDecision",
          args: [storedPolicy],
        }),
      ) !==
      keccak256(
        encodeFunctionData({
          abi: escrowAbi,
          functionName: "createDecision",
          args: [contractPolicy],
        }),
      )
    )
      throw new Error("On-chain policy differs from approved policy");
    for (const [index, account] of accounts.entries()) {
      await step(
        `allowance-${index + 1}`,
        account,
        token,
        tokenAbi,
        "approve",
        [escrow, 10_000_000n],
        "Approval",
        { owner: account.address, spender: escrow, value: "10000000" },
      );
      await step(
        `contribution-${index + 1}`,
        account,
        escrow,
        escrowAbi,
        "approveAndContribute",
        [id, record.policyHash],
        "ParticipantApproved",
        {
          decisionId: id,
          participant: account.address,
          contribution: "10000000",
          approvalCount: String(index + 1),
        },
      );
    }
    {
      const block = record.rejection
        ? await client.getBlock({
            blockNumber: BigInt(record.rejection.blockNumber),
          })
        : await client.getBlock();
      if (record.rejection && block.hash !== record.rejection.blockHash)
        throw new Error("Rejection evidence block changed");
      const validation = (await walletRead(
        "validatePayment",
        [id, roles.executor, roles.merchants.A, 80_000_000n],
        block.number,
      )) as readonly [boolean, number];
      if (validation[0] || Number(validation[1]) !== 8)
        throw new Error("Expected excessive-deposit validation rejection");
      let rejected = false;
      try {
        await client.simulateContract({
          account: executor,
          address: escrow,
          abi: escrowAbi,
          functionName: "executePayment",
          args: [id, roles.merchants.A, 80_000_000n],
          blockNumber: block.number,
        });
      } catch (error) {
        const reverted =
          error instanceof BaseError
            ? error.walk(
                (cause) => cause instanceof ContractFunctionRevertedError,
              )
            : undefined;
        if (
          reverted instanceof ContractFunctionRevertedError &&
          reverted.data?.errorName === "PaymentNotAllowed" &&
          Number(reverted.data.args?.[0]) === 8
        )
          rejected = true;
        else throw error;
      }
      if (!rejected)
        throw new Error("Excessive-deposit simulation unexpectedly succeeded");
      record.rejection = {
        kind: "eth_call_simulation",
        amount: "80000000",
        reason: "MaxDepositExceeded",
        reasonCode: 8,
        blockNumber: block.number.toString(),
        blockHash: block.hash,
        transactionSubmitted: false,
      };
      await save();
      process.stdout.write(
        "80 MockUSDC rejected by contract simulation: MaxDepositExceeded; no transaction submitted\n",
      );
    }
    await step(
      "payment",
      executor,
      escrow,
      escrowAbi,
      "executePayment",
      [id, roles.merchants.A, 45_000_000n],
      "PaymentExecuted",
      {
        decisionId: id,
        executor: roles.executor,
        merchant: roles.merchants.A,
        amount: "45000000",
      },
    );
    let finalReceipt: TransactionReceipt | undefined;
    for (const [index, account] of accounts.entries())
      finalReceipt = await step(
        `refund-${index + 1}`,
        account,
        escrow,
        escrowAbi,
        "claimRefund",
        [id],
        "RefundClaimed",
        { decisionId: id, participant: account.address, amount: "2500000" },
      );
    if (!finalReceipt) throw new Error("Refund evidence missing");
    const finalBlock = finalReceipt.blockNumber;
    const decision = (await walletRead(
      "getDecision",
      [id],
      finalBlock,
    )) as readonly [Hex, number, bigint, bigint, bigint, bigint];
    if (
      decision[0] !== record.policyHash ||
      Number(decision[1]) !== 2 ||
      decision[2] !== 6n ||
      decision[3] !== 60_000_000n ||
      decision[4] !== 45_000_000n ||
      decision[5] !== 15_000_000n
    )
      throw new Error("Final decision accounting mismatch");
    const after = await snapshot(finalBlock);
    if (
      after.participants.some(
        (balance, i) =>
          BigInt(balance) !==
          BigInt(record.before.participants[i]!) - 7_500_000n,
      ) ||
      BigInt(after.merchant) !== BigInt(record.before.merchant) + 45_000_000n ||
      after.escrow !== record.before.escrow ||
      after.totalSupply !== record.before.totalSupply
    )
      throw new Error("Token balance deltas do not match the baseline");
    for (const participant of participants) {
      if (
        !(await walletRead("refundClaimed", [id, participant], finalBlock)) ||
        (await walletRead(
          "refundEntitlement",
          [id, participant],
          finalBlock,
        )) !== 0n
      )
        throw new Error("Refund state mismatch");
    }
    record.after = after;
    record.status = "completed";
    await save();
    process.stdout.write(
      `Blockchain baseline completed: 60 collected, 45 paid, 15 refunded; evidence: ${path}\n`,
    );
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch((error: unknown) => {
  let reason =
    error instanceof BaseError
      ? error.shortMessage
      : error instanceof Error
        ? error.message.split("\n")[0]!
        : "Unknown error";
  for (const [name, value] of Object.entries(process.env)) {
    if (value && (name.endsWith("PRIVATE_KEY") || name === "RPC_URL"))
      reason = reason.replaceAll(value, "[REDACTED]");
  }
  process.stderr.write(
    `Blockchain baseline stopped: ${reason}\nPreserve its evidence and private transaction journal and resume with the same run ID.\n`,
  );
  process.exitCode = 1;
});
