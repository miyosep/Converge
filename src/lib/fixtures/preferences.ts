import type { Address } from "viem";
import { extractionSchema } from "../schemas/constraints.js";
import { participantAddressesSchema } from "../schemas/shared.js";

// Synthetic confirmed test inputs only; never substitute these for live Kiln output or consent.
export function createBaselinePreferences(
  addresses: readonly Address[],
  budgetCents = 3500,
) {
  const members = participantAddressesSchema.parse(addresses);
  const constraints = [
    [
      {
        type: "hard",
        field: "budget_per_person_cents",
        operator: "lte",
        value: budgetCents,
      },
      { type: "soft", field: "quiet", weight: 1 },
    ],
    [
      { type: "non_negotiable", field: "shellfish_safe", value: true },
      { type: "soft", field: "subway_proximity", weight: 1 },
    ],
    [{ type: "soft", field: "atmosphere", weight: 1 }],
    [{ type: "soft", field: "quiet", weight: 1 }],
    [{ type: "soft", field: "atmosphere", weight: 1 }],
    [{ type: "soft", field: "subway_proximity", weight: 1 }],
  ];
  return members.map((participant, index) => ({
    participant,
    revisionId: `synthetic-${index + 1}-budget-${budgetCents}`,
    confirmedRevisionId: `synthetic-${index + 1}-budget-${budgetCents}`,
    extraction: extractionSchema.parse({
      schemaVersion: 1,
      constraints: constraints[index],
      clarifications: [],
      unsupportedRequirements: [],
    }),
  }));
}
