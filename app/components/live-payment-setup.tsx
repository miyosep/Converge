"use client";
import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import type { GroupOverview } from "../../src/lib/group-view";
import { livePaymentTermsSchema } from "../../src/lib/discovery/live-payment";
export function LivePaymentSetup({
  overview,
  placeId,
  busy,
  onSave,
}: {
  overview: GroupOverview;
  placeId: string;
  busy: boolean;
  onSave: (terms: unknown) => void;
}) {
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [accepted, setAccepted] = useState(false);
  const terms = {
    amount,
    recipient,
    placeId,
    recommendationRevision: overview.livePlan?.recommendationRevision,
    acknowledgeTestPayment: accepted,
  };
  const valid = livePaymentTermsSchema.safeParse(terms).success;
  const count = BigInt(overview.group.targetMemberCount);
  const share = /^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$/.test(amount)
    ? formatUnits((parseUnits(amount, 6) + count - 1n) / count, 6)
    : null;
  return (
    <section aria-labelledby="booking-terms-title">
      <h3 id="booking-terms-title">Your shared payment</h3>
      <p>Sepolia test tokens. This does not book or pay the venue.</p>
      {overview.group.isCreator ? (
        <>
          <label htmlFor="group-payment-amount">Group payment (MockUSDC)</label>
          <input
            id="group-payment-amount"
            inputMode="decimal"
            value={amount}
            disabled={busy}
            onChange={(event) => {
              setAmount(event.target.value);
              setAccepted(false);
            }}
            placeholder="Enter the agreed test amount"
          />
          <label htmlFor="group-payment-recipient">Test recipient wallet</label>
          <input
            id="group-payment-recipient"
            value={recipient}
            disabled={busy}
            onChange={(event) => {
              setRecipient(event.target.value);
              setAccepted(false);
            }}
            placeholder="0x…"
          />
          {share && (
            <p>
              Each person contributes {share} MockUSDC. Any rounding remainder
              can be claimed after payment.
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={accepted}
              disabled={busy}
              onChange={(event) => setAccepted(event.target.checked)}
            />{" "}
            I have checked the amount and recipient. These test terms will be
            fixed for everyone to review.
          </label>
          <button
            type="button"
            className="primary"
            disabled={busy || !valid}
            onClick={() => onSave(terms)}
          >
            Set payment terms
          </button>
          <p>
            No payment now. Everyone approves separately in their own wallet.
          </p>
        </>
      ) : (
        <p>
          Your organizer will set the amount and test recipient. You can review
          both before approving.
        </p>
      )}
    </section>
  );
}
