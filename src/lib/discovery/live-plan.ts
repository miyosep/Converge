import { z } from "zod";
import type {
  DiscoveryResult,
  DiscoveredPlace,
  DiscoveryCategory,
} from "./types.js";
import { groupSizeSchema } from "../group-size.js";
import { reservationSlotSchema } from "../schemas/decision.js";

const livePlanDetails = {
  requestId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(80),
  targetMemberCount: groupSizeSchema,
  slot: reservationSlotSchema,
};

export const livePlanRequestSchema = z
  .union([
    z.strictObject({
      ...livePlanDetails,
      depositUsdc: z.number().int().min(1).max(60), // Accepted from older clients, never used for payment.
      acknowledgeDemo: z.literal(true),
      searchId: z.string().uuid(),
      placeIds: z
        .array(z.string().min(1).max(100))
        .min(1)
        .max(5)
        .refine((ids) => new Set(ids).size === ids.length),
    }),
    z.strictObject({
      ...livePlanDetails,
      category: z.enum(["restaurant", "stay", "space", "sport", "class"]),
      location: z.string().trim().min(2).max(160),
      initialPreferences: z.string().trim().max(2000).default(""),
    }),
  ])
  .refine(
    (input) =>
      !("depositUsdc" in input) ||
      input.depositUsdc <= input.targetMemberCount * 10,
    "Deposit exceeds the group's contributions",
  );

export type LivePlan = {
  testPayment?: boolean;
  recommendationReady?: boolean;
  recommendationRevision?: string;
  conflicts?: string[];
  category: DiscoveryCategory;
  places: DiscoveredPlace[];
  intent: DiscoveryResult["intent"];
  source: DiscoveryResult["source"];
  searchedAt: string;
  depositUsdc?: number | null; // Historical plans only; never a venue quote.
  merchant?: `0x${string}` | null;
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
