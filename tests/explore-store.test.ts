import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyRepeatDemo } from "../scripts/lib/repeat-demo-check.js";
import {
  ExploreStore,
  verifyAccessCode,
  walletId,
} from "../src/lib/explore/store.js";

const alice = "0x0000000000000000000000000000000000000011";
const bob = "0x0000000000000000000000000000000000000022";
test("repeat demos preserve refunds and journals, release completed capacity and reject stale or foreign actions", async () => {
  const root = await mkdtemp(join(tmpdir(), "converge-repeat-"));
  try {
    await verifyRepeatDemo(new ExploreStore(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Explore admission is idempotent per wallet and enforces the total limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "converge-explore-"));
  try {
    const store = new ExploreStore(root);
    const first = await store.create(alice, 1);
    assert.deepEqual(await store.create(alice, 1), first);
    await assert.rejects(store.create(bob, 1), /DEMO_SESSION_LIMIT/);
    assert.equal((await store.ids()).length, 1);
    assert.throws(() => store.read("../private"), /INVALID_RUN/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Explore commands reject stale confirmation, duplicate requests, and funding before a policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "converge-explore-"));
  try {
    const store = new ExploreStore(root);
    await store.create(alice, 2);
    await assert.rejects(
      store.queue(alice, { action: "prepare" }),
      /POLICY_NOT_READY/,
    );
    await store.queue(alice, { action: "extract", text: "Quiet" });
    await assert.rejects(
      store.queue(alice, { action: "extract", text: "Cheap" }),
      /DEMO_BUSY/,
    );
    const state = (await store.read(walletId(alice)))!;
    delete state.command;
    state.phase = "review";
    state.revision = 2;
    state.extraction = {
      schemaVersion: 1,
      constraints: [],
      clarifications: [],
      unsupportedRequirements: [],
    };
    await store.save(state);
    await assert.rejects(
      store.queue(alice, {
        action: "confirm",
        revision: 1,
        extraction: state.extraction,
      }),
      /STALE_REVISION/,
    );
    await assert.rejects(
      store.queue(bob, { action: "prepare" }),
      /RUN_NOT_FOUND/,
    );
    state.phase = "proposal";
    await store.save(state);
    await assert.rejects(
      store.queue(alice, { action: "extract", text: "Change policy" }),
      /LOCKED/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Demo access code is checked without accepting prefixes or missing values", () => {
  verifyAccessCode("event-pass", "event-pass");
  assert.throws(
    () => verifyAccessCode("event-pass", "event"),
    /INVALID_DEMO_CODE/,
  );
  assert.throws(() => verifyAccessCode("event-pass", ""), /INVALID_DEMO_CODE/);
});
