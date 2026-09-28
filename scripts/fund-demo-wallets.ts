import { readFile, writeFile } from "node:fs/promises";
import {
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

type Participant = { persona: string; address: Address };
type Funding = Participant & { ethTransaction?: Hex; mintTransaction?: Hex };
const rpcUrl = process.env.RPC_URL;
const key = process.env.DEPLOYER_PRIVATE_KEY;
const ethAmount = parseEther("0.001");
const tokenAmount = 30_000_000n;
const recordPath = "contracts/deployments/demo-funding.11155111.json";

async function main(): Promise<void> {
  if (!rpcUrl || !key || !/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new Error("Missing local deployment configuration");
  const account = privateKeyToAccount(key as Hex);
  const transport = http(rpcUrl, { timeout: 15_000, retryCount: 2 });
  const client = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  if ((await client.getChainId()) !== sepolia.id)
    throw new Error("Unexpected chain");
  if (
    (await client.getBlock({ blockNumber: 0n })).hash !==
    "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
  )
    throw new Error("Unexpected genesis");
  const manifest = JSON.parse(
    await readFile(
      "contracts/deployments/demo-participants.11155111.json",
      "utf8",
    ),
  ) as { chainId: number; participants: Participant[] };
  if (manifest.chainId !== sepolia.id || manifest.participants.length !== 6)
    throw new Error("Invalid participants");
  for (const [index, participant] of manifest.participants.entries()) {
    const participantKey =
      process.env[`DEMO_PARTICIPANT_${index + 1}_PRIVATE_KEY`];
    if (
      !participantKey ||
      privateKeyToAccount(participantKey as Hex).address !== participant.address
    )
      throw new Error("Local participant key does not match public manifest");
  }
  if (
    new Set(manifest.participants.map((p) => p.address.toLowerCase())).size !==
    6
  )
    throw new Error("Duplicate participants");
  const deployment = JSON.parse(
    await readFile("contracts/deployments/11155111.json", "utf8"),
  ) as { mockUSDC: { address: Address; deployedCodeHash: Hex } };
  const token = deployment.mockUSDC.address;
  const abi = JSON.parse(
    await readFile("src/lib/abi/mockUSDC.json", "utf8"),
  ) as Abi;
  const code = await client.getBytecode({ address: token });
  if (!code || keccak256(code) !== deployment.mockUSDC.deployedCodeHash)
    throw new Error("Unexpected token code");
  const minter = await client.readContract({
    address: token,
    abi,
    functionName: "minter",
  });
  if (String(minter).toLowerCase() !== account.address.toLowerCase())
    throw new Error("Wrong minter");
  let participants: Funding[] = manifest.participants.map((p) => ({ ...p }));
  const header = {
    schemaVersion: 1,
    chainId: sepolia.id,
    deployer: account.address,
    token,
    ethWeiPerParticipant: ethAmount.toString(),
    tokenBaseUnitsPerParticipant: tokenAmount.toString(),
  };
  try {
    const saved = JSON.parse(await readFile(recordPath, "utf8"));
    for (const [field, value] of Object.entries(header)) {
      if (saved[field] !== value)
        throw new Error("Funding record configuration mismatch");
    }
    if (
      JSON.stringify(
        saved.participants.map((p: Funding) => ({
          persona: p.persona,
          address: p.address,
        })),
      ) !== JSON.stringify(manifest.participants)
    )
      throw new Error("Funding record participant mismatch");
    participants = saved.participants;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const save = async () =>
    writeFile(
      recordPath,
      `${JSON.stringify({ ...header, participants }, null, 2)}\n`,
    );
  for (const participant of participants) {
    if (!participant.ethTransaction) {
      participant.ethTransaction = await wallet.sendTransaction({
        to: participant.address,
        value: ethAmount,
      });
      await save();
    }
    const ethReceipt = await client.waitForTransactionReceipt({
      hash: participant.ethTransaction,
      timeout: 120_000,
    });
    if (ethReceipt.status !== "success")
      throw new Error("Gas funding transaction failed; inspect the saved hash");
    const tx = await client.getTransaction({
      hash: participant.ethTransaction,
    });
    if (
      tx.from.toLowerCase() !== account.address.toLowerCase() ||
      tx.to?.toLowerCase() !== participant.address.toLowerCase() ||
      tx.value !== ethAmount ||
      tx.input !== "0x"
    )
      throw new Error("Gas funding transaction mismatch");
    process.stdout.write(
      `${participant.persona} ETH confirmed: ${participant.ethTransaction}\n`,
    );
    if (!participant.mintTransaction) {
      const { request } = await client.simulateContract({
        account,
        address: token,
        abi,
        functionName: "mint",
        args: [participant.address, tokenAmount],
      });
      participant.mintTransaction = await wallet.writeContract(request);
      await save();
    }
    const mintReceipt = await client.waitForTransactionReceipt({
      hash: participant.mintTransaction,
      timeout: 120_000,
    });
    if (mintReceipt.status !== "success")
      throw new Error("Mint transaction failed; inspect the saved hash");
    const minted = mintReceipt.logs.some((log) => {
      if (log.address.toLowerCase() !== token.toLowerCase()) return false;
      try {
        const event = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        });
        const args = event.args as unknown as {
          from: Address;
          to: Address;
          value: bigint;
        };
        return (
          event.eventName === "Transfer" &&
          args.from === "0x0000000000000000000000000000000000000000" &&
          args.to.toLowerCase() === participant.address.toLowerCase() &&
          args.value === tokenAmount
        );
      } catch {
        return false;
      }
    });
    if (!minted)
      throw new Error("Mint receipt is missing the expected Transfer event");
    const mintTx = await client.getTransaction({
      hash: participant.mintTransaction,
    });
    const expected = encodeFunctionData({
      abi,
      functionName: "mint",
      args: [participant.address, tokenAmount],
    });
    if (
      mintTx.from.toLowerCase() !== account.address.toLowerCase() ||
      mintTx.to?.toLowerCase() !== token.toLowerCase() ||
      mintTx.input !== expected ||
      mintTx.value !== 0n
    )
      throw new Error("Mint transaction mismatch");
    const tokenBalance = await client.readContract({
      address: token,
      abi,
      functionName: "balanceOf",
      args: [participant.address],
    });
    const ethBalance = await client.getBalance({
      address: participant.address,
    });
    process.stdout.write(
      `${participant.persona} mint confirmed: ${participant.mintTransaction}; balances: ${ethBalance} wei, ${String(tokenBalance)} token units\n`,
    );
  }
  process.stdout.write(
    `All six allocations verified. Public record: ${recordPath}\n`,
  );
}

main().catch(() => {
  process.stderr.write(
    "Demo funding stopped. Inspect the public funding record and local configuration before resuming; recorded transactions will be reused.\n",
  );
  process.exitCode = 1;
});
