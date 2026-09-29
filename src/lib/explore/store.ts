import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import { addressSchema } from "../schemas/primitives.js";
import { extractionSchema } from "../schemas/constraints.js";
import type { ExploreRun } from "./types.js";

export const commandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("search"),
    text: z.string().trim().min(3).max(2000),
  }),
  z.strictObject({
    action: z.literal("select_place"),
    revision: z.number().int().nonnegative(),
    placeId: z.string().min(1).max(100),
    depositUsdc: z.number().int().min(1).max(60),
    acknowledgeDemo: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("extract"),
    text: z.string().trim().min(1).max(4000),
  }),
  z.strictObject({
    action: z.literal("confirm"),
    revision: z.number().int().nonnegative(),
    extraction: extractionSchema,
  }),
  z.strictObject({ action: z.literal("prepare") }),
]);
export class ExploreError extends Error {}
export function validateLiveCommand(
  run: ExploreRun,
  command: Extract<
    import("./types.js").ExploreCommand,
    { action: "search" | "select_place" }
  >,
) {
  if (run.policy || !["preferences", "review"].includes(run.phase))
    throw new ExploreError("POLICY_LOCKED");
  if (command.action === "search") {
    if ((run.searchCalls ?? 0) >= 3)
      throw new ExploreError("SEARCH_LIMIT_REACHED");
  } else {
    if (
      command.revision !== run.revision ||
      !run.discovery ||
      run.discovery.intent.clarifications.length ||
      !run.discovery.places.some((place) => place.id === command.placeId)
    )
      throw new ExploreError("STALE_OR_UNKNOWN_PLACE");
  }
}
export const demoDirectory = () =>
  resolve(process.env.EXPLORE_DEMO_DIRECTORY || ".demo");
export const walletId = (address: string) =>
  createHash("sha256")
    .update(addressSchema.parse(address).toLowerCase())
    .digest("hex");
export async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(
    temp,
    JSON.stringify(
      value,
      (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  // Windows can briefly deny replacement while another process reads the
  // destination (or a scanner opens it). Keep the completed temp file and
  // retry the same atomic replacement instead of abandoning the run.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, path);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        process.platform !== "win32" ||
        !["EACCES", "EPERM", "EBUSY"].includes(code || "") ||
        attempt >= 9
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
export async function optionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function withFileLock<T>(
  path: string,
  work: () => Promise<T>,
): Promise<T> {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new ExploreError("DEMO_BUSY");
    throw error;
  }
  try {
    await handle.writeFile(String(process.pid));
    return await work();
  } finally {
    await handle.close();
    await unlink(path);
  }
}
export function verifyAccessCode(expected: string | undefined, actual: string) {
  if (!expected) return;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(expected), digest(actual)))
    throw new ExploreError("INVALID_DEMO_CODE");
}
export class ExploreStore {
  constructor(readonly root = demoDirectory()) {}
  withRunLock<T>(id: string, work: () => Promise<T>) {
    return withFileLock(`${this.path(id)}.lock`, work);
  }
  async online() {
    const heartbeat = await optionalJson<{ at: string }>(
      join(this.root, "heartbeat.json"),
    );
    return !!heartbeat && Date.now() - Date.parse(heartbeat.at) < 30_000;
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }
  path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new ExploreError("INVALID_RUN");
    return join(this.root, `${id}.json`);
  }
  read(id: string) {
    return optionalJson<ExploreRun>(this.path(id));
  }
  save(run: ExploreRun) {
    return atomicJson(this.path(run.id), run);
  }
  async ids() {
    await this.init();
    return (await readdir(this.root))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => name.slice(0, -5));
  }
  async create(address: string, maxRuns: number) {
    const judge = addressSchema.parse(address);
    const id = walletId(judge);
    await this.init();
    return withFileLock(join(this.root, "admission.lock"), async () => {
      const existing = await this.read(id);
      if (existing) return existing;
      if ((await this.ids()).length >= maxRuns)
        throw new ExploreError("DEMO_SESSION_LIMIT");
      const run: ExploreRun = {
        id,
        judge,
        createdAt: new Date().toISOString(),
        phase: "preferences",
        revision: 0,
        extractionCalls: 0,
        transactions: [],
        approvals: 0,
        contributions: [],
        refund: "0",
        refunded: false,
      };
      await this.save(run);
      return run;
    });
  }
  async queue(address: string, input: unknown) {
    const command = commandSchema.parse(input);
    const id = walletId(address);
    return withFileLock(`${this.path(id)}.lock`, async () => {
      const run = await this.read(id);
      if (!run || run.judge.toLowerCase() !== address.toLowerCase())
        throw new ExploreError("RUN_NOT_FOUND");
      if (run.command) throw new ExploreError("DEMO_BUSY");
      if (command.action === "search" || command.action === "select_place") {
        validateLiveCommand(run, command);
      } else if (command.action === "extract") {
        if (
          !["preferences", "review"].includes(run.phase) ||
          Boolean(run.searchCalls) ||
          run.extractionCalls >= 3
        )
          throw new ExploreError("EXTRACTION_LIMIT_OR_LOCKED");
      } else if (command.action === "confirm") {
        if (
          run.phase !== "review" ||
          !run.extraction ||
          command.revision !== run.revision
        )
          throw new ExploreError("STALE_REVISION");
      } else if (run.phase !== "proposal")
        throw new ExploreError("POLICY_NOT_READY");
      run.command = command;
      delete run.error;
      await this.save(run);
      return run;
    });
  }
}
