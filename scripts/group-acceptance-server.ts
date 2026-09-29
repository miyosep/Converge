import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

// Keep the ordinary-group acceptance server separate from the interactive demo.
for (const file of [".env", ".env.development"]) {
  Object.assign(process.env, parseEnv(await readFile(file, "utf8")));
}
if (process.env.NEON_BRANCH !== "dev-preferences")
  throw new Error("Development branch required");
const origin = new URL(
  process.env.ACCEPTANCE_ORIGIN || "http://localhost:3010",
);
if (origin.hostname !== "localhost" || !origin.port)
  throw new Error("Use a local acceptance origin with a port");
process.env.APP_ORIGIN = origin.origin;
process.env.CONVERGE_BUILD_DIR = ".next-acceptance";
process.argv = [
  process.argv[0]!,
  "next",
  "dev",
  "--webpack",
  "--port",
  origin.port,
];
await import(pathToFileURL(resolve("node_modules/next/dist/bin/next")).href);
