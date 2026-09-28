import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required");
const expectedBranch = process.argv[2];
if (!expectedBranch || process.env.NEON_BRANCH !== expectedBranch)
  throw new Error("Pass the expected Neon branch and match NEON_BRANCH");
const url = new URL(connectionString);
if (!url.protocol.startsWith("postgres") || url.hostname.includes("-pooler"))
  throw new Error("Migrations require a direct PostgreSQL connection");

const pool = new Pool({
  connectionString: verifiedPostgresUrl(connectionString),
  max: 1,
  connectionTimeoutMillis: 15000,
});
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('converge:migrations'))",
    );
    await client.query(`CREATE TABLE IF NOT EXISTS converge_schema_migrations (
      name text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = join(process.cwd(), "migrations");
    const names = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    for (const name of names) {
      const sql = await readFile(join(directory, name), "utf8");
      const digest = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ sha256: string }>(
        "SELECT sha256 FROM converge_schema_migrations WHERE name = $1",
        [name],
      );
      if (existing.rows.length) {
        if (existing.rows[0]!.sha256 !== digest)
          throw new Error(`Applied migration changed: ${name}`);
        console.log(`Already applied: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO converge_schema_migrations(name, sha256) VALUES ($1, $2)",
        [name, digest],
      );
      console.log(`Applied: ${name}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
