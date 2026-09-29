import { demoRolesSchema, type DemoRoles } from "../demo-roles.js";
import {
  restaurantCatalogSchema,
  type RestaurantCatalog,
} from "../schemas/decision.js";

export function createRestaurantCatalog(
  input: DemoRoles,
  reservationSlots: string[],
): RestaurantCatalog {
  const roles = demoRolesSchema.parse(input);
  const rows = [
    {
      id: "A",
      mealPricePerPersonCents: 3200,
      depositBaseUnits: "45000000",
      shellfishSafe: "unknown",
      subwayDistanceMeters: 150,
      quiet: 90,
      atmosphere: 95,
      available: true,
    },
    {
      id: "B",
      mealPricePerPersonCents: 2400,
      depositBaseUnits: "36000000",
      shellfishSafe: "supported",
      subwayDistanceMeters: 300,
      quiet: 70,
      atmosphere: 70,
      available: true,
    },
    {
      id: "C",
      mealPricePerPersonCents: 2200,
      depositBaseUnits: "30000000",
      shellfishSafe: "unsupported",
      subwayDistanceMeters: 100,
      quiet: 80,
      atmosphere: 85,
      available: false,
    },
    {
      id: "D",
      mealPricePerPersonCents: 2800,
      depositBaseUnits: "42000000",
      shellfishSafe: "supported",
      subwayDistanceMeters: 900,
      quiet: 50,
      atmosphere: 60,
      available: true,
    },
    {
      id: "E",
      mealPricePerPersonCents: 3000,
      depositBaseUnits: "45000000",
      shellfishSafe: "unknown",
      subwayDistanceMeters: 200,
      quiet: 85,
      atmosphere: 90,
      available: false,
    },
  ] as const;
  return restaurantCatalogSchema.parse({
    fixtureVersion: "restaurants-v2",
    synthetic: true,
    restaurants: rows.map((row) => ({
      ...row,
      name: row.id === "A" ? "KAGAMI" : `Restaurant ${row.id}`,
      merchant: roles.merchants[row.id],
      currency: "USD",
      depositCreditedToMeal: true,
      reservationSlots,
      wheelchairAccessible: "unknown",
      dietary: {
        vegetarian: "unknown",
        vegan: "unknown",
        halal: "unknown",
        gluten_free: "unknown",
      },
    })),
  });
}
