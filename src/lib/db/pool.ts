import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { verifiedPostgresUrl } from "./connection.js";

let pool: Pool | undefined;
export function databasePool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    pool = new Pool({
      connectionString: verifiedPostgresUrl(url),
      max: 5,
      connectionTimeoutMillis: 15000,
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
