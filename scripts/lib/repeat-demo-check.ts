import assert from "node:assert/strict";
import type { ExploreStore } from "../../src/lib/explore/store.js";
import { walletId } from "../../src/lib/explore/store.js";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

export async function verifyRepeatDemo(store: ExploreStore, ids: string[]) {
  const alice = privateKeyToAccount(generatePrivateKey()).address;
  const bob = privateKeyToAccount(generatePrivateKey()).address;
  const first = await store.create(alice, 1);
  ids.push(first.id);
  assert.equal(first.id, walletId(alice));
  first.phase = "completed";
  first.refund = "2500000";
  first.transactions = [
    { label: "old payment", hash: `0x${"a".repeat(64)}`, confirmed: true },
  ];
  await store.withRunLock(first.id, () => store.save(first));
  const other = await store.create(bob, 1);
  ids.push(other.id);
  await assert.rejects(store.create(alice, 1, first.id), /DEMO_SESSION_LIMIT/);
  other.phase = "cancelled";
  await store.withRunLock(other.id, () => store.save(other));
  const next = await store.create(alice, 1, first.id);
  ids.push(next.id);
  assert.notEqual(next.id, first.id);
  assert.equal(next.previousRunId, first.id);
  assert.equal(next.sequence, 1);
  assert.equal((await store.create(alice, 1, first.id)).id, next.id);
  assert.equal((await store.create(alice, 1)).id, next.id);
  assert.deepEqual(await store.read(first.id), first);
  assert.equal((await store.owned(alice, first.id))?.refund, "2500000");
  await assert.rejects(store.owned(bob, first.id), /RUN_NOT_FOUND/);
  await assert.rejects(
    store.queue(alice, { action: "search", text: "dinner" }, first.id),
    /DEMO_SESSION_REPLACED/,
  );
  await assert.rejects(
    store.queue(bob, { action: "search", text: "dinner" }, next.id),
    /RUN_NOT_FOUND/,
  );
  await store.queue(alice, { action: "search", text: "dinner" }, next.id);
  await assert.rejects(store.create(alice, 1, next.id), /FINISH_CURRENT_DEMO/);
  const pending = (await store.read(next.id))!;
  delete pending.command;
  pending.phase = "approval";
  await store.withRunLock(pending.id, () => store.save(pending));
  await assert.rejects(store.create(alice, 1, next.id), /FINISH_CURRENT_DEMO/);
  pending.phase = "review";
  pending.searchCalls = 3;
  await store.withRunLock(pending.id, () => store.save(pending));
  const third = await store.create(alice, 1, next.id);
  ids.push(third.id);
  assert.equal(third.sequence, 2);
  assert.equal(third.searchCalls, undefined);
  assert.equal((await store.owned(alice))?.id, third.id);
}
