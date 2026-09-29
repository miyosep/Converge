import { ArrowRight, Check, ExternalLink, LoaderCircle } from "lucide-react";
import { formatUnits } from "viem";
import type { ExploreRun } from "../../src/lib/explore/types";

const money = (value: string) => formatUnits(BigInt(value), 6);

export function DemoSharedPlan({
  state,
  pending,
  workerOnline,
  historical,
  onPrepare,
  onTransaction,
}: {
  state: ExploreRun;
  pending: boolean;
  workerOnline: boolean;
  historical: boolean;
  onPrepare: () => void;
  onTransaction: (action: "contribute" | "refund" | "cancel") => void;
}) {
  const policy = state.policy!;
  const completed = state.phase === "completed";
  const terminal = ["completed", "cancelled", "expired"].includes(state.phase);
  const refundable = terminal && BigInt(state.refund) > 0n && !state.refunded;
  const working = ["preparing", "contributing"].includes(state.phase);
  const payment = state.transactions.find(
    (tx) => tx.label === "Reservation payment",
  );
  const title = state.refunded
    ? "All settled"
    : refundable
      ? "Your share is ready to return"
      : completed
        ? "Paid, together"
        : state.phase === "cancelled"
          ? "This plan was cancelled"
          : state.phase === "expired"
            ? "This plan has expired"
            : state.phase === "preparing"
              ? "Getting your group ready"
              : state.phase === "contributing"
                ? state.approvals >= 6
                  ? "Finishing the group payment"
                  : "The others are joining in"
                : state.phase === "approval"
                  ? "Your turn to approve"
                  : "Ready to make it happen?";
  const description = state.refunded
    ? "Your refund is back in your wallet. You can try another demo below."
    : refundable
      ? "Claim the unused part of your contribution in your wallet."
      : completed
        ? "The shared test payment is confirmed."
        : terminal
          ? "This demo has ended. No further payment will be made."
          : state.phase === "preparing"
            ? "Preparing test funds and the shared payment terms. Your wallet approval comes next."
            : state.phase === "contributing"
              ? "You’re done for now. The five automated participants and payment are handled for you."
              : state.phase === "approval"
                ? "Approve your contribution. The other five participants will follow automatically."
                : "Prepare the test funds, then approve your contribution in your wallet.";
  return (
    <section className="explore-section demo-plan-card">
      <div className="demo-plan-topline">
        <span className="demo-kicker">
          A place for <em>your people</em>
        </span>
        <span className="demo-plan-badge">
          {terminal
            ? completed
              ? "Payment complete"
              : "Plan closed"
            : "Chosen for all six"}
        </span>
      </div>
      <h2>{state.restaurant}</h2>
      {state.selectedPlace && (
        <div className="demo-venue-line">
          <span>{state.selectedPlace.address}</span>
          <a
            href={state.selectedPlace.mapsUrl}
            target="_blank"
            rel="noreferrer"
          >
            View place <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      )}
      <dl className="demo-plan-amounts">
        <div>
          <dt>Your contribution</dt>
          <dd>
            {money(policy.contributionPerParticipant)} <small>MockUSDC</small>
          </dd>
        </div>
        <div>
          <dt>Group deposit</dt>
          <dd>
            {money(policy.paymentAmount)} <small>MockUSDC</small>
          </dd>
        </div>
        <div>
          <dt>
            {terminal
              ? state.refunded
                ? "Refund status"
                : "Your refund"
              : "Group approvals"}
          </dt>
          <dd>
            {state.refunded ? (
              "Claimed"
            ) : terminal ? (
              <>
                {money(state.refund)} <small>MockUSDC</small>
              </>
            ) : (
              <>
                {state.approvals} <small>/ {policy.approvalThreshold}</small>
              </>
            )}
          </dd>
        </div>
      </dl>
      <div className="demo-next-action" aria-live="polite">
        <div className="demo-next-copy">
          <h3>
            {working ? (
              <LoaderCircle
                className="demo-working-icon"
                size={18}
                aria-hidden="true"
              />
            ) : terminal ? (
              <Check size={18} aria-hidden="true" />
            ) : null}
            {title}
          </h3>
          <p>{description}</p>
          {state.phase === "approval" && (
            <small>
              Your wallet may ask twice: token allowance, then contribution.
            </small>
          )}
        </div>
        {!historical && state.phase === "proposal" && (
          <button
            className="primary"
            disabled={pending || !workerOnline}
            onClick={onPrepare}
          >
            Prepare group payment <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        {state.phase === "approval" && (
          <button
            className="primary"
            disabled={pending}
            onClick={() => onTransaction("contribute")}
          >
            Approve &amp; contribute {money(policy.contributionPerParticipant)}{" "}
            MockUSDC <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        {refundable && (
          <button
            className="primary"
            disabled={pending}
            onClick={() => onTransaction("refund")}
          >
            Claim {money(state.refund)} MockUSDC{" "}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        {completed && payment?.confirmed && (
          <a
            className="demo-payment-link"
            href={`https://sepolia.etherscan.io/tx/${payment.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            View payment <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </div>
      <p className="demo-plan-footnote">
        Sepolia test tokens · Simulated booking · No real table reserved
      </p>
      {state.groupDecision && (
        <details className="demo-fold">
          <summary>Why this place</summary>
          <p>{state.groupDecision.rationale}</p>
          {!!state.groupDecision.uncertainties?.length && (
            <>
              <p>Still unverified</p>
              <ul>
                {state.groupDecision.uncertainties.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
      <details className="demo-fold">
        <summary>Payment &amp; reservation details</summary>
        <p>
          The deposit goes to a demo recipient. Five automated participants
          approve the same terms.
        </p>
        <dl className="demo-detail-list">
          <div>
            <dt>Spending cap</dt>
            <dd>{money(policy.maxTotalSpend)} MockUSDC</dd>
          </div>
          <div>
            <dt>Maximum deposit</dt>
            <dd>{money(policy.maxDeposit)} MockUSDC</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{new Date(policy.expiry * 1000).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Demo recipient</dt>
            <dd>{policy.merchant}</dd>
          </div>
          {state.reservation && (
            <>
              <div>
                <dt>Simulated booking</dt>
                <dd>
                  {state.reservation.guests} guests ·{" "}
                  {new Date(state.reservation.startsAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>Booking status</dt>
                <dd>
                  {state.reservation.status === "DEMO_CONFIRMED"
                    ? "Demo confirmation recorded"
                    : state.reservation.status === "CANCELLED"
                      ? "Cancelled"
                      : state.reservation.status === "EXPIRED"
                        ? "Expired"
                        : "Demo request recorded"}
                </dd>
              </div>
              <div>
                <dt>Reservation reference</dt>
                <dd>{state.reservation.reference}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Policy hash</dt>
            <dd>{state.policyHash}</dd>
          </div>
          <div>
            <dt>Escrow</dt>
            <dd>{policy.verifyingContract}</dd>
          </div>
          <div>
            <dt>Token</dt>
            <dd>{policy.token}</dd>
          </div>
        </dl>
        {state.rejection && (
          <p>
            The contract rejected an 80 MockUSDC request in a read-only check.
            No transaction was sent.
          </p>
        )}
      </details>
      {["approval", "contributing"].includes(state.phase) && (
        <button
          className="text-button demo-cancel"
          disabled={pending}
          onClick={() => onTransaction("cancel")}
        >
          Cancel this plan
        </button>
      )}
    </section>
  );
}
