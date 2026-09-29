import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  migrationHash,
  migrationHashMatches,
} from "../scripts/lib/migration-hash.js";

test("migration checksums preserve SQL across LF and legacy CRLF checkouts", () => {
  const sql = "CREATE TABLE example (id text);\n-- immutable\n";
  const windows = sql.replace(/\n/g, "\r\n");
  const oldWindowsHash = createHash("sha256").update(windows).digest("hex");
  assert.equal(migrationHash(windows), migrationHash(sql));
  assert.equal(migrationHashMatches(sql, oldWindowsHash), true);
  assert.equal(migrationHashMatches(windows, migrationHash(sql)), true);
  assert.equal(
    migrationHashMatches(sql.replace("id text", "id integer"), oldWindowsHash),
    false,
  );
  assert.equal(
    migrationHashMatches(sql + "DROP TABLE example;\n", migrationHash(sql)),
    false,
  );
});
