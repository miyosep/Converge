import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { z } from "zod";
import {
  assertSeparateDemoRoles,
  demoRolesSchema,
} from "../src/lib/demo-roles.js";
import { addressSchema } from "../src/lib/schemas/primitives.js";

const readJson = async (path: string) =>
  JSON.parse(await readFile(path, "utf8"));

async function main(): Promise<void> {
  const rpc = process.env.RPC_URL;
  if (!rpc) throw new Error("RPC_URL is missing");
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check-signers"))
    throw new Error("Unsupported argument");
  const roles = demoRolesSchema.parse(
    await readJson("contracts/deployments/demo-roles.11155111.json"),
  );
  const participantManifest = z
    .strictObject({
      schemaVersion: z.literal(1),
      chainId: z.literal(11155111),
      mode: z.literal("single-operator-demo"),
      participants: z
        .array(z.strictObject({ persona: z.string(), address: addressSchema }))
        .length(6),
    })
    .parse(
      await readJson("contracts/deployments/demo-participants.11155111.json"),
    );
  const participants = participantManifest.participants;
  if (new Set(participants.map((p) => p.address.toLowerCase())).size !== 6)
    throw new Error("Duplicate participants");
  const deployment = await readJson("contracts/deployments/11155111.json");
  if (deployment.chainId !== sepolia.id)
    throw new Error("Deployment chain mismatch");
  const token = addressSchema.parse(deployment.mockUSDC.address);
  const escrow = addressSchema.parse(deployment.convergeGroupWallet.address);
  assertSeparateDemoRoles(roles, [
    ...participants.map((p) => p.address),
    deployment.deployer,
    token,
    escrow,
  ]);
  if (process.env.CHAIN_ID && process.env.CHAIN_ID !== String(sepolia.id))
    throw new Error("CHAIN_ID mismatch");
  for (const [name, expected] of [
    ["MOCK_USDC_ADDRESS", token],
    ["GROUP_WALLET_ADDRESS", escrow],
  ] as const) {
    if (
      process.env[name] &&
      process.env[name]!.toLowerCase() !== expected.toLowerCase()
    )
      throw new Error("Configured contract address mismatch");
  }
  const client = createPublicClient({
    chain: sepolia,
    transport: http(rpc, { timeout: 15_000, retryCount: 2 }),
  });
  if ((await client.getChainId()) !== sepolia.id)
    throw new Error("RPC chain mismatch");
  if (
    (await client.getBlock({ blockNumber: 0n })).hash !==
    "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
  )
    throw new Error("RPC genesis mismatch");
  const block = await client.getBlock();
  const blockNumber = block.number;
  for (const [address, expectedHash] of [
    [token, deployment.mockUSDC.deployedCodeHash],
    [escrow, deployment.convergeGroupWallet.deployedCodeHash],
  ] as const) {
    const code = await client.getBytecode({ address, blockNumber });
    if (!code || keccak256(code) !== expectedHash)
      throw new Error("Deployed bytecode mismatch");
  }
  const tokenAbi = (await readJson("src/lib/abi/mockUSDC.json")) as Abi;
  const walletAbi = (await readJson(
    "src/lib/abi/convergeGroupWallet.json",
  )) as Abi;
  const minter = await client.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "minter",
    blockNumber,
  });
  const decimals = await client.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "decimals",
    blockNumber,
  });
  const configuredToken = await client.readContract({
    address: escrow,
    abi: walletAbi,
    functionName: "token",
    blockNumber,
  });
  if (
    String(minter).toLowerCase() !== deployment.deployer.toLowerCase() ||
    Number(decimals) !== 6 ||
    String(configuredToken).toLowerCase() !== token.toLowerCase()
  )
    throw new Error("Contract configuration mismatch");
  const balances: {
    persona: string;
    address: Address;
    ethWei: string;
    mockUSDCBaseUnits: string;
  }[] = [];
  for (const participant of participants) {
    const eth = await client.getBalance({
      address: participant.address,
      blockNumber,
    });
    const tokens = (await client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [participant.address],
      blockNumber,
    })) as bigint;
    if (eth === 0n || tokens < 10_000_000n)
      throw new Error(
        "Participant needs gas or a 10 MockUSDC contribution balance",
      );
    balances.push({
      ...participant,
      ethWei: eth.toString(),
      mockUSDCBaseUnits: tokens.toString(),
    });
    process.stdout.write(
      `${participant.persona}: ${formatEther(eth)} ETH, ${formatUnits(tokens, 6)} MockUSDC\n`,
    );
  }
  const executorBalance = await client.getBalance({
    address: roles.executor,
    blockNumber,
  });
  if (executorBalance === 0n) throw new Error("Executor needs gas");
  const signersChecked = args.includes("--check-signers");
  if (signersChecked) {
    const accounts = [
      { key: "AGENT_EXECUTOR_PRIVATE_KEY", address: roles.executor },
      ...participants.map((p, index) => ({
        key: `DEMO_PARTICIPANT_${index + 1}_PRIVATE_KEY`,
        address: p.address,
      })),
    ];
    for (const account of accounts) {
      const key = process.env[account.key];
      if (!key || privateKeyToAccount(key as Hex).address !== account.address)
        throw new Error("Local signer does not match the public account");
    }
  }
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/sepolia-preflight.json",
    `${JSON.stringify(
      {
        schemaVersion: 1,
        scope: "blockchain-setup-only",
        chainId: sepolia.id,
        checkedAt: new Date().toISOString(),
        blockNumber: blockNumber.toString(),
        blockHash: block.hash,
        token,
        escrow,
        executor: roles.executor,
        executorEthWei: executorBalance.toString(),
        merchants: roles.merchants,
        participants: balances,
        localSignersChecked: signersChecked,
        status: "passed",
        limitation:
          "Gas balances are nonzero; actual gas costs must be estimated before each transaction. This is not an application or Kiln acceptance run.",
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `Blockchain setup passed at block ${blockNumber}; executor ${formatEther(executorBalance)} ETH; local signers checked: ${signersChecked}\n`,
  );
}

main().catch(() => {
  process.stderr.write(
    "Blockchain preflight failed. Check configuration, balances, network, and optional local signers. No transactions were submitted.\n",
  );
  process.exitCode = 1;
});
