import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  buildLiveGroupPolicy,
  unanimousPlace,
  livePlanRequestSchema,
  type LivePlan,
} from "../src/lib/discovery/live-plan.js";
import { currentGroupPolicyConfig } from "../src/lib/server/group-config.js";
import { LiveGroupPanel } from "../app/components/live-group-panel.js";
import { calendarEvent } from "../src/lib/calendar/google.js";

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
const input = {
  groupId: "test-group",
  plan,
  members,
  target: 2,
  slot,
  config: currentGroupPolicyConfig(),
  nowSeconds: now,
};

test("live group policy needs every current member's same choice and binds venue, conditions and exact deposit", () => {
  const saved = buildLiveGroupPolicy(input);
  assert.equal(saved.policy.policyVersion, 2);
  assert.equal(saved.policy.approvalThreshold, 2);
  assert.equal(saved.policy.paymentAmount, "15000000");
  assert.equal(saved.policy.contributionPerParticipant, "10000000");
  assert.equal(saved.policy.maxTotalSpend, "15000000");
  assert.equal(unanimousPlace(plan, members, 3), undefined);
  assert.throws(
    () =>
      buildLiveGroupPolicy({
        ...input,
        plan: { ...plan, votes: { [members[0]!]: "venue-1" } },
      }),
    /UNANIMOUS/,
  );
  assert.throws(
    () =>
      buildLiveGroupPolicy({
        ...input,
        plan: { ...plan, votes: { ...plan.votes, [members[1]!]: "other" } },
      }),
    /UNANIMOUS/,
  );
  assert.throws(
    () =>
      buildLiveGroupPolicy({
        ...input,
        slot: { ...slot, startsAt: new Date(now * 1000).toISOString() },
      }),
    /RESERVATION_PASSED/,
  );
  for (const changed of [
    { ...plan, depositUsdc: 16 },
    { ...plan, places: [{ ...plan.places[0]!, name: "Different venue" }] },
    { ...plan, intent: { ...plan.intent, otherRequirements: ["quiet"] } },
  ])
    assert.notEqual(
      buildLiveGroupPolicy({ ...input, plan: changed }).policyHash,
      saved.policyHash,
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
  assert.match(html, /Save my choice/);
  assert.match(html, /Needs confirmation/);
  assert.match(html, /wallet approval happens separately/);
  const event = calendarEvent(
    { ...overview, signingPolicy: buildLiveGroupPolicy(input) },
    60,
    "id",
  );
  assert.equal(event.location, "Saved real candidate — Seoul");
  assert.match(event.description, /NOT a real venue reservation/);
});
