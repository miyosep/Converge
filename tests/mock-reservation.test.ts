import assert from "node:assert/strict";
import test from "node:test";
import { hashPolicy, policySchema } from "../src/lib/policy.js";
import {
  confirmMockReservation,
  reconcileMockReservation,
  requestMockReservation,
} from "../src/lib/explore/mock-reservation.js";

const policy = policySchema.parse({
  policyVersion: 1,
  chainId: 11155111,
  verifyingContract: "0x0000000000000000000000000000000000000101",
  decisionId: `0x${"11".repeat(32)}`,
  token: "0x0000000000000000000000000000000000000202",
  merchant: "0x0000000000000000000000000000000000000303",
  executor: "0x0000000000000000000000000000000000000404",
  participants: [1, 2, 3, 4, 5, 6].map(
    (n) => `0x${n.toString(16).padStart(40, "0")}`,
  ),
  approvalThreshold: 6,
  contributionPerParticipant: "10000000",
  paymentAmount: "45000000",
  maxDeposit: "60000000",
  maxTotalSpend: "60000000",
  expiry: 2000000000,
  reservationReference: `0x${"22".repeat(32)}`,
});

test("mock reservation remains tied to its policy and only reflects chain outcome", () => {
  assert.ok(hashPolicy(policy));
  const reservation = requestMockReservation(
    policy,
    "Restaurant A",
    "2030-01-05T10:00:00Z",
    "2026-09-29T00:00:00Z",
  );
  assert.equal(reservation.status, "REQUESTED");
  assert.equal(reservation.reference, policy.reservationReference);
  assert.equal(reservation.contactName, "Converge demo group");
  assert.equal(reservation.notes, "");
  const paid = reconcileMockReservation(
    reservation,
    policy,
    "completed",
    "2026-09-29T00:01:00Z",
  )!;
  assert.equal(paid.status, "DEPOSIT_OBSERVED");
  const evidence = {
    hash: `0x${"44".repeat(32)}`,
    decisionId: policy.decisionId,
    merchant: policy.merchant,
    amount: BigInt(policy.paymentAmount),
  };
  const accepted = confirmMockReservation(paid, policy, evidence);
  assert.equal(accepted.status, "DEMO_CONFIRMED");
  assert.equal(accepted.paymentHash, evidence.hash);
  assert.equal(confirmMockReservation(accepted, policy, evidence), accepted);
  assert.equal(
    reconcileMockReservation(accepted, policy, "completed"),
    accepted,
  );
  assert.throws(
    () =>
      confirmMockReservation(paid, policy, {
        ...evidence,
        merchant: "0x0000000000000000000000000000000000000999",
      }),
    /does not match/,
  );
  assert.throws(
    () => confirmMockReservation(reservation, policy, evidence),
    /no observed deposit/,
  );
  assert.equal(reconcileMockReservation(paid, policy, "completed"), paid);
  assert.equal(
    reconcileMockReservation(reservation, policy, "cancelled")?.status,
    "CANCELLED",
  );
  assert.equal(
    reconcileMockReservation(reservation, policy, "expired")?.status,
    "EXPIRED",
  );
  assert.throws(
    () =>
      reconcileMockReservation(
        reservation,
        { ...policy, reservationReference: `0x${"33".repeat(32)}` },
        "completed",
      ),
    /does not match/,
  );
  assert.equal(
    reconcileMockReservation(undefined, policy, "completed"),
    undefined,
  );
});
