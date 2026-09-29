import { getAddress, keccak256, stringToHex } from "viem";
import {
  categories,
  optionsForCategory,
  type Category,
} from "../catalog-options.js";
import type { DemoRoles } from "../demo-roles.js";
import { restaurantCatalogSchema } from "../schemas/decision.js";
import { createOrdinaryRestaurantCatalog } from "./ordinary-restaurants.js";

export function createOrdinaryCatalog(
  roles: DemoRoles,
  slots: string[],
  category: Category = "restaurant",
) {
  if (category === "restaurant")
    return createOrdinaryRestaurantCatalog(roles, slots);
  return restaurantCatalogSchema.parse({
    fixtureVersion: "venues-v1",
    synthetic: true,
    restaurants: optionsForCategory(category).map((option, index) => ({
      id: option.id,
      category,
      name: option.name,
      cuisine: option.kind,
      area: option.area,
      priceUnit: categories[category].priceUnit,
      merchant: getAddress(
        `0x${keccak256(stringToHex(`converge:synthetic-merchant:${option.id}:v1`)).slice(-40)}`,
      ),
      currency: "USD",
      mealPricePerPersonCents: option.price * 100,
      depositBaseUnits: String(option.deposit * 1_000_000),
      depositCreditedToMeal: true,
      capacity: option.capacity,
      beds: option.beds,
      facilities: option.facilities,
      available: true,
      reservationSlots: slots,
      wheelchairAccessible: option.wheelchairAccessible
        ? "supported"
        : "unknown",
      shellfishSafe: "unknown",
      dietary: {
        vegetarian: "unknown",
        vegan: "unknown",
        halal: "unknown",
        gluten_free: "unknown",
      },
      subwayDistanceMeters: 150 + (index % 7) * 150,
      quiet: 45 + (index % 6) * 8,
      atmosphere: 55 + (index % 5) * 9,
    })),
  });
}
