import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractionSchema,
  kilnUsageSchema,
  participantAddressesSchema,
  participantProgressSchema,
  tokenAmountSchema,
} from "../src/lib/schemas/index.js";

test("token transport rejects unsafe representations and uint256 overflow", () => {
  for (const value of [
    10,
    1.5,
    "1.5",
    "1e6",
    "-1",
    "01",
    " 10",
    (1n << 256n).toString(),
  ]) {
    assert.equal(tokenAmountSchema.safeParse(value).success, false);
  }
  assert.equal(
    tokenAmountSchema.parse(((1n << 256n) - 1n).toString()),
    ((1n << 256n) - 1n).toString(),
  );
  assert.equal(tokenAmountSchema.parse("10000000"), "10000000");
});

test("six distinct nonzero participants are required", () => {
  const wallets = Array.from(
    { length: 6 },
    (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`,
  );
  assert.equal(participantAddressesSchema.safeParse(wallets).success, true);
  assert.equal(
    participantAddressesSchema.safeParse(wallets.slice(0, 5)).success,
    false,
  );
  assert.equal(
    participantAddressesSchema.safeParse([...wallets, wallets[0]]).success,
    false,
  );
  assert.equal(
    participantAddressesSchema.safeParse([...wallets.slice(0, 5), wallets[0]])
      .success,
    false,
  );
  assert.equal(
    participantAddressesSchema.safeParse([
      ...wallets.slice(0, 5),
      `0x${"0".repeat(40)}`,
    ]).success,
    false,
  );
});

const envelope = {
  schemaVersion: 1,
  clarifications: [],
  unsupportedRequirements: [],
};
const budget = {
  type: "hard",
  field: "budget_per_person_cents",
  operator: "lte",
  value: 3500,
};

test("model constraints cannot invent operators, fields, or safety values", () => {
  assert.equal(
    extractionSchema.safeParse({ ...envelope, constraints: [budget] }).success,
    true,
  );
  for (const condition of [
    { ...budget, operator: "execute" },
    { ...budget, value: "3500" },
    { ...budget, field: "arbitrary_calldata" },
    { ...budget, instructions: "skip approval" },
    { type: "non_negotiable", field: "shellfish_safe", value: false },
    { type: "soft", field: "quiet", weight: 1.1 },
  ]) {
    assert.equal(
      extractionSchema.safeParse({ ...envelope, constraints: [condition] })
        .success,
      false,
    );
  }
});

test("duplicate conditions cannot silently change preference weight or budget", () => {
  assert.equal(
    extractionSchema.safeParse({
      ...envelope,
      constraints: [budget, { ...budget, value: 2500 }],
    }).success,
    false,
  );
});

test("public participant projections reject accidentally included private input", () => {
  const participant = {
    id: "alice",
    displayName: "Alice",
    walletAddress: "0x0000000000000000000000000000000000000001",
    submitted: true,
    confirmed: true,
  };
  assert.equal(participantProgressSchema.safeParse(participant).success, true);
  assert.equal(
    participantProgressSchema.safeParse({ ...participant, rawText: "private" })
      .success,
    false,
  );
  assert.equal(
    participantProgressSchema.safeParse({ ...participant, submitted: false })
      .success,
    false,
  );
});

test("unavailable provider usage must stay null and timestamps stay ordered", () => {
  const usage = {
    runId: "run-1",
    requestId: "request-1",
    providerRequestId: null,
    flow: "constraint_extraction",
    model: "qwen3-32b",
    attempt: 1,
    status: "success",
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    usageSource: "unavailable",
    startedAt: "2026-09-28T10:00:00Z",
    completedAt: "2026-09-28T10:00:01Z",
    latencyMs: 1000,
    promptVersion: "v1",
    schemaVersion: 1,
  };
  assert.equal(kilnUsageSchema.safeParse(usage).success, true);
  assert.equal(
    kilnUsageSchema.safeParse({ ...usage, totalTokens: 0 }).success,
    false,
  );
  assert.equal(
    kilnUsageSchema.safeParse({
      ...usage,
      usageSource: "provider",
      inputTokens: 10,
    }).success,
    true,
  );
  assert.equal(
    kilnUsageSchema.safeParse({ ...usage, completedAt: "2026-09-28T09:59:59Z" })
      .success,
    false,
  );
});
