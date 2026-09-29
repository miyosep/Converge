import type { Policy } from "../policy.js";

export const EXPLORE_DEMO_SLOT = {
  startsAt: "2030-01-05T10:00:00Z",
  timeZone: "Asia/Seoul",
} as const;

export type MockReservation = {
  source: "synthetic-restaurant" | "live-place-demo";
  reference: string;
  decisionId: string;
  restaurant: string;
  startsAt: string;
  guests: 6;
  contactName?: "Converge demo group";
  contactEmail?: "demo@converge.invalid";
  notes?: "";
  status:
    | "REQUESTED"
    | "DEPOSIT_OBSERVED"
    | "DEMO_CONFIRMED"
    | "CANCELLED"
    | "EXPIRED";
  requestedAt: string;
  updatedAt: string;
  paymentHash?: string;
  confirmedAt?: string;
};

export type MockPaymentEvidence = {
  hash: string;
  decisionId: string;
  merchant: string;
  amount: bigint;
};

export function requestMockReservation(
  policy: Policy,
  restaurant: string,
  startsAt: string,
  now = new Date().toISOString(),
): MockReservation {
  return {
    source: "synthetic-restaurant",
    reference: policy.reservationReference as `0x${string}`,
    decisionId: policy.decisionId as `0x${string}`,
    restaurant,
    startsAt,
    guests: 6,
    contactName: "Converge demo group",
    contactEmail: "demo@converge.invalid",
    notes: "",
    status: "REQUESTED",
    requestedAt: now,
    updatedAt: now,
  };
}

export function reconcileMockReservation(
  reservation: MockReservation | undefined,
  policy: Policy,
  chainStatus: "completed" | "cancelled" | "expired",
  now = new Date().toISOString(),
): MockReservation | undefined {
  if (!reservation) return undefined;
  if (
    reservation.reference !== policy.reservationReference ||
    reservation.decisionId !== policy.decisionId
  )
    throw new Error("Reservation does not match the policy");
  const status =
    chainStatus === "completed"
      ? "DEPOSIT_OBSERVED"
      : chainStatus === "cancelled"
        ? "CANCELLED"
        : "EXPIRED";
  if (status === "DEPOSIT_OBSERVED" && reservation.status === "DEMO_CONFIRMED")
    return reservation;
  return status === reservation.status
    ? reservation
    : { ...reservation, status, updatedAt: now };
}

export function confirmMockReservation(
  reservation: MockReservation,
  policy: Policy,
  payment: MockPaymentEvidence,
  now = new Date().toISOString(),
): MockReservation {
  if (
    reservation.reference !== policy.reservationReference ||
    reservation.decisionId !== policy.decisionId ||
    payment.decisionId !== policy.decisionId ||
    payment.merchant.toLowerCase() !== policy.merchant.toLowerCase() ||
    payment.amount !== BigInt(policy.paymentAmount) ||
    !/^0x[a-fA-F0-9]{64}$/.test(payment.hash)
  )
    throw new Error("Payment does not match the reservation policy");
  if (reservation.status === "DEMO_CONFIRMED") {
    if (reservation.paymentHash !== payment.hash)
      throw new Error("Reservation already confirmed by another payment");
    return reservation;
  }
  if (reservation.status !== "DEPOSIT_OBSERVED")
    throw new Error("Reservation has no observed deposit");
  return {
    ...reservation,
    status: "DEMO_CONFIRMED",
    paymentHash: payment.hash,
    confirmedAt: now,
    updatedAt: now,
  };
}
