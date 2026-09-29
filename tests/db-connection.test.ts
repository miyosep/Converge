import assert from "node:assert/strict";
import test from "node:test";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";

test("Neon require URLs are upgraded to explicit full certificate verification", () => {
  const output = verifiedPostgresUrl(
    "postgresql://user:pass@example.neon.tech/db?sslmode=require",
  );
  assert.equal(new URL(output).searchParams.get("sslmode"), "verify-full");
});

test("PostgreSQL URLs without certificate verification are rejected", () => {
  for (const url of [
    "postgresql://user:pass@example.neon.tech/db",
    "postgresql://user:pass@example.neon.tech/db?sslmode=disable",
    "https://example.neon.tech/db?sslmode=require",
  ])
    assert.throws(() => verifiedPostgresUrl(url));
});
