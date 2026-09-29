import { z } from "zod";
import { FACILITIES } from "../catalog-options.js";
import { CONSTRAINT_SCHEMA_VERSION } from "../constants.js";
import {
  centsSchema,
  timeZoneSchema,
  utcTimestampSchema,
} from "./primitives.js";

export const constraintSchema = z.union([
  z.strictObject({
    type: z.literal("hard"),
    field: z.literal("minimum_beds"),
    operator: z.literal("gte"),
    value: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    type: z.literal("non_negotiable"),
    field: z.literal("facility_requirement"),
    value: z.enum(FACILITIES),
  }),
  z.strictObject({
    type: z.literal("hard"),
    field: z.literal("budget_per_person_cents"),
    operator: z.literal("lte"),
    value: centsSchema,
  }),
  z.strictObject({
    type: z.literal("hard"),
    field: z.literal("subway_distance_meters"),
    operator: z.literal("lte"),
    value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    type: z.literal("hard"),
    field: z.literal("reservation_slot"),
    operator: z.literal("eq"),
    value: z.strictObject({
      startsAt: utcTimestampSchema,
      timeZone: timeZoneSchema,
    }),
  }),
  z.strictObject({
    type: z.literal("non_negotiable"),
    field: z.enum(["shellfish_safe", "wheelchair_accessible"]),
    value: z.literal(true),
  }),
  z.strictObject({
    type: z.literal("non_negotiable"),
    field: z.literal("dietary_requirement"),
    value: z.enum(["vegetarian", "vegan", "halal", "gluten_free"]),
  }),
  z.strictObject({
    type: z.literal("soft"),
    field: z.enum(["quiet", "atmosphere", "subway_proximity"]),
    weight: z.number().min(0).max(1),
  }),
]);

export const extractionSchema = z
  .strictObject({
    schemaVersion: z.literal(CONSTRAINT_SCHEMA_VERSION),
    constraints: z.array(constraintSchema).max(32),
    clarifications: z.array(z.string().min(1).max(500)).max(8),
    unsupportedRequirements: z.array(z.string().min(1).max(500)).max(16),
  })
  .superRefine((value, context) => {
    const keys = new Set<string>();
    value.constraints.forEach((constraint, index) => {
      const key =
        constraint.field === "dietary_requirement" ||
        constraint.field === "facility_requirement"
          ? `${constraint.field}:${constraint.value}`
          : constraint.field;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["constraints", index],
          message: "Duplicate condition requires resolution",
        });
      }
      keys.add(key);
    });
  });

export type Constraint = z.infer<typeof constraintSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
