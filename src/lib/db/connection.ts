export function verifiedPostgresUrl(value: string): string {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
    throw new Error("Expected a PostgreSQL connection URL");
  const mode = url.searchParams.get("sslmode");
  if (mode !== "require" && mode !== "verify-full")
    throw new Error("PostgreSQL TLS verification is required");
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
