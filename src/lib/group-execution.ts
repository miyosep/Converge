import { encodeFunctionData, type Abi, type Hex } from "viem";
import abiJson from "./abi/convergeGroupWallet.json";
import {
  verifyGroupSigningPolicy,
  type GroupChainState,
} from "./group-chain.js";
import type { GroupPolicyConfig, SigningPolicy } from "./group-policy.js";

export type GroupChainEvent = {
  kind: string;
  hash: Hex;
  blockNumber: string;
  blockHash: Hex;
  logIndex: number;
  participant?: string;
  merchant?: string;
  amount?: string;
};
export type GroupHistory = {
  snapshot: {
    blockNumber: string;
    checkedAt: string;
    state: Pick<
      GroupChainState,
      "status" | "approvals" | "contributed" | "spent" | "refunded"
    >;
  } | null;
  events: GroupChainEvent[];
  execution: {
    hash: Hex;
    status: "pending" | "confirmed" | "reverted";
    errorCode: string | null;
    updatedAt: string;
  } | null;
};

export function groupPaymentIntent(
  saved: SigningPolicy,
  config: GroupPolicyConfig,
  state: GroupChainState,
  executor: string,
) {
  const policy = verifyGroupSigningPolicy(
    saved,
    config,
    saved.policy.participants[0]!,
  );
  if (executor.toLowerCase() !== policy.executor.toLowerCase())
    throw new Error("WRONG_EXECUTOR");
  if (
    state.policyHash !== saved.policyHash ||
    !state.registered ||
    state.status !== 1 ||
    state.approvals !== 6 ||
    state.timestamp >= policy.expiry ||
    BigInt(state.contributed) !==
      BigInt(policy.contributionPerParticipant) * 6n ||
    state.spent !== "0" ||
    state.members.length !== 6 ||
    !policy.participants.every((address) =>
      state.members.some(
        (member) =>
          member.address.toLowerCase() === address.toLowerCase() &&
          member.contribution === policy.contributionPerParticipant,
      ),
    )
  )
    throw new Error("PAYMENT_NOT_READY");
  return {
    chainId: policy.chainId,
    from: policy.executor,
    to: policy.verifyingContract,
    valueWei: "0",
    data: encodeFunctionData({
      abi: abiJson as Abi,
      functionName: "executePayment",
      args: [policy.decisionId, policy.merchant, BigInt(policy.paymentAmount)],
    }),
  };
}
