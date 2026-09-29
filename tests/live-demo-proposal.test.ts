import assert from "node:assert/strict";
import test from "node:test";
import { type Address } from "viem";
import { proposeLivePlace } from "../src/lib/explore/live-proposal.js";
import {
  commandSchema,
  validateLiveCommand,
} from "../src/lib/explore/store.js";
import type { ExploreRun } from "../src/lib/explore/types.js";
import { ExploreWorker } from "../scripts/lib/explore-worker.js";

const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const config = {
  escrow: address(100),
  token: address(101),
  merchant: address(102),
  executor: address(103),
  participants: [1, 2, 3, 4, 5, 6].map(address),
  blockTimestamp: 1_800_000_000,
};
function fixture(): ExploreRun {
  return {
    id: "fixture",
    judge: address(1),
    createdAt: "2026-09-30T00:00:00Z",
    phase: "review",
    revision: 2,
    extractionCalls: 0,
    transactions: [],
    approvals: 0,
    contributions: [],
    refund: "0",
    refunded: false,
    discovery: {
      intent: {
        area: "Gangnam Station",
        cuisine: "Japanese",
        koreanQuery: "Japanese restaurants",
        budget: null,
        people: 6,
        facilities: [],
        otherRequirements: ["quiet"],
        clarifications: [],
      },
      source: "xAPI (Google Maps)",
      query: "Japanese restaurants near Gangnam Station",
      searchedAt: "2026-09-30T00:00:00Z",
      excludedCount: 0,
      places: [
        {
          id: "123",
          name: "Test venue",
          address: "Test address",
          mapsUrl: "https://www.google.com/maps?cid=123",
          websiteUrl: null,
          price: null,
          evidence: [
            { condition: "quiet", status: "unknown", detail: "Not verified" },
          ],
          attributions: [],
        },
      ],
    },
  };
}
const selection = {
  action: "select_place" as const,
  revision: 2,
  placeId: "123",
  depositUsdc: 45,
  acknowledgeDemo: true as const,
};
test("live proposal binds the saved venue, exact deposit and configured recipient; later changes are locked", () => {
  const run = fixture();
  proposeLivePlace(run, selection, config);
  assert.equal(run.phase, "proposal");
  assert.equal(run.policy!.paymentAmount, "45000000");
  assert.equal(run.policy!.merchant.toLowerCase(), config.merchant);
  assert.equal(run.reservation!.source, "live-place-demo");
  assert.equal(run.reservation!.reference, run.policy!.reservationReference);
  assert.equal(run.selectedPlace!.evidence[0]!.status, "unknown");
  assert.throws(
    () => proposeLivePlace(run, { ...selection, depositUsdc: 50 }, config),
    /POLICY_LOCKED/,
  );
  assert.throws(
    () => validateLiveCommand(run, { action: "search", text: "another place" }),
    /POLICY_LOCKED/,
  );
  for (const change of ["amount", "venue", "requirements"] as const) {
    const changed = fixture();
    if (change === "venue")
      changed.discovery!.places[0]!.name = "Different venue";
    if (change === "requirements")
      changed.discovery!.intent.otherRequirements = ["parking"];
    proposeLivePlace(
      changed,
      { ...selection, depositUsdc: change === "amount" ? 50 : 45 },
      config,
    );
    assert.notEqual(changed.policyHash, run.policyHash);
    assert.notEqual(
      changed.policy!.reservationReference,
      run.policy!.reservationReference,
    );
  }
});
test("arbitrary recipients, unacknowledged assumptions, invalid amounts and stale candidates cannot create policies", () => {
  for (const amount of [0, 61, 1.5])
    assert.throws(() =>
      proposeLivePlace(
        fixture(),
        { ...selection, depositUsdc: amount },
        config,
      ),
    );
  assert.throws(() =>
    commandSchema.parse({ ...selection, merchant: address(999) }),
  );
  assert.throws(() =>
    commandSchema.parse({ ...selection, acknowledgeDemo: false }),
  );
  assert.throws(
    () => proposeLivePlace(fixture(), { ...selection, revision: 1 }, config),
    /STALE/,
  );
  assert.throws(
    () =>
      proposeLivePlace(
        fixture(),
        { ...selection, placeId: "fabricated" },
        config,
      ),
    /UNKNOWN/,
  );
  const unclear = fixture();
  unclear.discovery!.intent.clarifications = ["Which currency?"];
  assert.throws(() => proposeLivePlace(unclear, selection, config), /STALE/);
});
test("interrupted third paid search clears its command without replay or payment", async () => {
  const run = fixture();
  run.phase = "preferences";
  run.searchCalls = 3;
  run.searchInFlight = true;
  run.command = { action: "search", text: "Japanese food" };
  let saves = 0;
  const worker = Object.assign(
    Object.create(ExploreWorker.prototype) as ExploreWorker,
    {
      store: {
        save: async () => {
          saves++;
        },
      },
      ledger: {},
      deployer: { address: address(104) },
      executor: { address: config.executor },
      token: config.token,
      escrow: config.escrow,
      roles: { merchants: { A: config.merchant } },
      bots: [],
    },
  );
  await worker.tick(run);
  assert.equal(run.command, undefined);
  assert.equal(run.searchInFlight, undefined);
  assert.equal(run.error, "SEARCH_INTERRUPTED_RETRY_EXPLICITLY");
  assert.equal(run.searchCalls, 3);
  assert.equal(run.policy, undefined);
  assert.equal(saves, 1);
});
test("worker saves Qwen/xAPI search before allowing a candidate policy and retains unknown facts", async () => {
  const previousFetch = globalThis.fetch;
  const oldKiln = process.env.KILN_API_KEY;
  const oldXapi = process.env.XAPI_KEY;
  process.env.KILN_API_KEY = "fixture";
  process.env.XAPI_KEY = "fixture";
  const run = fixture();
  delete run.discovery;
  run.phase = "preferences";
  run.command = { action: "search", text: "Quiet Japanese food for six" };
  const saved: ExploreRun[] = [];
  const worker = Object.assign(
    Object.create(ExploreWorker.prototype) as ExploreWorker,
    {
      store: {
        save: async (state: ExploreRun) => {
          saved.push(structuredClone(state));
        },
      },
      ledger: {},
      deployer: { address: address(104) },
      executor: { address: config.executor },
      token: config.token,
      escrow: config.escrow,
      roles: { merchants: { A: config.merchant } },
      bots: config.participants.slice(1).map((value) => ({ address: value })),
      client: {
        getBlock: async () => ({ timestamp: BigInt(config.blockTimestamp) }),
      },
    },
  );
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) {
      const args = { ...fixture().discovery!.intent };
      const { koreanQuery: _, ...toolArgs } = args;
      return Response.json({
        model: "qwen3-32b",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "search_places",
                    arguments: JSON.stringify(toolArgs),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });
    }
    assert.equal(
      JSON.parse(String(init?.body)).input.q,
      "Japanese restaurants near Gangnam Station, Seoul, South Korea",
    );
    return Response.json({
      success: true,
      data: {
        places: [{ cid: "123", title: "Provider fixture", address: "Gangnam" }],
      },
    });
  };
  try {
    await worker.tick(run);
    assert.equal(calls, 2);
    assert.equal(run.phase, "review");
    assert.equal(run.searchCalls, 1);
    assert.equal(run.searchUsage![0]!.totalTokens, 30);
    assert.equal(run.command, undefined);
    assert.equal(run.discovery!.places[0]!.evidence[0]!.status, "unknown");
    assert.ok(saved.some((state) => state.searchInFlight));
    run.command = { ...selection, revision: run.revision, depositUsdc: 48 };
    await worker.tick(run);
    assert.equal(calls, 2, "Selecting a saved candidate must not search again");
    assert.equal(run.policy!.paymentAmount, "48000000");
    assert.equal(run.restaurant, "Provider fixture");
    assert.equal(run.phase, "proposal");
  } finally {
    globalThis.fetch = previousFetch;
    if (oldKiln === undefined) delete process.env.KILN_API_KEY;
    else process.env.KILN_API_KEY = oldKiln;
    if (oldXapi === undefined) delete process.env.XAPI_KEY;
    else process.env.XAPI_KEY = oldXapi;
  }
});
