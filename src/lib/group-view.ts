import type { Evaluation } from "./decision-engine.js";
import { publicEvaluation } from "./decision-engine.js";
import type { RestaurantCatalog } from "./schemas/decision.js";
import type { SigningPolicy } from "./group-policy.js";
import type { Category } from "./catalog-options.js";

export type GroupSummary = {
  category?: Category;
  isCreator?: boolean;
  permittedRestaurantIds?: string[];
  id: string;
  name: string;
  startsAt: string;
  timeZone: string;
  locked: boolean;
  memberCount: number;
  targetMemberCount: number;
  confirmedCount: number;
};

// Only this projection may cross the shared group API boundary.
export function savedEvaluationView(input: {
  id: string;
  createdAt: string;
  result: Evaluation;
  catalog: RestaurantCatalog;
  contributionPerParticipant: string;
  maxDeposit: string;
  maxTotalSpend: string;
}) {
  return {
    id: input.id,
    createdAt: input.createdAt,
    ...publicEvaluation(input.result),
    syntheticCatalog: input.catalog.synthetic,
    catalog: input.catalog.restaurants.map((restaurant) => ({
      id: restaurant.id,
      name: restaurant.name,
      ...(restaurant.category ? { category: restaurant.category } : {}),
      ...(restaurant.priceUnit ? { priceUnit: restaurant.priceUnit } : {}),
      cuisine: restaurant.cuisine,
      area: restaurant.area,
      merchant: restaurant.merchant,
      mealPricePerPersonCents: restaurant.mealPricePerPersonCents,
      depositBaseUnits: restaurant.depositBaseUnits,
    })),
    terms: {
      contributionPerParticipant: input.contributionPerParticipant,
      maxDeposit: input.maxDeposit,
      maxTotalSpend: input.maxTotalSpend,
    },
  };
}

export type SavedEvaluation = ReturnType<typeof savedEvaluationView>;
export type GroupOverview = {
  livePlan?: import("./discovery/live-plan.js").LivePlan;
  group: GroupSummary;
  participants: {
    walletAddress: string;
    displayName: string;
    submitted: boolean;
    confirmed: boolean;
  }[];
  evaluation: SavedEvaluation | null;
  signingPolicy: SigningPolicy | null;
};

export function scorePercent(scoreMicros: number | null) {
  return scoreMicros === null ? "—" : (scoreMicros / 10_000).toFixed(1);
}
