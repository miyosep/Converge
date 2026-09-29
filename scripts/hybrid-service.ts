import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  statSync,
  renameSync,
  rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configIndex = process.argv.indexOf("--config");
if (configIndex >= 0 && !process.argv[configIndex + 1])
  throw new Error("CONFIG_PATH_REQUIRED");
const envFile = resolve(
  root,
  configIndex >= 0 ? process.argv[configIndex + 1]! : ".env.hybrid",
);
if (!existsSync(envFile))
  throw new Error("Create .env.hybrid using docs/HYBRID_PC.md first.");
let stopping = false;
let child: ReturnType<typeof spawn> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    child?.kill();
  });
const background = process.argv.includes("--background");
const log = resolve(root, ".hybrid", "processor.log");
if (background) mkdirSync(dirname(log), { recursive: true });
while (!stopping) {
  if (background && existsSync(log) && statSync(log).size > 10_000_000) {
    rmSync(`${log}.previous`, { force: true });
    renameSync(log, `${log}.previous`);
  }
  const fd = background ? openSync(log, "a", 0o600) : undefined;
  child = spawn(
    process.execPath,
    [`--env-file=${envFile}`, "--import", "tsx", "scripts/hybrid-worker.ts"],
    {
      cwd: root,
      windowsHide: true,
      stdio: fd === undefined ? "inherit" : ["ignore", fd, fd],
    },
  );
  await new Promise<void>((done) => {
    child!.once("exit", () => done());
    child!.once("error", () => done());
  });
  if (fd !== undefined) closeSync(fd);
  if (!stopping) {
    console.error(
      "Processor exited; restarting in five seconds. Saved jobs remain in Neon.",
    );
    await sleep(5000);
  }
}
