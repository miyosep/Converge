import { z } from "zod";
import type { RestaurantCatalog } from "./schemas/decision.js";

import { RESTAURANT_IDS } from "./restaurant-options.js";
export { RESTAURANT_IDS };
export const permittedRestaurantIdsSchema = z
  .array(z.enum(RESTAURANT_IDS))
  .min(1)
  .max(RESTAURANT_IDS.length)
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
