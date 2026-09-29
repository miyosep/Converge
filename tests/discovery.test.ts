import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { createKilnClient } from "../src/lib/kiln/client.js";
import {
  assessPlace,
  findPlaces,
  safeExternalUrl,
  type ProviderPlace,
} from "../src/lib/discovery/places.js";
import { findKakaoPlaces } from "../src/lib/discovery/kakao.js";
import { discoverRestaurants } from "../src/lib/discovery/search.js";
import {
  discoveryRequestSchema,
  type DiscoveryIntent,
} from "../src/lib/discovery/types.js";
import {
  DiscoveryCard,
  RestaurantDiscovery,
} from "../app/components/restaurant-discovery.js";

const intent: DiscoveryIntent = {
  area: "Gangnam Station, Seoul",
  cuisine: "Italian",
  koreanQuery: "서울 강남역 이탈리안 음식점",
  budget: { currency: "KRW", amount: 30000 },
  people: 6,
  facilities: ["parking"],
  otherRequirements: ["Quiet atmosphere"],
  clarifications: [],
};
const place: ProviderPlace = {
  id: "fixture-1",
  displayName: { text: "Test restaurant" },
  businessStatus: "OPERATIONAL",
  formattedAddress: "Test address",
  googleMapsUri: "https://maps.google.com/?cid=123",
  priceRange: {
    startPrice: { currencyCode: "KRW", units: "15000" },
    endPrice: { currencyCode: "KRW", units: "25000" },
  },
  parkingOptions: { paidParkingLot: true },
};
const envelope = (output: DiscoveryIntent) =>
  Response.json({
    model: "qwen3-32b",
    choices: [
      {
        message: { role: "assistant", content: JSON.stringify(output) },
        finish_reason: "stop",
      },
    ],
  });

test("English request becomes a Korean provider query without sending budget or group size to Kakao", async () => {
  const client = createKilnClient({
    apiKey: "test",
    onAttempt: () => {},
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.match(body.messages[1].content, /six people/);
      assert.match(body.messages[0].content, /untrusted/);
      return envelope(intent);
    },
  });
  const result = await discoverRestaurants(
    client,
    "test-discovery",
    {
      location: "Seoul",
      text: "Italian near Gangnam Station for six people, quiet, parking, under KRW 30,000 per person.",
    },
    "test-kakao",
    async (url, init) => {
      const target = new URL(String(url));
      assert.equal(target.origin, "https://dapi.kakao.com");
      assert.equal(target.searchParams.get("query"), intent.koreanQuery);
      assert.equal(target.searchParams.get("category_group_code"), "FD6");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "KakaoAK test-kakao",
      );
      return Response.json({
        documents: [
          {
            id: "123",
            place_name: "Test venue",
            category_group_code: "FD6",
            category_name: "음식점 > 양식",
            address_name: "서울",
            road_address_name: "서울 테스트",
          },
        ],
      });
    },
    "kakao",
  );
  assert.equal(result.source, "Kakao Map");
  assert.equal(result.places.length, 1);
  assert.equal(result.places[0]!.mapsUrl, "https://place.map.kakao.com/123");
  assert.ok(
    result.places[0]!.evidence.every((entry) => entry.status === "unknown"),
  );
  assert.equal(result.places[0]!.price, null);
});

test("clarifications stop external place searches instead of inventing budgets", async () => {
  const client = createKilnClient({
    apiKey: "test",
    onAttempt: () => {},
    fetchImpl: async () =>
      envelope({
        ...intent,
        budget: null,
        clarifications: ["State a per-person budget."],
      }),
  });
  const result = await discoverRestaurants(
    client,
    "test-clarify",
    { location: "Seoul", text: "Dinner for $300 total" },
    "test",
    async () => {
      assert.fail("Must not search before clarification");
    },
  );
  assert.equal(result.places.length, 0);
  assert.equal(result.query, "");
});

test("budget comparison preserves currency and partial price ranges remain unknown", () => {
  assert.equal(assessPlace(place, intent).evidence[0]!.status, "reported");
  assert.equal(
    assessPlace(place, { ...intent, budget: { currency: "USD", amount: 30 } })
      .evidence[0]!.status,
    "unknown",
  );
  assert.equal(
    assessPlace(place, {
      ...intent,
      budget: { currency: "KRW", amount: 20000 },
    }).evidence[0]!.status,
    "unknown",
  );
  assert.equal(
    assessPlace(place, {
      ...intent,
      budget: { currency: "KRW", amount: 10000 },
    }).evidence[0]!.status,
    "conflict",
  );
  assert.equal(
    assessPlace(
      {
        ...place,
        priceRange: { startPrice: { currencyCode: "KRW", units: "15000" } },
      },
      intent,
    ).evidence[0]!.status,
    "unknown",
  );
});

test("accessibility requires both entrance and seating, while missing parking is not a negative claim", () => {
  const accessible = {
    ...intent,
    budget: null,
    facilities: ["wheelchair" as const],
  };
  assert.equal(
    assessPlace(
      {
        ...place,
        accessibilityOptions: { wheelchairAccessibleEntrance: true },
      },
      accessible,
    ).evidence[0]!.status,
    "unknown",
  );
  assert.equal(
    assessPlace(
      {
        ...place,
        accessibilityOptions: {
          wheelchairAccessibleEntrance: true,
          wheelchairAccessibleSeating: false,
        },
      },
      accessible,
    ).evidence[0]!.status,
    "conflict",
  );
  assert.equal(
    assessPlace(
      { ...place, parkingOptions: { freeParkingLot: false } },
      { ...intent, budget: null },
    ).evidence[0]!.status,
    "unknown",
  );
});

test("Google adapter removes closed, duplicate and conflicting results and requests only explicit fields", async () => {
  const result = await findPlaces(intent, "test-google", async (url, init) => {
    assert.equal(url, "https://places.googleapis.com/v1/places:searchText");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.ok(
      !new Headers(init?.headers).get("X-Goog-FieldMask")?.includes("reviews"),
    );
    assert.equal(JSON.parse(String(init?.body)).strictTypeFiltering, true);
    return Response.json({
      places: [
        place,
        place,
        { ...place, id: "closed", businessStatus: "CLOSED_PERMANENTLY" },
        {
          ...place,
          id: "expensive",
          priceRange: {
            startPrice: { currencyCode: "KRW", units: "50000" },
            endPrice: { currencyCode: "KRW", units: "80000" },
          },
        },
      ],
    });
  });
  assert.deepEqual(
    result.places.map((p) => p.id),
    ["fixture-1"],
  );
  assert.equal(result.excludedCount, 2);
});

test("malformed provider output and provider errors fail without leaking provider messages", async () => {
  await assert.rejects(
    findPlaces(intent, "", async () => {
      assert.fail();
    }),
    /PLACES_NOT_CONFIGURED/,
  );
  await assert.rejects(
    findPlaces(intent, "test", async () =>
      Response.json({ error: "secret-provider-diagnostic" }, { status: 403 }),
    ),
    /PLACES_UNAVAILABLE/,
  );
  await assert.rejects(
    findKakaoPlaces(intent, "test", async () =>
      Response.json({ documents: [{ id: "fake" }] }),
    ),
    /PLACES_UNAVAILABLE/,
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://user:password@example.com",
    "http://example.com",
  ])
    assert.equal(safeExternalUrl(url), null);
  assert.equal(
    discoveryRequestSchema.safeParse({
      location: "Seoul",
      text: "x".repeat(2001),
    }).success,
    false,
  );
});

test("discovery UI labels missing setup and shows evidence without claiming verified availability", () => {
  const html = renderToStaticMarkup(
    createElement(RestaurantDiscovery, {
      configured: false,
      source: "Kakao Map",
    }),
  );
  assert.match(html, /Live search is not connected/);
  for (const label of ["Restaurants", "Stays", "Spaces", "Sports", "Classes"])
    assert.ok(html.includes(label));
  assert.match(html, /Booking availability is not checked/);
  assert.match(html, /href="\/demo\/catalog"/);
  assert.match(html, /disabled=""/);
  const card = renderToStaticMarkup(
    createElement(DiscoveryCard, {
      place: assessPlace(place, intent),
      selected: false,
      disabled: false,
      onToggle: () => {},
    }),
  );
  assert.match(card, /Provider reported/);
  assert.match(card, /Needs confirmation/);
  assert.match(card, /availability for your date require confirmation/);
  assert.match(card, /rel="noopener noreferrer"/);
});

test("discovery endpoint rejects unsigned and cross-origin requests before paid searches", async () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "http://localhost:3000";
  try {
    const { POST } = await import("../app/api/discover/route.js");
    for (const [origin, status] of [
      ["https://other.example", 403],
      ["http://localhost:3000", 401],
    ] as const) {
      const response = await POST(
        new NextRequest("http://localhost:3000/api/discover", {
          method: "POST",
          headers: { origin, "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "Seoul",
            text: "Italian restaurants",
          }),
        }),
      );
      assert.equal(response.status, status);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});
