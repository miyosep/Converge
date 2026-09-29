import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildGroupPolicy } from "../src/lib/group-policy.js";
import { hashPolicy } from "../src/lib/policy.js";
import { hashPolicy as hashAnyPolicy } from "../src/lib/signing-policy.js";
import {
  groupEvaluationOptions,
  groupPolicyConfig,
} from "../src/lib/server/group-config.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";
import { GroupPolicyPanel } from "../app/components/group-policy-panel.js";

const now = 1_790_651_770;
const slot = {
  startsAt: new Date((now + 7200) * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z"),
  timeZone: "Asia/Seoul",
};
const members = [101, 102, 103, 104, 105, 106].map(
  (value) => `0x${value.toString(16).padStart(40, "0")}` as `0x${string}`,
);
const snapshot = {
  ...groupEvaluationOptions(slot.startsAt),
  slot,
  members,
  preferences: createBaselinePreferences(members),
};
const args = {
  groupId: "group-a",
  evaluationId: "eval-a",
  decisionNonce: "nonce-a",
  snapshot,
  expectedWinner: "A",
  config: groupPolicyConfig,
  nowSeconds: now,
};

test("group policy binds only the frozen six wallets, selected merchant and exact amounts", () => {
  const saved = buildGroupPolicy(args);
  assert.deepEqual(
    saved.policy.participants.map((value) => value.toLowerCase()),
    members,
  );
  assert.equal(
    saved.policy.merchant,
    snapshot.catalog.restaurants[0]!.merchant,
  );
  assert.equal(saved.policy.paymentAmount, "45000000");
  assert.equal(saved.policy.expiry, now + 3600);
  assert.equal(saved.policyHash, hashPolicy(saved.policy));
  assert.notEqual(
    buildGroupPolicy({ ...args, groupId: "group-b" }).policyHash,
    saved.policyHash,
  );
});

test("no-match, changed winner, unresolved input and elapsed reservations cannot create a policy", () => {
  assert.throws(
    () =>
      buildGroupPolicy({
        ...args,
        snapshot: { ...snapshot, permittedMerchants: [] },
      }),
    /NO_PROPOSAL/,
  );
  assert.throws(
    () => buildGroupPolicy({ ...args, expectedWinner: "B" }),
    /STALE_EVALUATION/,
  );
  assert.throws(
    () => buildGroupPolicy({ ...args, nowSeconds: now + 7200 }),
    /RESERVATION_PASSED/,
  );
  const unconfirmed = structuredClone(snapshot);
  unconfirmed.preferences[0]!.confirmedRevisionId = "older";
  assert.throws(
    () => buildGroupPolicy({ ...args, snapshot: unconfirmed }),
    /NO_PROPOSAL/,
  );
});

test("saved policy UI shows full immutable identity without implying chain registration", () => {
  const signingPolicy = buildGroupPolicy({
    ...args,
    nowSeconds: Math.floor(Date.now() / 1000),
    snapshot: {
      ...snapshot,
      slot: { ...slot, startsAt: "2099-01-05T10:00:00Z" },
      catalog: {
        ...snapshot.catalog,
        restaurants: snapshot.catalog.restaurants.map((row) => ({
          ...row,
          reservationSlots: ["2099-01-05T10:00:00Z"],
        })),
      },
    },
  });
  const html = renderToStaticMarkup(
    createElement(GroupPolicyPanel, {
      overview: {
        group: {
          id: "group-a",
          name: "Test",
          startsAt: slot.startsAt,
          timeZone: slot.timeZone,
          locked: true,
          memberCount: 6,
          targetMemberCount: 6,
          confirmedCount: 6,
        },
        participants: [],
        evaluation: null,
        signingPolicy,
      },
      busy: false,
    }),
  );
  assert.ok(html.includes(signingPolicy.policyHash));
  assert.ok(html.includes(signingPolicy.policy.decisionId));
  assert.match(html, /not chain-verified/);
  assert.match(html, /Waiting for verified chain state/);
  assert.doesNotMatch(html, /Register policy on Sepolia<\/button>/);
});

test("four-member recommendations cannot produce a six-wallet payment policy", () => {
  const four = {
    ...snapshot,
    members: snapshot.members.slice(0, 4),
    preferences: snapshot.preferences.slice(0, 4),
    maxDeposit: "40000000",
    maxTotalSpend: "40000000",
  };
  assert.throws(
    () => buildGroupPolicy({ ...args, snapshot: four }),
    /UNSUPPORTED_PAYMENT_GROUP_SIZE/,
  );
  const supported = buildGroupPolicy({
    ...args,
    snapshot: four,
    expectedWinner: "B",
    config: { ...args.config, policyVersion: 2 },
  });
  assert.equal(supported.policy.policyVersion, 2);
  assert.equal(supported.policy.approvalThreshold, 4);
  assert.equal(supported.policy.participants.length, 4);
  assert.equal(supported.policyHash, hashAnyPolicy(supported.policy));
});
