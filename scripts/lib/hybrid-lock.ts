import { readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { demoDirectory, withFileLock } from "../../src/lib/explore/store.js";

export async function withHybridLock<T>(work: () => Promise<T>) {
  const root = demoDirectory();
  await mkdir(root, { recursive: true });
  const path = join(root, "worker.lock");
  try {
    const owner = await readFile(path, "utf8");
    const pid = Number(owner);
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error("INVALID_WORKER_LOCK");
    try {
      process.kill(pid, 0);
      throw new Error("ANOTHER_LOCAL_WORKER_IS_RUNNING");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      // Recover only an exited process's lock; never stop an existing signer.
      if ((await readFile(path, "utf8")) !== owner)
        throw new Error("WORKER_LOCK_CHANGED");
      await unlink(path);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return withFileLock(path, work);
}
