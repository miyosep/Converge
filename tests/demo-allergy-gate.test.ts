import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseDemoPlace,
  findDemoGroupCandidates,
} from "../src/lib/explore/group-decision";
import { demoMembers } from "../src/lib/explore/demo-members";
import type { KilnClient } from "../src/lib/kiln/client";

test("demo allergies block search and cached-candidate selection without invoking providers", async () => {
  const members = [
    {
      address: `0x${"1".repeat(40)}` as `0x${string}`,
      name: "You",
      preference: {
        hasAllergy: true,
        requirements: [
          { text: "Milk allergy", importance: "required" as const },
        ],
        clarifications: [],
        notes: [],
      },
    },
    ...demoMembers,
  ];
  const client = {
    complete: async () => assert.fail("must not invoke Qwen"),
  } as unknown as KilnClient;
  const result = await findDemoGroupCandidates({
    client,
    xapiKey: "unused",
    runId: "allergy-test",
    members,
    onSearching: async () => assert.fail("must not search"),
  });
  assert.deepEqual(result.places, []);
  assert.equal(result.conflicts.length, 1);
  const choice = await chooseDemoPlace(client, "allergy-test", members, []);
  assert.equal(choice.placeId, null);
  assert.doesNotMatch(choice.rationale, /milk|\bYou\b/i);
});
