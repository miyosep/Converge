import { z } from "zod";
import type { RestaurantCatalog } from "./schemas/decision.js";

import { RESTAURANT_IDS } from "./restaurant-options.js";
import { catalogOptions, categoryForIds } from "./catalog-options.js";
export { RESTAURANT_IDS };
export const permittedRestaurantIdsSchema = z
  .array(
    z
      .string()
      .refine(
        (id) => catalogOptions.some((option) => option.id === id),
        "Unknown candidate",
      ),
  )
  .min(1)
  .max(RESTAURANT_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate candidate")
  .refine(
    (ids) =>
      ids.every((id) =>
        catalogOptions.some(
          (option) =>
            option.id === id && option.category === categoryForIds(ids),
        ),
      ),
    "Choose candidates from one category",
  );

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
