import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pool } from "pg";
import { GroupStageContent } from "../app/components/group-screen.js";
import { GroupNavigation } from "../app/components/workspace-frame.js";
import {
  savedEvaluationView,
  scorePercent,
  type GroupOverview,
} from "../src/lib/group-view.js";
import { publishedEvidence } from "../src/lib/published-evidence.js";
import { PreferenceRepository } from "../src/lib/db/preferences.js";
import { evaluateDecision } from "../src/lib/decision-engine.js";
import { createRestaurantCatalog } from "../src/lib/fixtures/restaurants.js";
import { createBaselinePreferences } from "../src/lib/fixtures/preferences.js";

const address = (value: number) =>
  `0x${value.toString(16).padStart(40, "0")}` as `0x${string}`;
const members = [1, 2, 3, 4, 5, 6].map(address);
const catalog = createRestaurantCatalog(
  {
    schemaVersion: 1,
    chainId: 11155111,
    mode: "single-operator-demo",
    executor: address(20),
    merchants: {
      A: address(21),
      B: address(22),
      C: address(23),
      D: address(24),
      E: address(25),
    },
  },
  ["2030-01-05T10:00:00Z"],
);
const input = {
  members,
  catalog,
  preferences: createBaselinePreferences(members),
  slot: { startsAt: "2030-01-05T10:00:00Z", timeZone: "Asia/Seoul" },
  permittedMerchants: catalog.restaurants.map(
    (restaurant) => restaurant.merchant,
  ),
  contributionPerParticipant: "10000000",
  maxDeposit: "60000000",
  maxTotalSpend: "60000000",
};
const evaluation = savedEvaluationView({
  ...input,
  id: "evaluation-1",
  createdAt: "2026-09-29T00:00:00Z",
  result: evaluateDecision(input),
});
const overview: GroupOverview = {
  group: {
    id: "actual-group",
    name: "Test group",
    startsAt: input.slot.startsAt,
    timeZone: "Asia/Seoul",
    locked: true,
    memberCount: 6,
    targetMemberCount: 6,
    confirmedCount: 6,
  },
  participants: members.map((walletAddress, index) => ({
    walletAddress,
    displayName: `Member ${index + 1}`,
    submitted: true,
    confirmed: true,
  })),
  evaluation,
  signingPolicy: null,
};

test("group results show the engine score on a 100-point scale and retain the current group", () => {
  assert.equal(scorePercent(900000), "90.0");
  assert.equal(scorePercent(0), "0.0");
  assert.equal(scorePercent(null), "—");
  const html = renderToStaticMarkup(
    createElement(GroupStageContent, { overview, stage: "results" }),
  );
  assert.match(html, /90\.0/);
  assert.match(html, /actual-group\/approve/);
  assert.doesNotMatch(html, /demo-001|shellfish|revisionId|violations/);
  const nav = renderToStaticMarkup(
    createElement(GroupNavigation, { id: "actual-group", active: "results" }),
  );
  assert.match(nav, /actual-group\/preferences/);
  assert.match(nav, /aria-current="page"/);
});

test("four-member progress unlocks evaluation and policy preparation without a six-person gate", () => {
  const four: GroupOverview = {
    ...overview,
    group: {
      ...overview.group,
      targetMemberCount: 4,
      memberCount: 4,
      confirmedCount: 4,
      locked: false,
    },
    participants: overview.participants.slice(0, 4),
    evaluation: null,
  };
  const render = (
    stage: "lobby" | "results" | "approve" | "execution",
    value = four,
  ) =>
    renderToStaticMarkup(
      createElement(GroupStageContent, {
        overview: value,
        stage,
        onEvaluate: () => {},
      }),
    );
  assert.match(render("lobby"), /4 \/ 4 joined/);
  assert.match(render("lobby"), /max="4"/);
  assert.match(
    render("results"),
    /<button class="primary">Evaluate group<\/button>/,
  );
  const incomplete = { ...four, participants: four.participants.slice(0, 3) };
  assert.match(render("results", incomplete), /disabled=""/);
  assert.match(render("approve"), /Approval is not available yet/);
  const ready = { ...four, evaluation };
  assert.match(render("approve", ready), /Prepare signing policy/);
  assert.doesNotMatch(
    render("approve", ready),
    /require exactly 6|unavailable for this group size/,
  );
});

test("saved result projection excludes participant identities and private conditions", () => {
  const json = JSON.stringify(evaluation);
  for (const participant of members) assert.ok(!json.includes(participant));
  assert.doesNotMatch(
    json,
    /violations|preferences|rawText|shellfish|confirmedRevisionId/,
  );
});

test("missing group records never become fabricated policy, balance, or payment success", () => {
  const empty = { ...overview, evaluation: null };
  const results = renderToStaticMarkup(
    createElement(GroupStageContent, { overview: empty, stage: "results" }),
  );
  assert.match(results, /Waiting for an evaluation/);
  assert.doesNotMatch(results, /Restaurant A/);
  const approval = renderToStaticMarkup(
    createElement(GroupStageContent, { overview: empty, stage: "approve" }),
  );
  assert.match(approval, /Approval is not available yet/);
  assert.doesNotMatch(approval, /<button|10 MockUSDC|60 MockUSDC/);
  const execution = renderToStaticMarkup(
    createElement(GroupStageContent, { overview, stage: "execution" }),
  );
  assert.match(execution, /No reconciled record/);
  assert.doesNotMatch(execution, /Payment complete|Claim .*refund|0 MockUSDC/);
});

test("published evidence keeps independent records separate and missing usage unknown", () => {
  const baseline = publishedEvidence.find((run) => run.id === "baseline-001")!;
  const smoke = publishedEvidence.find((run) => run.id === "kiln-smoke")!;
  assert.ok(baseline.transactions.length > 0);
  assert.ok(baseline.usage.every((flow) => flow.calls === null));
  assert.equal(smoke.transactions.length, 0);
  assert.equal(smoke.usage[0]!.calls, 2);
  assert.equal(smoke.usage[0]!.inputTokens, 2004);
  assert.doesNotMatch(
    JSON.stringify(publishedEvidence),
    /"intent"|"outputs"|"rawText"|"privateKey"/,
  );
});

test("an inaccessible group cannot reach participant or evaluation projections", async () => {
  const pool = new Pool();
  let queries = 0;
  pool.query = (async () => {
    queries += 1;
    return { rows: [] };
  }) as unknown as typeof pool.query;
  try {
    await assert.rejects(
      new PreferenceRepository(pool).getOverview("private-group", address(1)),
      /NOT_MEMBER/,
    );
    assert.equal(queries, 1);
  } finally {
    await pool.end();
  }
});
