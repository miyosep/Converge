import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  unanimousPlace,
  livePlanRequestSchema,
  type LivePlan,
} from "../src/lib/discovery/live-plan.js";
import { LiveGroupPanel } from "../app/components/live-group-panel.js";
import { GroupFirstForm } from "../app/components/group-first-form.js";

const members = [
  "0x0000000000000000000000000000000000000011",
  "0x0000000000000000000000000000000000000022",
];
const plan: LivePlan = {
  recommendationReady: true,
  recommendationRevision: "confirmed-preferences-1",
  category: "restaurant",
  merchant: "0x0000000000000000000000000000000000000033",
  depositUsdc: 15,
  places: [
    {
      id: "venue-1",
      name: "Saved real candidate",
      address: "Seoul",
      mapsUrl: "https://www.google.com/maps",
      websiteUrl: null,
      price: null,
      evidence: [
        {
          condition: "parking",
          status: "unknown",
          detail: "Confirm with venue",
        },
      ],
      attributions: [],
    },
  ],
  source: "xAPI (Google Maps)",
  searchedAt: "2026-09-30T00:00:00Z",
  intent: {
    area: "Seoul",
    cuisine: "",
    koreanQuery: "restaurant Seoul",
    budget: null,
    people: 2,
    facilities: ["parking"],
    otherRequirements: [],
    clarifications: [],
  },
  votes: Object.fromEntries(members.map((member) => [member, "venue-1"])),
};
const now = 1_800_000_000;
const slot = {
  startsAt: new Date((now + 7200) * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z"),
  timeZone: "Asia/Seoul",
};
test("place choice requires all members and does not imply a payment amount", () => {
  assert.equal(unanimousPlace(plan, members, 2)?.id, "venue-1");
  assert.equal(unanimousPlace(plan, members, 3), undefined);
  assert.equal(
    unanimousPlace(
      { ...plan, votes: { [members[0]!]: "venue-1" } },
      members,
      2,
    ),
    undefined,
  );
});

test("live plan requests reject arbitrary recipients and deposits exceeding contributions", () => {
  const request = {
    requestId: "11111111-1111-4111-8111-111111111111",
    searchId: "22222222-2222-4222-8222-222222222222",
    placeIds: ["venue-1"],
    name: "Dinner",
    displayName: "Alice",
    targetMemberCount: 2,
    depositUsdc: 15,
    slot,
    acknowledgeDemo: true,
  };
  assert.ok(livePlanRequestSchema.safeParse(request).success);
  assert.equal(
    livePlanRequestSchema.safeParse({ ...request, merchant: members[0] })
      .success,
    false,
  );
  assert.equal(
    livePlanRequestSchema.safeParse({ ...request, depositUsdc: 21 }).success,
    false,
  );
  assert.equal(
    livePlanRequestSchema.safeParse({
      ...request,
      placeIds: ["venue-1", "venue-1"],
    }).success,
    false,
  );
});

test("friends review unverified venue conditions and separate place choice from wallet approval", () => {
  const overview = {
    group: {
      id: "test-group",
      name: "Dinner",
      startsAt: slot.startsAt,
      timeZone: slot.timeZone,
      locked: false,
      memberCount: 2,
      targetMemberCount: 2,
      confirmedCount: 0,
    },
    participants: members.map((walletAddress, index) => ({
      walletAddress,
      displayName: `Friend ${index}`,
      submitted: false,
      confirmed: false,
    })),
    evaluation: null,
    signingPolicy: null,
    livePlan: plan,
  };
  const html = renderToStaticMarkup(
    createElement(LiveGroupPanel, { initial: overview }),
  );
  assert.match(html, /Agree to this place/);
  assert.match(html, /Needs confirmation/);
  assert.doesNotMatch(html, /type="radio"/);
  const searching = renderToStaticMarkup(
    createElement(LiveGroupPanel, {
      initial: {
        ...overview,
        livePlan: {
          ...plan,
          recommendationReady: false,
          searching: true,
          conflicts: ["Old conflict"],
        },
      },
    }),
  );
  assert.match(searching, /Finding one place for your group/);
  assert.doesNotMatch(
    searching,
    /No places found|Old conflict|couldn&#x27;t finish/,
  );
  const failed = renderToStaticMarkup(
    createElement(LiveGroupPanel, {
      initial: {
        ...overview,
        livePlan: {
          ...plan,
          recommendationReady: false,
          recommendationStatus: "failed",
          conflicts: [],
        },
      },
    }),
  );
  assert.match(failed, /finish the recommendation/);
  assert.doesNotMatch(failed, /No places found|essential needs/);

  const legacy = renderToStaticMarkup(
    createElement(LiveGroupPanel, {
      initial: {
        ...overview,
        livePlan: {
          ...plan,
          places: [
            ...plan.places,
            {
              ...plan.places[0]!,
              id: "old-second",
              name: "Old second candidate",
            },
          ],
        },
      },
    }),
  );
  assert.match(legacy, /Search again to turn your saved options/);
  assert.doesNotMatch(
    legacy,
    /Old second candidate|Agree to this place|type="radio"/,
  );

  assert.match(html, /Your shared payment/);
  assert.match(html, /Your organizer will set the amount/);
  assert.doesNotMatch(
    html,
    /10 MockUSDC|15 MockUSDC|demo booking wallet|Prepare agreed payment/,
  );
});

test("a new group accepts private draft preferences without a prior search or shortlist", () => {
  const request = {
    requestId: "11111111-1111-4111-8111-111111111111",
    category: "restaurant",
    location: "Gangnam Station, Seoul",
    initialPreferences: "Private: vegetarian and quiet",
    name: "Friday",
    displayName: "Alice",
    targetMemberCount: 2,
    slot,
  };
  assert.ok(livePlanRequestSchema.safeParse(request).success);
  assert.equal(
    livePlanRequestSchema.safeParse({ ...request, location: "" }).success,
    false,
  );
  assert.equal(
    livePlanRequestSchema.safeParse({ ...request, depositUsdc: 21 }).success,
    false,
  );
  assert.equal(
    livePlanRequestSchema.safeParse({ ...request, searchId: request.requestId })
      .success,
    false,
  );
  assert.equal(
    livePlanRequestSchema.safeParse({ ...request, merchant: members[0] })
      .success,
    false,
  );
  const html = renderToStaticMarkup(
    createElement(GroupFirstForm, {
      wallet: members[0]!,
      sessionLoading: false,
      onSignIn() {},
    }),
  );
  assert.match(html, /Save group &amp; invite friends/);
  assert.doesNotMatch(html, /Find restaurants|Compare selected/);
  assert.match(html, /Saved privately/);
  assert.doesNotMatch(html, /MockUSDC|test booking|demo booking|Sepolia/);
});
