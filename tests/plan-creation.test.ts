import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { PreferenceRepository } from "../src/lib/db/preferences.js";

const input = {
  name: "Dinner together",
  displayName: "Alex",
  creator: "0x1111111111111111111111111111111111111111",
  targetMemberCount: 4,
  slot: { startsAt: "2099-10-17T14:00:00Z", timeZone: "Asia/Seoul" },
};
function database(failSave = false) {
  const calls: { sql: string; args: unknown[] }[] = [];
  let released = false;
  const pool = {
    connect: async () => ({
      query: async (sql: string, args: unknown[] = []) => {
        calls.push({ sql, args });
        if (
          failSave &&
          sql.includes("INSERT INTO converge_preference_revisions")
        )
          throw new Error("storage unavailable");
        return { rows: [] };
      },
      release: () => {
        released = true;
      },
    }),
  } as unknown as Pool;
  return {
    repository: new PreferenceRepository(pool),
    calls,
    released: () => released,
  };
}

test("creating a plan keeps the initial suggestion private and unconfirmed in the same transaction", async () => {
  const db = database();
  const id = await db.repository.createGroup({
    ...input,
    initialPreferences: "  Quiet Asian food under $40  ",
  });
  const saved = db.calls.find((call) =>
    call.sql.includes("INSERT INTO converge_preference_revisions"),
  );
  assert.ok(saved);
  assert.equal(saved.args[0], id);
  assert.equal(saved.args[1], input.creator);
  assert.equal(saved.args[3], "Quiet Asian food under $40");
  assert.equal(saved.args[4], "PARSING");
  assert.equal(saved.args[5], null);
  assert.equal(saved.args[6], null);
  assert.equal(db.calls[0]?.sql, "BEGIN");
  assert.equal(db.calls.at(-1)?.sql, "COMMIT");
  assert.ok(db.released());
});

test("optional empty suggestions do not create a preference revision", async () => {
  const db = database();
  await db.repository.createGroup({ ...input, initialPreferences: "   " });
  assert.ok(
    !db.calls.some((call) =>
      call.sql.includes("INSERT INTO converge_preference_revisions"),
    ),
  );
  assert.equal(db.calls.at(-1)?.sql, "COMMIT");
});

test("failure to save the suggestion rolls back the plan instead of losing the text", async () => {
  const db = database(true);
  await assert.rejects(
    db.repository.createGroup({ ...input, initialPreferences: "Quiet please" }),
    /storage unavailable/,
  );
  assert.equal(db.calls.at(-1)?.sql, "ROLLBACK");
  assert.ok(!db.calls.some((call) => call.sql === "COMMIT"));
  assert.ok(db.released());
});
