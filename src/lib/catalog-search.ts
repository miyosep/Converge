import { z } from "zod";
import {
  CATEGORY_IDS,
  FACILITIES,
  categories,
  optionsForCategory,
  facilityLabels,
  type Category,
} from "./catalog-options.js";

export const catalogSearchRequestSchema = z.strictObject({
  category: z.enum(CATEGORY_IDS),
  text: z.string().trim().min(1).max(2000),
});

// A separate search interpretation never confirms a member's booking requirements.
export const catalogSearchInterpretationSchema = z.strictObject({
  maxPricePerPerson: z.number().nonnegative().max(1_000_000).nullable(),
  minimumCapacity: z.number().int().min(1).max(100).nullable(),
  minimumBeds: z.number().int().min(1).max(100).nullable(),
  requiredFacilities: z.array(z.enum(FACILITIES)).max(8),
  excludedFacilities: z.array(z.enum(FACILITIES)).max(8),
  wheelchairAccessible: z.boolean(),
  names: z.array(z.string().min(1).max(100)).max(20),
  kinds: z.array(z.string().min(1).max(100)).max(20),
  areas: z.array(z.string().min(1).max(100)).max(20),
  clarifications: z.array(z.string().min(1).max(500)).max(8),
  unsupportedRequirements: z.array(z.string().min(1).max(500)).max(16),
});
export type CatalogSearchInterpretation = z.infer<
  typeof catalogSearchInterpretationSchema
>;
export type CatalogSearchResult = {
  ids: string[];
  conditions: string[];
  notices: string[];
};

export function matchCatalogSearch(
  category: Category,
  value: unknown,
): CatalogSearchResult {
  const query = catalogSearchInterpretationSchema.parse(value);
  const conditions: string[] = [];
  if (query.maxPricePerPerson !== null)
    conditions.push(
      `At most $${query.maxPricePerPerson.toFixed(2)} / ${categories[category].priceUnit}`,
    );
  if (query.minimumCapacity !== null)
    conditions.push(`Room for at least ${query.minimumCapacity} people`);
  if (query.minimumBeds !== null)
    conditions.push(`At least ${query.minimumBeds} beds`);
  conditions.push(...query.requiredFacilities.map((f) => facilityLabels[f]));
  conditions.push(
    ...query.excludedFacilities.map(
      (f) => `Without ${facilityLabels[f].toLowerCase()}`,
    ),
  );
  if (query.wheelchairAccessible) conditions.push("Wheelchair access required");
  for (const [label, values] of [
    ["Name", query.names],
    ["Type", query.kinds],
    ["Area", query.areas],
  ] as const)
    if (values.length) conditions.push(`${label}: ${values.join(" or ")}`);
  const matchesText = (value: string, choices: string[]) =>
    !choices.length ||
    choices.some((choice) => value.toLowerCase() === choice.toLowerCase());
  const ids = optionsForCategory(category)
    .filter(
      (item) =>
        (query.maxPricePerPerson === null ||
          item.price <= query.maxPricePerPerson) &&
        (query.minimumCapacity === null ||
          (item.capacity !== undefined &&
            item.capacity >= query.minimumCapacity)) &&
        (query.minimumBeds === null ||
          (item.beds !== undefined && item.beds >= query.minimumBeds)) &&
        query.requiredFacilities.every((f) => item.facilities.includes(f)) &&
        // Omitted facility data is not evidence of absence.
        query.excludedFacilities.every(
          (f) => category !== "restaurant" && !item.facilities.includes(f),
        ) &&
        (!query.wheelchairAccessible || item.wheelchairAccessible === true) &&
        matchesText(item.name, query.names) &&
        matchesText(item.kind, query.kinds) &&
        matchesText(item.area, query.areas),
    )
    .map((item) => item.id);
  return {
    ids,
    conditions,
    notices: [
      ...query.clarifications,
      ...query.unsupportedRequirements,
      ...(!conditions.length
        ? [
            "No searchable conditions were found. Describe a budget, group size, place or facility.",
          ]
        : []),
    ],
  };
}
