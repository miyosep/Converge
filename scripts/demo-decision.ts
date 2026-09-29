import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import {
  evaluateDecision,
  publicEvaluation,
} from "../src/lib/decision-engine.js";
import { demoRolesSchema } from "../src/lib/demo-roles.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";
import { createRestaurantCatalog } from "../src/lib/fixtures/restaurants.js";
import { addressSchema } from "../src/lib/schemas/primitives.js";

const roles = demoRolesSchema.parse(
  JSON.parse(
    await readFile("contracts/deployments/demo-roles.11155111.json", "utf8"),
  ),
);
const manifest = z
  .object({
    participants: z.array(z.object({ address: addressSchema })).length(6),
  })
  .parse(
    JSON.parse(
      await readFile(
        "contracts/deployments/demo-participants.11155111.json",
        "utf8",
      ),
    ),
  );
const members = manifest.participants.map((p) => p.address);
const slot = { startsAt: "2030-01-05T10:00:00Z", timeZone: "Asia/Seoul" };
const scenarios = [
  { id: "baseline", budget: 3500, excludeA: false, expected: "A" },
  { id: "lower-budget", budget: 2500, excludeA: false, expected: "B" },
  { id: "merchant-excluded", budget: 3500, excludeA: true, expected: "B" },
];
const results = scenarios.map((scenario) => {
  const result = publicEvaluation(
    evaluateDecision({
      members,
      preferences: createBaselinePreferences(members, scenario.budget),
      slot,
      permittedMerchants: Object.values(roles.merchants).filter(
        (address) => !scenario.excludeA || address !== roles.merchants.A,
      ),
      contributionPerParticipant: "10000000",
      maxDeposit: "60000000",
      maxTotalSpend: "60000000",
      catalog: createRestaurantCatalog(roles, [slot.startsAt]),
    }),
  );
  assert.equal(result.winnerId, scenario.expected);
  return { scenario, result };
});
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/decision-engine-fixtures.json",
  JSON.stringify(
    {
      schemaVersion: 1,
      synthetic: true,
      syntheticConfirmations: true,
      liveKiln: false,
      onChainTransactions: false,
      slot,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Offline fixture evaluation passed: A / B / B. No provider calls or transactions.",
);
