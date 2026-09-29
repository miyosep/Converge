import assert from "node:assert/strict";
import test from "node:test";
import { ExploreWorker } from "../scripts/lib/explore-worker";
import { demoMembers } from "../src/lib/explore/demo-members";
import { assembleDemoMembers } from "../src/lib/explore/group-decision";
import { commandSchema, validateLiveCommand } from "../src/lib/explore/store";
import type { ExploreRun } from "../src/lib/explore/types";

const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const preference = {
  requirements: [
    { text: "Under $40 per person", importance: "required" as const },
    { text: "Korean barbecue", importance: "preferred" as const },
  ],
  clarifications: [],
  notes: [],
};
function fixture(): ExploreRun {
  return {
    id: "a".repeat(64),
    judge: address(1),
    createdAt: "2026-09-30T00:00:00Z",
    phase: "preferences",
    revision: 0,
    extractionCalls: 0,
    transactions: [],
    approvals: 0,
    contributions: [],
    refund: "0",
    refunded: false,
    command: {
      action: "group_search",
      text: "Korean barbecue, under $40",
      preference,
    },
  };
}
function worker(saved: ExploreRun[]) {
  return Object.assign(
    Object.create(ExploreWorker.prototype) as ExploreWorker,
    {
      store: {
        save: async (run: ExploreRun) => {
          saved.push(structuredClone(run));
        },
      },
      ledger: {},
      deployer: { address: address(90) },
      executor: { address: address(91) },
      token: address(92),
      escrow: address(93),
      roles: { merchants: { A: address(94) } },
      bots: demoMembers.map((member) => ({ address: member.address })),
      client: { getBlock: async () => ({ timestamp: 1800000000n }) },
    },
  );
}
function completion(value: unknown) {
  return Response.json({
    model: "qwen3-32b",
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(value) },
      },
    ],
  });
}

test("all five configured addresses are required and unresolved user preferences cannot enter the decision", () => {
  const members = assembleDemoMembers(
    address(1),
    preference,
    demoMembers.map((member) => member.address),
  );
  assert.equal(members.length, 6);
  assert.deepEqual(
    members.slice(1).map((member) => member.address),
    demoMembers.map((member) => member.address),
  );
  assert.throws(
    () => assembleDemoMembers(address(1), preference, [address(2)]),
    /MISMATCH/,
  );
  assert.throws(
    () =>
      assembleDemoMembers(
        address(1),
        { ...preference, clarifications: ["Which budget?"] },
        demoMembers.map((member) => member.address),
      ),
    /NOT_CONFIRMED/,
  );
});

test("group search selects one restaurant without payment terms; later confirmation binds the chosen deposit", async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.KILN_API_KEY,
    oldXapi = process.env.XAPI_KEY;
  process.env.KILN_API_KEY = "fixture";
  process.env.XAPI_KEY = "fixture";
  const run = fixture(),
    saved: ExploreRun[] = [];
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    if (calls === 1) {
      const input = JSON.parse(body.messages[1].content);
      assert.equal(
        input.requirements.length,
        7,
        "judge's two and all five bots' conditions",
      );
      for (const member of demoMembers)
        assert.ok(
          input.requirements.some(
            (r: { text: string }) =>
              r.text === member.preference.requirements[0]!.text,
          ),
        );
      return completion({
        query: "Korean barbecue near Gangnam Station quiet pleasant atmosphere",
        consideredIds: input.requirements.map(
          (_: unknown, index: number) => index,
        ),
        conflicts: [],
      });
    }
    if (calls === 2) {
      assert.match(String(url), /action.xapi.to/);
      assert.match(body.input.q, /quiet pleasant atmosphere/);
      return Response.json({
        success: true,
        data: {
          places: [
            { cid: "101", title: "First place", address: "Gangnam" },
            { cid: "202", title: "Group choice", address: "Gangnam" },
          ],
        },
      });
    }
    assert.equal(calls, 3);
    const input = JSON.parse(body.messages[1].content);
    assert.equal(input.members.length, 6);
    assert.equal(input.places.length, 2);
    return completion({
      placeId: "202",
      consideredMembers: input.members.map(
        (m: { address: string }) => m.address,
      ),
      rationale: "The strongest available balance for the whole group.",
      uncertainties: ["Exact price and quietness remain unverified."],
    });
  };
  try {
    assert.ok(commandSchema.safeParse(run.command).success);
    await worker(saved).tick(run);
    assert.equal(calls, 3);
    assert.equal(run.restaurant, "Group choice");
    assert.equal(run.selectedPlace?.id, "202");
    assert.equal(run.groupDecision?.stage, "ready");
    assert.equal(run.phase, "review");
    assert.equal(Boolean(run.policy), false);
    assert.equal(run.reservation, undefined);
    assert.equal(run.transactions.length, 0);
    assert.equal(run.command, undefined);
    assert.ok(
      !commandSchema.safeParse({
        action: "select_place",
        revision: run.revision,
        placeId: "202",
        depositUsdc: 32,
      }).success,
      "booking confirmation must still explicitly acknowledge the demo",
    );
    run.command = {
      action: "select_place",
      revision: run.revision,
      placeId: "202",
      depositUsdc: 32,
      acknowledgeDemo: true,
    };
    await worker(saved).tick(run);
    assert.equal(run.phase, "proposal");
    assert.equal(run.policy?.paymentAmount, "32000000");
    assert.deepEqual(
      run.policy?.participants.map((p) => p.toLowerCase()),
      [run.judge, ...demoMembers.map((m) => m.address)].map((p) =>
        p.toLowerCase(),
      ),
    );
    assert.equal(run.transactions.length, 0);
    assert.equal(run.command, undefined);
    assert.ok(saved.some((s) => s.groupDecision?.stage === "aggregating"));
    assert.ok(saved.some((s) => s.groupDecision?.stage === "searching"));
    assert.ok(saved.some((s) => s.groupDecision?.stage === "choosing"));
    const unlocked = structuredClone(run);
    delete unlocked.policy;
    unlocked.phase = "review";
    assert.throws(
      () =>
        validateLiveCommand(unlocked, {
          action: "select_place",
          revision: unlocked.revision,
          placeId: "101",
          depositUsdc: 45,
          acknowledgeDemo: true,
        }),
      /STALE_OR_UNKNOWN/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.KILN_API_KEY;
    else process.env.KILN_API_KEY = oldKey;
    if (oldXapi === undefined) delete process.env.XAPI_KEY;
    else process.env.XAPI_KEY = oldXapi;
  }
});

test("an interrupted group search never repeats xAPI automatically or prepares payment", async () => {
  const run = fixture();
  run.searchInFlight = true;
  run.searchCalls = 3;
  run.groupDecision = {
    stage: "searching",
    members: assembleDemoMembers(
      run.judge,
      preference,
      demoMembers.map((m) => m.address),
    ),
  };
  await worker([]).tick(run);
  assert.equal(run.error, "SEARCH_INTERRUPTED_RETRY_EXPLICITLY");
  assert.equal(run.command, undefined);
  assert.equal(run.policy, undefined);
  assert.equal(run.searchCalls, 3);
});
test("saved candidates resume selection without xAPI and invented winners or omitted members cannot create policies", async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.KILN_API_KEY,
    oldXapi = process.env.XAPI_KEY;
  process.env.KILN_API_KEY = "fixture";
  process.env.XAPI_KEY = "fixture";
  try {
    for (const mode of ["valid", "invented", "omitted"] as const) {
      const run = fixture();
      run.searchInFlight = true;
      run.searchCalls = 3;
      run.groupDecision = {
        stage: "choosing",
        members: assembleDemoMembers(
          run.judge,
          preference,
          demoMembers.map((m) => m.address),
        ),
      };
      run.discovery = {
        intent: {
          area: "Gangnam Station",
          cuisine: "",
          koreanQuery: "group dinner",
          budget: null,
          people: 6,
          facilities: [],
          otherRequirements: [],
          clarifications: [],
        },
        query: "group dinner",
        searchedAt: new Date().toISOString(),
        places: [
          {
            id: "202",
            name: "Only saved choice",
            address: "Gangnam",
            mapsUrl: "https://maps.google.com",
            websiteUrl: null,
            price: null,
            evidence: [],
            attributions: [],
          },
        ],
        excludedCount: 0,
        source: "xAPI (Google Maps)",
      };
      let calls = 0;
      globalThis.fetch = async (url) => {
        calls++;
        assert.doesNotMatch(String(url), /action.xapi.to/);
        const addresses = run.groupDecision!.members.map((m) => m.address);
        return completion({
          placeId: mode === "invented" ? "fabricated" : "202",
          consideredMembers:
            mode === "omitted"
              ? [...addresses.slice(0, 5), addresses[0]]
              : addresses,
          rationale: "The closest fit across six opinions.",
          uncertainties: ["Venue conditions unverified"],
        });
      };
      await worker([]).tick(run);
      assert.equal(calls, 1);
      assert.equal(run.searchCalls, 3);
      if (mode === "valid") {
        assert.equal(run.selectedPlace?.id, "202");
        assert.equal(run.phase, "review");
        assert.equal(run.policy, undefined);
      } else {
        assert.equal(run.policy, undefined);
        assert.equal(run.error, "GROUP_DECISION_FAILED");
      }
    }
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.KILN_API_KEY;
    else process.env.KILN_API_KEY = oldKey;
    if (oldXapi === undefined) delete process.env.XAPI_KEY;
    else process.env.XAPI_KEY = oldXapi;
  }
});
