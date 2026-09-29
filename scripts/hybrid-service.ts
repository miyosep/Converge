import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  statSync,
  renameSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { hybridEnvironment } from "./lib/hybrid-environment.js";

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
const checking = process.argv.includes("--check");
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
    [
      "--import",
      "tsx",
      "scripts/hybrid-worker.ts",
      ...(checking ? ["--check"] : []),
    ],
    {
      cwd: root,
      env: hybridEnvironment(
        process.env,
        readFileSync(resolve(root, ".env.example"), "utf8"),
        readFileSync(envFile, "utf8"),
      ),
      windowsHide: true,
      stdio: fd === undefined ? "inherit" : ["ignore", fd, fd],
    },
  );
  const exitCode = await new Promise<number>((done) => {
    child!.once("exit", (code) => done(code ?? 1));
    child!.once("error", () => done(1));
  });
  if (fd !== undefined) closeSync(fd);
  if (checking) {
    process.exitCode = exitCode;
    break;
  }
  if (!stopping) {
    console.error(
      "Processor exited; restarting in five seconds. Saved jobs remain in Neon.",
    );
    await sleep(5000);
  }
}
