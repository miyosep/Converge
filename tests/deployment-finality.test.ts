import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atomicWrite } from "../scripts/lib/atomic-file.js";
import { waitUntilFinalized } from "../scripts/lib/deployment-finality.js";

const hash = `0x${"a".repeat(64)}` as const;

test("deployment receipt waits for finalized height and canonical block", async () => {
  let finalized = 8n;
  let checks = 0;
  await waitUntilFinalized({
    blockNumber: 10n,
    blockHash: hash,
    finalizedBlockNumber: async () => finalized,
    canonicalBlockHash: async () => {
      checks++;
      return hash;
    },
    wait: async () => {
      finalized++;
    },
    pollMs: 1,
  });
  assert.equal(finalized, 10n);
  assert.equal(checks, 4);
});

test("reorganized or unfinalized deployment cannot be finalized", async () => {
  await assert.rejects(
    waitUntilFinalized({
      blockNumber: 10n,
      blockHash: hash,
      finalizedBlockNumber: async () => 10n,
      canonicalBlockHash: async () => `0x${"b".repeat(64)}`,
    }),
    /reorganized/,
  );
  let current = 0;
  await assert.rejects(
    waitUntilFinalized({
      blockNumber: 10n,
      blockHash: hash,
      finalizedBlockNumber: async () => 9n,
      canonicalBlockHash: async () => hash,
      timeoutMs: 2,
      pollMs: 1,
      now: () => current,
      wait: async () => {
        current++;
      },
    }),
    /not finalized/,
  );
});

test("deployment journal replacement is atomic and leaves no temporary file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "converge-deploy-"));
  const path = join(directory, "deployment.pending.json");
  try {
    await atomicWrite(path, "first");
    await atomicWrite(path, "second");
    assert.equal(await readFile(path, "utf8"), "second");
    assert.deepEqual(await readdir(directory), ["deployment.pending.json"]);
  } finally {
    await unlink(path);
    await rmdir(directory);
  }
});
