import { createHash } from "node:crypto";
const hash = (sql: string) => createHash("sha256").update(sql).digest("hex");
export const migrationHash = (sql: string) => hash(sql.replace(/\r\n/g, "\n"));
export function migrationHashMatches(sql: string, previous: string) {
  const normalized = sql.replace(/\r\n/g, "\n");
  // Older runners recorded checkout bytes; Windows CRLF and Unix LF must
  // represent the same immutable SQL. Content changes are still rejected.
  return [
    hash(sql),
    hash(normalized),
    hash(normalized.replace(/\n/g, "\r\n")),
  ].includes(previous);
}
