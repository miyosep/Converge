import { z } from "zod";
import { keccak256, stringToHex } from "viem";
import type {
  DiscoveryResult,
  DiscoveredPlace,
  DiscoveryCategory,
} from "./types.js";
import { groupSizeSchema, groupMembersSchema } from "../group-size.js";
import { reservationSlotSchema } from "../schemas/decision.js";
import { policySchema, hashPolicy } from "../signing-policy.js";
import type { GroupPolicyConfig } from "../group-policy.js";

export const livePlanRequestSchema = z
  .strictObject({
    requestId: z.string().uuid(),
    searchId: z.string().uuid(),
    placeIds: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(5)
      .refine((ids) => new Set(ids).size === ids.length),
    name: z.string().trim().min(1).max(100),
    displayName: z.string().trim().min(1).max(80),
    targetMemberCount: groupSizeSchema,
    depositUsdc: z.number().int().min(1).max(60),
    slot: reservationSlotSchema,
    acknowledgeDemo: z.literal(true),
  })
  .refine(
    (input) => input.depositUsdc <= input.targetMemberCount * 10,
    "Deposit exceeds the group's contributions",
  );

export type LivePlan = {
  recommendationReady?: boolean;
  recommendationRevision?: string;
  conflicts?: string[];
  category: DiscoveryCategory;
  places: DiscoveredPlace[];
  intent: DiscoveryResult["intent"];
  source: DiscoveryResult["source"];
  searchedAt: string;
  depositUsdc: number;
  merchant: `0x${string}`;
  votes: Record<string, string>;
};

export function unanimousPlace(
  plan: LivePlan,
  members: string[],
  target: number,
) {
  if (
    members.length !== target ||
    new Set(members.map((member) => member.toLowerCase())).size !== target
  )
    return undefined;
  const choice = plan.votes[members[0]!.toLowerCase()];
  return choice &&
    members.every((member) => plan.votes[member.toLowerCase()] === choice)
    ? plan.places.find((place) => place.id === choice)
    : undefined;
}

export function buildLiveGroupPolicy(input: {
  groupId: string;
  plan: LivePlan;
  members: string[];
  target: number;
  slot: { startsAt: string; timeZone: string };
  config: GroupPolicyConfig;
  nowSeconds: number;
}) {
  const participants = groupMembersSchema.parse(input.members);
  if (!input.plan.recommendationReady || !input.plan.recommendationRevision)
    throw new Error("PREFERENCES_NOT_CONFIRMED");
  const place = unanimousPlace(input.plan, participants, input.target);
  if (!place) throw new Error("UNANIMOUS_CHOICE_REQUIRED");
  const expiry = Math.min(
    input.nowSeconds + 3600,
    Math.floor(Date.parse(input.slot.startsAt) / 1000),
  );
  if (!Number.isFinite(expiry) || expiry <= input.nowSeconds + 60)
    throw new Error("RESERVATION_PASSED");
  const amount = String(BigInt(input.plan.depositUsdc) * 1_000_000n);
  const policy = policySchema.parse({
    ...input.config,
    policyVersion: 2,
    decisionId: keccak256(stringToHex(`live-group:${input.groupId}`)),
    participants,
    approvalThreshold: participants.length,
    merchant: input.plan.merchant,
    contributionPerParticipant: "10000000",
    paymentAmount: amount,
    maxDeposit: amount,
    maxTotalSpend: amount,
    expiry,
    reservationReference: keccak256(
      stringToHex(
        JSON.stringify({
          groupId: input.groupId,
          recommendationRevision: input.plan.recommendationRevision,
          place,
          intent: input.plan.intent,
          source: input.plan.source,
          searchedAt: input.plan.searchedAt,
          slot: input.slot,
          merchant: input.plan.merchant,
          paymentAmount: amount,
        }),
      ),
    ),
  });
  return {
    policy,
    policyHash: hashPolicy(policy),
    createdAt: new Date(input.nowSeconds * 1000).toISOString(),
  };
}
