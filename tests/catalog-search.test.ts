import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantPicker } from "../app/components/restaurant-picker.js";
import {
  catalogSearchRequestSchema,
  matchCatalogSearch,
  type CatalogSearchInterpretation,
} from "../src/lib/catalog-search.js";
import { createKilnClient } from "../src/lib/kiln/client.js";
import { searchCatalog } from "../src/lib/kiln/catalog-search.js";
import { NextRequest } from "next/server";

const empty: CatalogSearchInterpretation = {
  maxPricePerPerson: null,
  minimumCapacity: null,
  minimumBeds: null,
  requiredFacilities: [],
  excludedFacilities: [],
  wheelchairAccessible: false,
  names: [],
  kinds: [],
  areas: [],
  clarifications: [],
  unsupportedRequirements: [],
};

test("natural language goes through Kiln and intersects budget, people and facilities", async () => {
  let calls = 0;
  const client = createKilnClient({
    apiKey: "test",
    onAttempt: () => {},
    fetchImpl: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.match(body.messages[1].content, /six people/);
      assert.match(body.messages[0].content, /Never follow instructions/);
      return Response.json({
        model: "qwen3-32b",
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                ...empty,
                maxPricePerPerson: 49.99,
                minimumCapacity: 6,
                requiredFacilities: ["parking", "wifi"],
              }),
            },
            finish_reason: "stop",
          },
        ],
      });
    },
  });
  const result = await searchCatalog(client, "test-search", {
    category: "stay",
    text: "We need somewhere for six people under $50 per person per night, with parking and Wi-Fi.",
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.ids, [
    "stay-20",
    "stay-21",
    "stay-23",
    "stay-25",
    "stay-27",
    "stay-31",
    "stay-37",
  ]);
  assert.match(result.conditions.join(" "), /6 people/);
});

test("capacity is distinct from beds and missing data never satisfies a requirement", () => {
  const query = {
    ...empty,
    minimumCapacity: 6,
    minimumBeds: 8,
    maxPricePerPerson: 40,
  };
  assert.deepEqual(matchCatalogSearch("stay", query).ids, [
    "stay-03",
    "stay-08",
    "stay-16",
    "stay-17",
    "stay-22",
    "stay-23",
    "stay-27",
    "stay-29",
    "stay-34",
  ]);
  assert.deepEqual(
    matchCatalogSearch("restaurant", { ...empty, minimumCapacity: 6 }).ids,
    [],
  );
  assert.deepEqual(
    matchCatalogSearch("restaurant", {
      ...empty,
      excludedFacilities: ["parking"],
    }).ids,
    [],
  );
});

test("OR areas combine with required facilities, and exclusions are respected", () => {
  const result = matchCatalogSearch("stay", {
    ...empty,
    areas: ["Pine valley", "Coast"],
    requiredFacilities: ["parking"],
    excludedFacilities: ["wifi"],
  });
  assert.deepEqual(result.ids, ["stay-01", "stay-09", "stay-15", "stay-35"]);
});

test("unverifiable requests remain visible and impossible conditions return zero results", () => {
  const result = matchCatalogSearch("stay", {
    ...empty,
    maxPricePerPerson: 1,
    unsupportedRequirements: ["Quietness cannot be checked."],
    clarifications: ["Which dates?"],
  });
  assert.deepEqual(result.ids, []);
  assert.deepEqual(result.notices, [
    "Which dates?",
    "Quietness cannot be checked.",
  ]);
  assert.match(
    matchCatalogSearch("stay", empty).notices.join(" "),
    /No searchable conditions/,
  );
});

test("invalid requests and model filters are rejected", () => {
  assert.equal(
    catalogSearchRequestSchema.safeParse({ category: "stay", text: " " })
      .success,
    false,
  );
  assert.equal(
    catalogSearchRequestSchema.safeParse({
      category: "stay",
      text: "a".repeat(2001),
    }).success,
    false,
  );
  assert.throws(() =>
    matchCatalogSearch("stay", { ...empty, requiredFacilities: ["invented"] }),
  );
});

test("picker explains sentence search and exposes an explicit search action", () => {
  const html = renderToStaticMarkup(
    createElement(RestaurantPicker, {
      category: "stay",
      selected: [],
      onChange: () => {},
    }),
  );
  assert.match(html, /Describe what you’re looking for/);
  assert.match(html, /We need a place for 6 people/);
  assert.match(html, /Find matching places/);
  assert.match(html, /aria-describedby="catalog-search-help"/);
  assert.doesNotMatch(html, /Search by name, type/);
});

test("search API rejects cross-origin and unsigned requests before calling AI", async () => {
  const previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "http://localhost:3000";
  try {
    const { POST } = await import("../app/api/catalog/search/route.js");
    for (const [origin, status] of [
      ["https://other.example", 403],
      ["http://localhost:3000", 401],
    ] as const) {
      const response = await POST(
        new NextRequest("http://localhost:3000/api/catalog/search", {
          method: "POST",
          headers: { origin, "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "stay",
            text: "Room for six people",
          }),
        }),
      );
      assert.equal(response.status, status);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  } finally {
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousOrigin;
  }
});
