import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  type Abi,
  type Address,
  type PublicClient,
} from "viem";
import tokenJson from "./abi/mockUSDC.json";
import {
  hashPolicy,
  policySchema,
  toContractPolicy,
  policyWalletAbi,
} from "./signing-policy.js";
import type { GroupPolicyConfig, SigningPolicy } from "./group-policy.js";

const tokenAbi = tokenJson as Abi;
export type GroupChainState = {
  policyHash: string;
  blockNumber: string;
  timestamp: number;
  registered: boolean;
  status: number | null;
  approvals: number;
  contributed: string;
  spent: string;
  refunded: string;
  members: { address: Address; contribution: string }[];
  actor: Address;
  balance: string;
  allowance: string;
  refund: string;
};
export type GroupChainAction =
  "register" | "allowance" | "contribute" | "cancel" | "refund";

export function verifyGroupSigningPolicy(
  saved: SigningPolicy,
  config: GroupPolicyConfig,
  actor: string,
) {
  const policy = policySchema.parse(saved.policy);
  if (hashPolicy(policy) !== saved.policyHash)
    throw new Error("POLICY_HASH_MISMATCH");
  if (
    policy.chainId !== config.chainId ||
    policy.policyVersion !== (config.policyVersion ?? 1) ||
    (["verifyingContract", "token", "executor"] as const).some(
      (key) => policy[key].toLowerCase() !== config[key].toLowerCase(),
    )
  )
    throw new Error("WRONG_DEPLOYMENT");
  if (
    !policy.participants.some(
      (member) => member.toLowerCase() === actor.toLowerCase(),
    )
  )
    throw new Error("NOT_POLICY_PARTICIPANT");
  return policy;
}

// Reads one canonical block. Provider errors must never look like an unregistered decision.
export async function readGroupChain(
  client: PublicClient,
  saved: SigningPolicy,
  config: GroupPolicyConfig,
  actor: Address,
  confirmations = 2,
  atBlock?: bigint,
): Promise<GroupChainState> {
  const policy = verifyGroupSigningPolicy(saved, config, actor);
  const walletAbi = policyWalletAbi(policy);
  if ((await client.getChainId()) !== policy.chainId)
    throw new Error("WRONG_CHAIN");
  const height = await client.getBlockNumber({ cacheTime: 0 });
  const safeHeight = height - BigInt(confirmations - 1);
  const blockNumber = atBlock ?? safeHeight;
  if (blockNumber < 0n || blockNumber > safeHeight)
    throw new Error("UNCONFIRMED_SNAPSHOT_BLOCK");
  const block = await client.getBlock({ blockNumber });
  const read = (
    address: Address,
    abi: Abi,
    functionName: string,
    args: unknown[] = [],
  ) => client.readContract({ address, abi, functionName, args, blockNumber });
  const token = (await read(
    policy.verifyingContract,
    walletAbi,
    "token",
  )) as Address;
  if (token.toLowerCase() !== policy.token.toLowerCase())
    throw new Error("WRONG_TOKEN");
  let decision:
    readonly [string, number, bigint, bigint, bigint, bigint] | undefined;
  try {
    decision = (await read(policy.verifyingContract, walletAbi, "getDecision", [
      policy.decisionId,
    ])) as typeof decision;
  } catch (error) {
    const reverted =
      error instanceof BaseError
        ? error.walk((e) => e instanceof ContractFunctionRevertedError)
        : undefined;
    if (
      !(reverted instanceof ContractFunctionRevertedError) ||
      reverted.data?.errorName !== "UnknownDecision"
    )
      throw error;
  }
  if (decision && decision[0] !== saved.policyHash)
    throw new Error("CHAIN_POLICY_MISMATCH");
  const [balance, allowance, refund, members] = await Promise.all([
    read(policy.token, tokenAbi, "balanceOf", [actor]) as Promise<bigint>,
    read(policy.token, tokenAbi, "allowance", [
      actor,
      policy.verifyingContract,
    ]) as Promise<bigint>,
    decision
      ? (read(policy.verifyingContract, walletAbi, "refundEntitlement", [
          policy.decisionId,
          actor,
        ]) as Promise<bigint>)
      : Promise.resolve(0n),
    Promise.all(
      policy.participants.map(async (address) => ({
        address,
        contribution: String(
          decision
            ? await read(
                policy.verifyingContract,
                walletAbi,
                "contributionOf",
                [policy.decisionId, address],
              )
            : 0n,
        ),
      })),
    ),
  ]);
  if ((await client.getBlock({ blockNumber })).hash !== block.hash)
    throw new Error("CHAIN_REORGANIZED");
  return {
    policyHash: saved.policyHash,
    blockNumber: String(blockNumber),
    timestamp: Number(block.timestamp),
    registered: !!decision,
    status: decision?.[1] ?? null,
    approvals: Number(decision?.[2] ?? 0n),
    contributed: String(decision?.[3] ?? 0n),
    spent: String(decision?.[4] ?? 0n),
    refunded: String(decision?.[5] ?? 0n),
    members,
    actor,
    balance: String(balance),
    allowance: String(allowance),
    refund: String(refund),
  };
}

export function groupChainTransaction(
  saved: SigningPolicy,
  config: GroupPolicyConfig,
  actor: Address,
  state: GroupChainState,
  action: GroupChainAction,
) {
  const policy = verifyGroupSigningPolicy(saved, config, actor);
  const walletAbi = policyWalletAbi(policy);
  if (
    state.policyHash !== saved.policyHash ||
    state.actor.toLowerCase() !== actor.toLowerCase()
  )
    throw new Error("STALE_CHAIN_STATE");
  const expired = state.timestamp >= policy.expiry;
  const contribution = state.members.find(
    (m) => m.address.toLowerCase() === actor.toLowerCase(),
  )?.contribution;
  let functionName: string;
  let args: unknown[];
  if (action === "register") {
    if (state.registered || expired)
      throw new Error("REGISTRATION_UNAVAILABLE");
    functionName = "createDecision";
    args = [toContractPolicy(policy)];
  } else {
    if (!state.registered) throw new Error("DECISION_NOT_REGISTERED");
    if (action === "refund") {
      if (BigInt(state.refund) <= 0n) throw new Error("REFUND_UNAVAILABLE");
      functionName = "claimRefund";
      args = [policy.decisionId];
    } else if (action === "cancel") {
      if (state.status !== 0 && state.status !== 1)
        throw new Error("CANCELLATION_UNAVAILABLE");
      functionName = "cancelDecision";
      args = [policy.decisionId];
    } else {
      if (expired || state.status !== 0 || contribution !== "0")
        throw new Error("CONTRIBUTION_UNAVAILABLE");
      if (BigInt(state.balance) < BigInt(policy.contributionPerParticipant))
        throw new Error("INSUFFICIENT_MOCKUSDC");
      if (action === "allowance") {
        if (
          BigInt(state.allowance) >= BigInt(policy.contributionPerParticipant)
        )
          throw new Error("ALLOWANCE_ALREADY_SUFFICIENT");
        functionName = "approve";
        args = [
          policy.verifyingContract,
          BigInt(policy.contributionPerParticipant),
        ];
      } else {
        if (BigInt(state.allowance) < BigInt(policy.contributionPerParticipant))
          throw new Error("ALLOWANCE_REQUIRED");
        functionName = "approveAndContribute";
        args = [policy.decisionId, saved.policyHash];
      }
    }
  }
  return {
    to: action === "allowance" ? policy.token : policy.verifyingContract,
    data: encodeFunctionData({
      abi: action === "allowance" ? tokenAbi : walletAbi,
      functionName,
      args,
    }),
  };
}
