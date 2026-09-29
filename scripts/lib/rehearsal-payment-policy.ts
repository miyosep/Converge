// Test-only policy fixture for the disposable local EVM rehearsal.
import { keccak256, stringToHex } from "viem";
import { groupMembersSchema } from "../../src/lib/group-size.js";
import { policySchema, hashPolicy } from "../../src/lib/signing-policy.js";
import type { GroupPolicyConfig } from "../../src/lib/group-policy.js";
import {
  unanimousPlace,
  type LivePlan,
} from "../../src/lib/discovery/live-plan.js";

export function buildRehearsalPolicy(input: {
  groupId: string;
  plan: LivePlan & { depositUsdc: number; merchant: `0x${string}` };
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
