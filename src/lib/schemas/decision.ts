import { z } from "zod";
import { extractionSchema } from "./constraints.js";
import {
  addressSchema,
  centsSchema,
  idSchema,
  timeZoneSchema,
  tokenAmountSchema,
  utcTimestampSchema,
} from "./primitives.js";
import { participantAddressesSchema } from "./shared.js";

export const reservationSlotSchema = z.strictObject({
  startsAt: utcTimestampSchema,
  timeZone: timeZoneSchema,
});
const safety = z.enum(["supported", "unsupported", "unknown"]);
export const restaurantSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(80),
  merchant: addressSchema,
  currency: z.literal("USD"),
  mealPricePerPersonCents: centsSchema,
  depositBaseUnits: tokenAmountSchema.refine((value) => BigInt(value) > 0n),
  depositCreditedToMeal: z.literal(true),
  available: z.boolean(),
  reservationSlots: z.array(utcTimestampSchema).min(1).max(100),
  shellfishSafe: safety,
  wheelchairAccessible: safety,
  dietary: z.strictObject({
    vegetarian: safety,
    vegan: safety,
    halal: safety,
    gluten_free: safety,
  }),
  subwayDistanceMeters: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  quiet: z.number().int().min(0).max(100),
  atmosphere: z.number().int().min(0).max(100),
});
export const restaurantCatalogSchema = z
  .strictObject({
    fixtureVersion: z.enum(["restaurants-v1", "restaurants-v2"]),
    synthetic: z.literal(true),
    restaurants: z.array(restaurantSchema).min(1).max(100),
  })
  .superRefine((catalog, context) => {
    for (const field of ["id", "merchant"] as const) {
      const values = catalog.restaurants.map((candidate) =>
        candidate[field].toLowerCase(),
      );
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: "custom",
          message: `Duplicate candidate ${field}`,
        });
    }
  });
export const preferenceRevisionSchema = z.strictObject({
  participant: addressSchema,
  revisionId: idSchema,
  confirmedRevisionId: idSchema.nullable(),
  extraction: extractionSchema,
});
export const evaluationInputSchema = z
  .strictObject({
    members: participantAddressesSchema,
    preferences: z.array(preferenceRevisionSchema).length(6),
    slot: reservationSlotSchema,
    permittedMerchants: z.array(addressSchema).max(100),
    contributionPerParticipant: tokenAmountSchema.refine(
      (value) => BigInt(value) > 0n,
    ),
    maxDeposit: tokenAmountSchema,
    maxTotalSpend: tokenAmountSchema,
    catalog: restaurantCatalogSchema,
  })
  .superRefine((input, context) => {
    const members = new Set(
      input.members.map((address) => address.toLowerCase()),
    );
    const preferences = input.preferences.map((revision) =>
      revision.participant.toLowerCase(),
    );
    if (
      new Set(preferences).size !== 6 ||
      preferences.some((address) => !members.has(address))
    ) {
      context.addIssue({
        code: "custom",
        path: ["preferences"],
        message: "One revision from every group member is required",
      });
    }
    const funding = BigInt(input.contributionPerParticipant) * 6n;
    if (
      funding >= 1n << 256n ||
      BigInt(input.maxDeposit) > BigInt(input.maxTotalSpend) ||
      BigInt(input.maxTotalSpend) > funding
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid funding or spending limits",
      });
    }
  });
export type Restaurant = z.infer<typeof restaurantSchema>;
export type RestaurantCatalog = z.infer<typeof restaurantCatalogSchema>;
export type EvaluationInput = z.infer<typeof evaluationInputSchema>;
