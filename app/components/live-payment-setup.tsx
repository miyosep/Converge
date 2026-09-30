"use client";
import type { GroupOverview } from "../../src/lib/group-view";
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
  return (
    <section aria-labelledby="booking-terms-title">
      <h3 id="booking-terms-title">Ready to approve together</h3>
      {overview.group.isCreator ? (
        <>
          <p>Review your Sepolia test payment next. No payment now.</p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              onSave({
                placeId,
                recommendationRevision:
                  overview.livePlan?.recommendationRevision,
                acknowledgeTestPayment: true,
              })
            }
          >
            {busy ? "Preparing..." : "Continue to approval"}
          </button>
        </>
      ) : (
        <p>
          Your organizer can continue to approval. Everyone reviews and approves
          separately.
        </p>
      )}
    </section>
  );
}
