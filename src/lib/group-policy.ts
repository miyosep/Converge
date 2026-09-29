import { keccak256, stringToHex } from "viem";
import { evaluateDecision } from "./decision-engine.js";
import { evaluationInputSchema } from "./schemas/decision.js";
import { hashPolicy, policySchema, type Policy } from "./policy.js";

export class GroupPolicyError extends Error {
  constructor(
    public readonly code:
      "NO_PROPOSAL" | "STALE_EVALUATION" | "RESERVATION_PASSED",
  ) {
    super(code);
  }
}

export type GroupPolicyConfig = Pick<
  Policy,
  "chainId" | "verifyingContract" | "token" | "executor"
>;
export type SigningPolicy = {
  policy: Policy;
  policyHash: string;
  createdAt: string;
};

export function buildGroupPolicy(input: {
  groupId: string;
  evaluationId: string;
  decisionNonce: string;
  snapshot: unknown;
  expectedWinner: string | null;
  config: GroupPolicyConfig;
  nowSeconds: number;
}): SigningPolicy {
  const snapshot = evaluationInputSchema.parse(input.snapshot);
  const result = evaluateDecision(snapshot);
  if (result.status !== "PROPOSAL_READY" || !result.winnerId)
    throw new GroupPolicyError("NO_PROPOSAL");
  if (result.winnerId !== input.expectedWinner)
    throw new GroupPolicyError("STALE_EVALUATION");
  const restaurant = snapshot.catalog.restaurants.find(
    (entry) => entry.id === result.winnerId,
  )!;
  const reservationTime = Math.floor(Date.parse(snapshot.slot.startsAt) / 1000);
  const expiry = Math.min(input.nowSeconds + 3600, reservationTime);
  if (expiry <= input.nowSeconds + 60)
    throw new GroupPolicyError("RESERVATION_PASSED");
  const policy = policySchema.parse({
    ...input.config,
    policyVersion: 1,
    decisionId: keccak256(
      stringToHex(
        `group:${input.groupId}:${input.evaluationId}:${input.decisionNonce}`,
      ),
    ),
    merchant: restaurant.merchant,
    participants: snapshot.members,
    approvalThreshold: 6,
    contributionPerParticipant: snapshot.contributionPerParticipant,
    paymentAmount: restaurant.depositBaseUnits,
    maxDeposit: snapshot.maxDeposit,
    maxTotalSpend: snapshot.maxTotalSpend,
    expiry,
    reservationReference: keccak256(
      stringToHex(
        `reservation:${input.groupId}:${input.evaluationId}:${snapshot.slot.startsAt}`,
      ),
    ),
  });
  return {
    policy,
    policyHash: hashPolicy(policy),
    createdAt: new Date(input.nowSeconds * 1000).toISOString(),
  };
}
