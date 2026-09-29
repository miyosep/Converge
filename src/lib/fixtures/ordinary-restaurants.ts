import { getAddress, keccak256, stringToHex } from "viem";
import type { DemoRoles } from "../demo-roles.js";
import { restaurantCatalogSchema } from "../schemas/decision.js";
import { restaurantOptions } from "../restaurant-options.js";
import { createRestaurantCatalog } from "./restaurants.js";

export function createOrdinaryRestaurantCatalog(
  roles: DemoRoles,
  slots: string[],
) {
  const baseline = createRestaurantCatalog(roles, slots);
  return restaurantCatalogSchema.parse({
    fixtureVersion: "restaurants-v3",
    synthetic: true,
    restaurants: restaurantOptions.map((option, index) => {
      const existing = baseline.restaurants.find((r) => r.id === option.id);
      if (existing)
        return {
          ...existing,
          name: option.name,
          cuisine: option.cuisine,
          area: option.area,
        };
      // Receipt-only mock merchant addresses. These are not real restaurant accounts.
      const merchant = getAddress(
        `0x${keccak256(stringToHex(`converge:synthetic-merchant:${option.id}:v3`)).slice(-40)}`,
      );
      return {
        id: option.id,
        name: option.name,
        cuisine: option.cuisine,
        area: option.area,
        merchant,
        currency: "USD",
        mealPricePerPersonCents: option.price * 100,
        depositBaseUnits: String(option.deposit * 1_000_000),
        depositCreditedToMeal: true,
        available: true,
        reservationSlots: slots,
        shellfishSafe: ["I", "K", "L", "Q", "T"].includes(option.id)
          ? "supported"
          : "unknown",
        subwayDistanceMeters: 200 + (index % 5) * 100,
        quiet: 45 + (index % 5) * 5,
        atmosphere: 60 + (index % 4) * 5,
        wheelchairAccessible: ["H", "L", "Q", "T"].includes(option.id)
          ? "supported"
          : "unknown",
        dietary: {
          vegetarian: ["H", "I", "K", "L", "Q"].includes(option.id)
            ? "supported"
            : "unknown",
          vegan: option.id === "L" ? "supported" : "unknown",
          halal: ["I", "K"].includes(option.id) ? "supported" : "unknown",
          gluten_free: option.id === "Q" ? "supported" : "unknown",
        },
      };
    }),
  });
}
