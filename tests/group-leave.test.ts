import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PreferenceRepository } from "../src/lib/db/preferences.js";

const groupId = "6ca627f4-4a3a-49ab-98ce-35ca294ed20c";
const creator = `0x${"1".padStart(40, "0")}`;
const successor = `0x${"2".padStart(40, "0")}`;

function repository(input: {
  locked?: boolean;
  member?: boolean;
  successor?: boolean;
}) {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes("SELECT creator_wallet"))
        return {
          rows: [
            {
              creator_wallet: creator,
              preferences_locked: input.locked ?? false,
            },
          ],
        };
      if (sql.includes("SELECT 1 FROM converge_participants"))
        return { rows: input.member === false ? [] : [{ "?column?": 1 }] };
      if (sql.includes("SELECT wallet_address FROM converge_participants"))
        return {
          rows:
            input.successor === false ? [] : [{ wallet_address: successor }],
        };
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { repo: new PreferenceRepository(pool), statements };
}

test("a member can leave before evaluation and creator rights pass to a remaining member", async () => {
  const { repo, statements } = repository({});
  assert.deepEqual(await repo.leaveGroup(groupId, creator), {
    deletedGroup: false,
  });
  const sql = statements.join("\n");
  assert.match(sql, /DELETE FROM converge_kiln_attempts/);
  assert.match(sql, /DELETE FROM converge_preference_revisions/);
  assert.match(sql, /UPDATE converge_groups SET creator_wallet/);
  assert.match(sql, /DELETE FROM converge_participants/);
  assert.doesNotMatch(sql, /DELETE FROM converge_groups WHERE/);
  assert.equal(statements.at(-1), "COMMIT");
});

test("last member leaving removes the empty group", async () => {
  const { repo, statements } = repository({ successor: false });
  assert.deepEqual(await repo.leaveGroup(groupId, creator), {
    deletedGroup: true,
  });
  assert.match(statements.at(-2)!, /DELETE FROM converge_groups WHERE/);
  assert.equal(statements.at(-1), "COMMIT");
});

test("locked groups and nonmembers cannot leave or delete preferences", async () => {
  for (const input of [{ locked: true }, { member: false }]) {
    const { repo, statements } = repository(input);
    await assert.rejects(
      repo.leaveGroup(groupId, creator),
      new RegExp(input.locked ? "GROUP_LOCKED" : "NOT_MEMBER"),
    );
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.ok(!statements.some((sql) => sql.startsWith("DELETE")));
  }
});
