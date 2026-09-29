import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyRepeatDemo } from "../scripts/lib/repeat-demo-check.js";
import { occupiesDemoSlot } from "../src/lib/explore/sessions";
import { ExploreStore, walletId } from "../src/lib/explore/store.js";

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

test("idle pre-payment sessions release capacity and returning wallets must reacquire it", async () => {
  const root = await mkdtemp(join(tmpdir(), "converge-idle-"));
  const previous = process.env.EXPLORE_DEMO_MAX_RUNS;
  process.env.EXPLORE_DEMO_MAX_RUNS = "1";
  try {
    const store = new ExploreStore(root);
    const first = await store.create(alice, 1);
    first.createdAt = "2020-01-01T00:00:00Z";
    await store.save(first);
    await store.create(bob, 1);
    assert.ok(
      await store.read(first.id),
      "history survives capacity reclamation",
    );
    await assert.rejects(store.create(alice, 1), /DEMO_SESSION_LIMIT/);
    await assert.rejects(
      store.queue(alice, { action: "extract", text: "Quiet" }, first.id),
      /DEMO_SESSION_LIMIT/,
    );
    const second = (await store.owned(bob))!;
    second.phase = "completed";
    await store.save(second);
    const resumed = await store.create(alice, 1);
    assert.equal(resumed.id, first.id);
    assert.ok(resumed.lastActiveAt);
    await store.queue(alice, { action: "extract", text: "Quiet" }, first.id);
    assert.equal((await store.read(first.id))!.command?.action, "extract");
  } finally {
    if (previous === undefined) delete process.env.EXPLORE_DEMO_MAX_RUNS;
    else process.env.EXPLORE_DEMO_MAX_RUNS = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("pending work and financial records never lose their active capacity through age", () => {
  const run = {
    id: "a".repeat(64),
    judge: alice,
    revision: 0,
    extractionCalls: 0,
    approvals: 0,
    contributions: [],
    refund: "0",
    refunded: false,
    createdAt: "2020-01-01T00:00:00Z",
    phase: "preferences",
    transactions: [],
  } as import("../src/lib/explore/types").ExploreRun;
  assert.equal(occupiesDemoSlot(run), false);
  assert.equal(
    occupiesDemoSlot({
      ...run,
      phase: "proposal",
      policy: {} as NonNullable<typeof run.policy>,
    }),
    false,
    "an unfunded draft policy does not hold a slot forever",
  );
  assert.equal(
    occupiesDemoSlot({
      ...run,
      phase: "preparing",
      policy: {} as NonNullable<typeof run.policy>,
    }),
    true,
  );
  assert.equal(
    occupiesDemoSlot({ ...run, command: { action: "prepare" } }),
    true,
  );
  assert.equal(occupiesDemoSlot({ ...run, searchInFlight: true }), true);
  assert.equal(
    occupiesDemoSlot({
      ...run,
      transactions: [
        { label: "funds", hash: `0x${"1".repeat(64)}`, confirmed: true },
      ],
    }),
    true,
  );
});
