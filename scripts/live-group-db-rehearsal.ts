import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { LivePlanRepository } from "../src/lib/db/live-plans.js";
import { PreferenceRepository } from "../src/lib/db/preferences.js";
import { WalletAuthRepository } from "../src/lib/db/wallet-auth.js";
import { DatabaseExploreStore } from "../src/lib/explore/database-store.js";
import { verifyRepeatDemo } from "./lib/repeat-demo-check.js";
import { currentGroupPolicyConfig } from "../src/lib/server/group-config.js";
import type { DiscoveryResult } from "../src/lib/discovery/types.js";

async function main() {
  if (
    process.env.NEON_BRANCH !== "verify-production-0015" ||
    !process.env.DATABASE_URL_UNPOOLED
  )
    throw new Error("ISOLATED_TEST_BRANCH_REQUIRED");
  const pool = new Pool({
    connectionString: verifiedPostgresUrl(process.env.DATABASE_URL_UNPOOLED),
    max: 5,
  });
  const repo = new LivePlanRepository(pool),
    groups = new PreferenceRepository(pool),
    auth = new WalletAuthRepository(pool, "http://localhost:3000");
  const [alice, bob, outsider] = Array.from(
    { length: 3 },
    () => privateKeyToAccount(generatePrivateKey()).address,
  );
  const runs: string[] = [],
    searches: string[] = [],
    groupIds: string[] = [];
  const result: DiscoveryResult = {
    source: "xAPI (Google Maps)",
    query: "initial restaurant search",
    searchedAt: new Date().toISOString(),
    excludedCount: 0,
    intent: {
      area: "Seoul",
      cuisine: "",
      koreanQuery: "restaurant Seoul",
      budget: null,
      people: null,
      facilities: [],
      otherRequirements: [],
      clarifications: [],
    },
    places: [
      {
        id: "one",
        name: "Candidate One",
        address: "Seoul",
        mapsUrl: "https://www.google.com/maps",
        websiteUrl: null,
        price: null,
        evidence: [],
        attributions: [],
      },
      {
        id: "two",
        name: "Candidate Two",
        address: "Seoul",
        mapsUrl: "https://www.google.com/maps",
        websiteUrl: null,
        price: null,
        evidence: [],
        attributions: [],
      },
    ],
  };
  try {
    await verifyRepeatDemo(new DatabaseExploreStore(pool), runs);
    console.log(
      "DB repeat demos: independent rounds, old refunds, capacity, authorization and stale commands passed.",
    );
    const saved = await repo.saveSearch(
      alice!,
      {
        category: "restaurant",
        scope: "general",
        location: "Seoul",
        text: "initial search",
      },
      result,
    );
    searches.push(saved.searchId);
    await repo.select(alice!, saved.searchId, ["one", "two"]);
    assert.deepEqual((await repo.latestSearch(alice!))?.selectedPlaceIds, [
      "one",
      "two",
    ]);
    assert.equal(await repo.latestSearch(bob!), null);
    await assert.rejects(
      repo.select(bob!, saved.searchId, ["one"]),
      /SEARCH_NOT_FOUND/,
    );
    const request = {
      requestId: randomUUID(),
      searchId: saved.searchId,
      placeIds: ["one", "two"],
      name: "Test friends",
      displayName: "Alice",
      targetMemberCount: 2,
      depositUsdc: 15,
      acknowledgeDemo: true,
      slot: {
        startsAt: new Date(Date.now() + 7200000)
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z"),
        timeZone: "Asia/Seoul",
      },
    };
    const id = await repo.create(alice!, request, outsider!);
    groupIds.push(id);
    assert.equal(await repo.create(alice!, request, outsider!), id);
    await assert.rejects(
      repo.create(bob!, { ...request, requestId: randomUUID() }, outsider!),
      /SEARCH_NOT_FOUND/,
    );
    await assert.rejects(
      repo.beginRecommendation(id, alice!),
      /PREFERENCES_NOT_CONFIRMED/,
    );
    const invitation = await auth.createInvite(id, alice!);
    await auth.joinWithInvite(id, bob!, "Bob", invitation.token);
    await assert.rejects(repo.ownPreference(id, outsider!), /NOT_MEMBER/);
    const old = await repo.submitPreference(id, alice!, "Private: quiet", null);
    const next = await repo.submitPreference(
      id,
      alice!,
      "Private: quiet and vegetarian",
      old.revisionId,
    );
    await assert.rejects(
      repo.completePreference(id, alice!, old.revisionId, {
        requirements: [],
        clarifications: [],
      }),
      /STALE_REVISION/,
    );
    await repo.completePreference(id, alice!, next.revisionId, {
      requirements: [
        { text: "Vegetarian options", importance: "required" },
        { text: "Quiet", importance: "preferred" },
      ],
      clarifications: [],
    });
    await assert.rejects(
      repo.confirmPreference(id, alice!, old.revisionId),
      /PREFERENCES_NOT_READY/,
    );
    await repo.confirmPreference(id, alice!, next.revisionId);
    const second = await repo.submitPreference(
      id,
      bob!,
      "Private: under KRW 30000 per person",
      null,
    );
    await repo.completePreference(id, bob!, second.revisionId, {
      requirements: [
        { text: "Under KRW 30000 per person", importance: "required" },
      ],
      clarifications: [],
    });
    await assert.rejects(
      repo.beginRecommendation(id, alice!),
      /PREFERENCES_NOT_CONFIRMED/,
    );
    await repo.confirmPreference(id, bob!, second.revisionId);
    const started = await repo.beginRecommendation(id, alice!);
    assert.equal(started.preferences.length, 2);
    assert.equal(
      started.preferences.flatMap((preference) => preference.requirements)
        .length,
      3,
    );
    await assert.rejects(
      repo.beginRecommendation(id, bob!),
      /SEARCH_IN_PROGRESS/,
    );
    const edited = await repo.submitPreference(
      id,
      bob!,
      "Private: under KRW 25000 per person",
      second.revisionId,
    );
    await assert.rejects(
      repo.completeRecommendation(id, alice!, started.token, started.revision, {
        places: result.places,
        searchedAt: result.searchedAt,
        conflicts: [],
      }),
      /STALE_RECOMMENDATION/,
    );
    await repo.completePreference(id, bob!, edited.revisionId, {
      requirements: [
        { text: "Under KRW 25000 per person", importance: "required" },
      ],
      clarifications: [],
    });
    await repo.confirmPreference(id, bob!, edited.revisionId);
    let refreshed = await repo.beginRecommendation(id, bob!);
    await repo.completeRecommendation(
      id,
      bob!,
      refreshed.token,
      refreshed.revision,
      { places: result.places, searchedAt: result.searchedAt, conflicts: [] },
    );
    const priorSearch = refreshed;
    refreshed = await repo.beginRecommendation(id, alice!);
    assert.equal(refreshed.revision, priorSearch.revision);
    assert.notEqual(refreshed.token, priorSearch.token);
    await repo.completeRecommendation(
      id,
      alice!,
      refreshed.token,
      refreshed.revision,
      { places: result.places, searchedAt: result.searchedAt, conflicts: [] },
    );
    await assert.rejects(
      repo.vote(id, alice!, "one", priorSearch.token),
      /STALE_RECOMMENDATION/,
    );
    await repo.vote(id, alice!, "one", refreshed.token);
    await groups.leaveGroup(id, bob!);
    assert.equal(
      (await groups.getOverview(id, alice!)).livePlan?.recommendationReady,
      false,
    );
    await assert.rejects(
      repo.vote(id, alice!, "one", refreshed.token),
      /STALE_RECOMMENDATION/,
    );
    const rejoinInvite = await auth.createInvite(id, alice!);
    await auth.joinWithInvite(id, bob!, "Bob", rejoinInvite.token);
    assert.equal(await repo.ownPreference(id, bob!), null);
    const rejoined = await repo.submitPreference(
      id,
      bob!,
      "Private: under KRW 25000 per person",
      null,
    );
    await repo.completePreference(id, bob!, rejoined.revisionId, {
      requirements: [
        { text: "Under KRW 25000 per person", importance: "required" },
      ],
      clarifications: [],
    });
    await repo.confirmPreference(id, bob!, rejoined.revisionId);
    refreshed = await repo.beginRecommendation(id, alice!);
    await repo.completeRecommendation(
      id,
      alice!,
      refreshed.token,
      refreshed.revision,
      { places: result.places, searchedAt: result.searchedAt, conflicts: [] },
    );
    const overview = await groups.getOverview(id, alice!);
    assert.equal(overview.livePlan?.recommendationReady, true);
    assert.equal(
      overview.participants.filter((member) => member.confirmed).length,
      2,
    );
    assert.doesNotMatch(
      JSON.stringify(overview),
      /Private:|Vegetarian options|Under KRW 25000/,
    );
    await assert.rejects(
      repo.vote(id, outsider!, "one", refreshed.token),
      /NOT_MEMBER/,
    );
    await assert.rejects(
      repo.vote(id, alice!, "one", started.token),
      /STALE_RECOMMENDATION/,
    );
    await repo.vote(id, alice!, "one", refreshed.token);
    await repo.vote(id, bob!, "two", refreshed.token);
    await assert.rejects(
      repo.prepare(id, alice!, currentGroupPolicyConfig()),
      /BOOKING_QUOTE_UNAVAILABLE/,
    );
    await repo.vote(id, bob!, "one", refreshed.token);
    for (const member of [alice!, bob!]) {
      await assert.rejects(
        repo.prepare(id, member, currentGroupPolicyConfig()),
        /BOOKING_QUOTE_UNAVAILABLE/,
      );
    }
    const unpaid = await groups.getOverview(id, bob!);
    assert.equal(unpaid.signingPolicy, null);
    assert.equal(unpaid.group.locked, false);
    assert.equal(unpaid.livePlan?.depositUsdc, null);
    assert.equal(unpaid.livePlan?.merchant, null);
    console.log(
      "Friends DB flow: saved search, invitations, private confirmed preferences, stale-result rejection, all-member recommendation, unanimous selection and rejection of unquoted payments passed.",
    );
  } finally {
    for (const id of groupIds) {
      await pool.query(
        "DELETE FROM converge_group_policies WHERE group_id=$1",
        [id],
      );
      await pool.query("DELETE FROM converge_group_invites WHERE group_id=$1", [
        id,
      ]);
      await pool.query("DELETE FROM converge_participants WHERE group_id=$1", [
        id,
      ]);
      await pool.query("DELETE FROM converge_groups WHERE id=$1", [id]);
    }
    for (const id of searches)
      await pool.query("DELETE FROM converge_discovery_searches WHERE id=$1", [
        id,
      ]);
    for (const id of runs)
      await pool.query("DELETE FROM converge_explore_runs WHERE id=$1", [id]);
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});
