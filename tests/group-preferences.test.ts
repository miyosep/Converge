import assert from "node:assert/strict";
import test from "node:test";
import { createKilnClient } from "../src/lib/kiln/client.js";
import {
  interpretLivePreference,
  recommendForGroup,
  recommendOneForGroup,
} from "../src/lib/discovery/group-preferences.js";
const preferences = [
  {
    requirements: [
      { text: "Vegetarian menu", importance: "required" as const },
    ],
    clarifications: [],
  },
  {
    requirements: [
      { text: "Wheelchair entrance", importance: "required" as const },
      { text: "Quiet atmosphere", importance: "preferred" as const },
    ],
    clarifications: [],
  },
];
const base = {
  xapiKey: "test-key",
  runId: "group-search",
  area: "Seoul",
  category: "restaurant" as const,
  people: 2,
  startsAt: "2030-01-05T10:00:00Z",
  preferences,
};
function client(output: unknown, inspect: (body: any) => void = () => {}) {
  return createKilnClient({
    apiKey: "test",
    maxAttempts: 1,
    onAttempt: () => {},
    fetchImpl: async (_url, init) => {
      inspect(JSON.parse(String(init?.body)));
      return Response.json({
        model: "qwen3-32b",
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify(output) },
            finish_reason: "stop",
          },
        ],
      });
    },
  });
}
test("group search includes every confirmed member, reuses xAPI and keeps private conditions out of shared output", async () => {
  const query = "vegetarian wheelchair quiet restaurants Seoul";
  const result = await recommendForGroup({
    ...base,
    client: client(
      { query, consideredIds: [0, 1, 2], blockingConflicts: [], conflicts: [] },
      (body) => {
        const input = JSON.parse(body.messages[1].content);
        assert.deepEqual(
          input.requirements.map((r: any) => r.text),
          preferences.flatMap((p) => p.requirements.map((r) => r.text)),
        );
        assert.match(body.messages[0].content, /ALL members/);
        assert.match(body.messages[0].content, /ONE shared restaurant/);
        assert.match(body.messages[0].content, /Preserve allergies/);
      },
    ),
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://action.xapi.to/v1/actions/execute");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        action_id: "web.search.places",
        input: { q: query, hl: "en", page: 1 },
      });
      return Response.json({
        success: true,
        data: {
          places: [
            { title: "Venue", address: "Seoul", website: "javascript:bad" },
            { title: "Venue", address: "Seoul" },
          ],
        },
      });
    },
  });
  assert.equal(result.places.length, 1);
  assert.equal(result.places[0]!.websiteUrl, null);
  assert.equal(result.places[0]!.evidence[0]!.status, "unknown");
  assert.doesNotMatch(
    JSON.stringify(result),
    /Vegetarian|Wheelchair|Quiet atmosphere/,
  );
});
test("missing opinions and omitted requirements cannot silently produce a group search", async () => {
  const neverSearch = async () => {
    assert.fail("No paid search permitted");
  };
  for (const consideredIds of [[0], [0, 0, 2], [0, 1, 9]]) {
    await assert.rejects(
      recommendForGroup({
        ...base,
        fetchImpl: neverSearch,
        client: client({
          query: "restaurants",
          consideredIds,
          blockingConflicts: [],
          conflicts: [],
        }),
      }),
      /INCOMPLETE_GROUP_INTERPRETATION/,
    );
  }
  await assert.rejects(
    recommendForGroup({
      ...base,
      people: 3,
      fetchImpl: neverSearch,
      client: client({}),
    }),
    /PREFERENCES_NOT_CONFIRMED/,
  );
});
test("conflicting tastes still search for one shared place without exposing private conditions", async () => {
  let searched = false;
  const result = await recommendForGroup({
    ...base,
    fetchImpl: async () => {
      searched = true;
      return Response.json({
        success: true,
        data: { places: [{ title: "Shared restaurant", address: "Seoul" }] },
      });
    },
    client: client({
      query: "restaurants",
      consideredIds: [0, 1, 2],
      blockingConflicts: [],
      conflicts: ["PRIVATE conflicting conditions"],
    }),
  });
  assert.equal(searched, true);
  assert.equal(result.places.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.match(result.places[0]!.evidence[0]!.detail, /compromise/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test("individual interpretation preserves the request and fixed group context for member confirmation", async () => {
  const result = await interpretLivePreference(
    client(preferences[0], (body) => {
      const input = JSON.parse(body.messages[1].content);
      assert.equal(input.text, "I need vegetarian food");
      assert.equal(input.people, 2);
      assert.match(body.messages[0].content, /Each member will confirm/);
      assert.match(
        body.messages[0].content,
        /every budget target or ceiling, are preferred/,
      );
    }),
    {
      runId: "member",
      text: "I need vegetarian food",
      category: "restaurant",
      area: "Seoul",
      people: 2,
      startsAt: base.startsAt,
      timeZone: "Asia/Seoul",
    },
  );
  assert.deepEqual(result, preferences[0]);
});

test("indispensable safety conflicts block searching without exposing private health details", async () => {
  const result = await recommendForGroup({
    ...base,
    client: client({
      query: "restaurants Seoul",
      consideredIds: [0, 1, 2],
      conflicts: [],
      blockingConflicts: ["PRIVATE unavoidable allergen exposure"],
    }),
    fetchImpl: async () => {
      assert.fail("Unsafe shared plan must not search");
    },
  });
  assert.equal(result.places.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0]!, /essential safety/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE|unavoidable allergen exposure/,
  );
});

test("friends receive exactly the Qwen-selected venue, not the first xAPI result", async () => {
  const run = async (choice: object) => {
    let calls = 0;
    const ai = createKilnClient({
      apiKey: "test",
      maxAttempts: 1,
      onAttempt: () => {},
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const output =
          ++calls === 1
            ? {
                query: "restaurants Seoul",
                consideredIds: [0, 1, 2],
                conflicts: [],
                blockingConflicts: [],
              }
            : choice;
        if (calls === 2) {
          const input = JSON.parse(body.messages[1].content);
          assert.equal(input.members.length, 2);
          assert.equal(input.places.length, 2);
          assert.match(
            body.messages[0].content,
            /without quoting private preferences/,
          );
        }
        return Response.json({
          model: "qwen3-32b",
          choices: [
            {
              message: { role: "assistant", content: JSON.stringify(output) },
              finish_reason: "stop",
            },
          ],
        });
      },
    });
    return recommendOneForGroup({
      ...base,
      client: ai,
      fetchImpl: async () =>
        Response.json({
          success: true,
          data: {
            places: [
              { cid: "101", title: "First search result", address: "Seoul" },
              { cid: "202", title: "Better shared fit", address: "Seoul" },
            ],
          },
        }),
    });
  };
  const choice = {
    placeId: "202",
    consideredMembers: [0, 1],
    rationale: "A balanced shared option.",
    uncertainties: ["Confirm suitability with the venue."],
  };
  const result = await run(choice);
  assert.deepEqual(
    result.places.map((place) => place.id),
    ["202"],
  );
  assert.equal(result.places[0]!.evidence[0]!.detail, choice.rationale);
  await assert.rejects(
    run({ ...choice, placeId: "invented" }),
    /UNKNOWN_GROUP_CHOICE/,
  );
  await assert.rejects(
    run({ ...choice, consideredMembers: [0, 0] }),
    /INCOMPLETE_GROUP_DECISION/,
  );
  const blocked = await run({ ...choice, placeId: null });
  assert.equal(blocked.places.length, 0);
  assert.equal(blocked.conflicts.length, 1);
});
