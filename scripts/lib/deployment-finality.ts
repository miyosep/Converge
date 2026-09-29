import { setTimeout as sleep } from "node:timers/promises";
import type { Hex } from "viem";

export async function waitUntilFinalized(options: {
  blockNumber: bigint;
  blockHash: Hex;
  finalizedBlockNumber: () => Promise<bigint>;
  canonicalBlockHash: (number: bigint) => Promise<Hex>;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => sleep(ms));
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const pollMs = options.pollMs ?? 6000;
  const deadline = now() + timeoutMs;
  do {
    const canonicalHash = await options.canonicalBlockHash(options.blockNumber);
    if (canonicalHash.toLowerCase() !== options.blockHash.toLowerCase())
      throw new Error(
        "Deployment block was reorganized; inspect the saved transaction before retrying",
      );
    if ((await options.finalizedBlockNumber()) >= options.blockNumber) {
      const confirmedHash = await options.canonicalBlockHash(
        options.blockNumber,
      );
      if (confirmedHash.toLowerCase() !== options.blockHash.toLowerCase())
        throw new Error(
          "Deployment block was reorganized; inspect the saved transaction before retrying",
        );
      return;
    }
    if (now() >= deadline) break;
    await wait(pollMs);
  } while (true);
  throw new Error(
    "Deployment is not finalized yet; rerun with the saved transaction journal",
  );
}
