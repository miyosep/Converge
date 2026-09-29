import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import {
  discoverWithXapi,
  type SearchUsage,
} from "../src/lib/discovery/xapi.js";
import {
  discoveryCategories,
  type DiscoveryCategory,
} from "../src/lib/discovery/types.js";

if (!process.argv.includes("--live"))
  throw new Error("Pass --live to use paid search services");
const kilnKey = process.env.KILN_API_KEY;
const xapiKey = process.env.XAPI_KEY;
if (!kilnKey || !xapiKey) throw new Error("Search credentials required");
const evidence = [];
for (const category of [
  "stay",
  "space",
  "sport",
  "class",
] as DiscoveryCategory[]) {
  const only = process.argv
    .find((arg) => arg.startsWith("--category="))
    ?.split("=")[1];
  if (only && only !== category) continue;
  const usage: SearchUsage[] = [];
  const started = Date.now();
  const result = await discoverWithXapi({
    kilnKey,
    xapiKey,
    input: {
      category,
      location: "Seoul, South Korea",
      text: discoveryCategories[category].example,
    },
    onUsage: (item) => {
      usage.push(item);
      console.log(JSON.stringify({ category, ...item }));
    },
  });
  assert.equal(
    result.intent.clarifications.length,
    0,
    JSON.stringify(result.intent.clarifications),
  );
  assert.ok(result.places.length > 0, `${category}: no results`);
  const expected = {
    stay: /guesthouse/i,
    space: /meeting/i,
    sport: /badminton/i,
    class: /pottery/i,
    restaurant: /restaurant/i,
  };
  assert.match(result.query, expected[category]);
  assert.ok(
    result.places.every((place) =>
      place.evidence.every((item) => item.status === "unknown"),
    ),
  );
  if (category === "stay" || category === "space") {
    assert.equal(result.intent.budget, null);
    assert.match(
      result.intent.otherRequirements.join(" "),
      category === "stay" ? /200[,.]?000/ : /100[,.]?000/,
    );
  }
  evidence.push({
    category,
    query: result.query,
    intent: result.intent,
    count: result.places.length,
    names: result.places.slice(0, 3).map((p) => p.name),
    durationMs: Date.now() - started,
    usage,
  });
  console.log(JSON.stringify(evidence.at(-1)));
}
const path = `docs/evidence/place-categories-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
console.log(`Evidence: ${path}`);
