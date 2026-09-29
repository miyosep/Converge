import { z } from "zod";
import type { RestaurantCatalog } from "./schemas/decision.js";

export const RESTAURANT_IDS = ["A", "B", "C", "D", "E"] as const;
export const permittedRestaurantIdsSchema = z
  .array(z.enum(RESTAURANT_IDS))
  .min(1)
  .max(5)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate restaurant");

export function permittedGroupMerchants(
  ids: unknown,
  catalog: RestaurantCatalog,
  permittedMerchants: string[],
) {
  const allowed = permittedRestaurantIdsSchema.parse(ids);
  return catalog.restaurants
    .filter(
      (restaurant) =>
        allowed.some((id) => id === restaurant.id) &&
        permittedMerchants.some(
          (address) =>
            address.toLowerCase() === restaurant.merchant.toLowerCase(),
        ),
    )
    .map((restaurant) => restaurant.merchant);
}
