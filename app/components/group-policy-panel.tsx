import Link from "next/link";
import { formatUnits } from "viem";
import { ShieldCheck } from "lucide-react";
import type { GroupOverview } from "../../src/lib/group-view";
import { GroupChainPanel } from "./group-chain-panel";
import { CalendarPanel } from "./calendar-panel";
import { unanimousPlace } from "../../src/lib/discovery/live-plan";

const money = (value: string) => `${formatUnits(BigInt(value), 6)} USDC`;

export function GroupPolicyPanel({
  overview,
  busy,
  onPrepare,
}: {
  overview: GroupOverview;
  busy: boolean;
  onPrepare?: (() => void) | undefined;
}) {
  const { evaluation, signingPolicy } = overview;
  const livePlace =
    overview.livePlan &&
    unanimousPlace(
      overview.livePlan,
      overview.participants.map((member) => member.walletAddress),
      overview.group.targetMemberCount,
    );
  const selected = livePlace
    ? {
        ...livePlace,
        merchant: overview.livePlan!.merchant,
        depositBaseUnits: signingPolicy?.policy.paymentAmount ?? "0",
      }
    : evaluation?.catalog.find(
        (candidate) => candidate.id === evaluation.winnerId,
      );
  const policy = signingPolicy?.policy;
  const expired = !!policy && policy.expiry <= Math.floor(Date.now() / 1000);
  const root = `/group/${encodeURIComponent(overview.group.id)}`;
  const details = [
    ["Merchant", selected?.name ?? "Not selected"],
    [
      "Merchant address",
      policy?.merchant ?? selected?.merchant ?? "Not available",
    ],
    [
      "Your contribution",
      policy
        ? money(policy.contributionPerParticipant)
        : evaluation
          ? money(evaluation.terms.contributionPerParticipant)
          : "Not available",
    ],
    [
      "Exact payment",
      policy
        ? money(policy.paymentAmount)
        : selected
          ? money(selected.depositBaseUnits)
          : "Not available",
    ],
    [
      "Maximum deposit",
      policy
        ? money(policy.maxDeposit)
        : evaluation
          ? money(evaluation.terms.maxDeposit)
          : "Not available",
    ],
    [
      "Total spending cap",
      policy
        ? money(policy.maxTotalSpend)
        : evaluation
          ? money(evaluation.terms.maxTotalSpend)
          : "Not available",
    ],
    [
      "Approval threshold",
      policy
        ? `${policy.approvalThreshold} of ${policy.participants.length}`
        : "Awaiting a signing policy",
    ],
    [
      "Network",
      policy
        ? `Ethereum Sepolia (${policy.chainId})`
        : "Awaiting a signing policy",
    ],
    ["Token address", policy?.token ?? "Not available"],
    ["Escrow contract", policy?.verifyingContract ?? "Not available"],
    ["Executor", policy?.executor ?? "Not available"],
    [
      "Expiry",
      policy
        ? new Date(policy.expiry * 1000).toLocaleString()
        : "Set when prepared",
    ],
    ["Policy hash", signingPolicy?.policyHash ?? "Not available"],
    ["Decision ID", policy?.decisionId ?? "Not available"],
    ["Reservation reference", policy?.reservationReference ?? "Not available"],
  ];
  const verificationLabels = new Set([
    "Merchant address",
    "Token address",
    "Escrow contract",
    "Executor",
    "Policy hash",
    "Decision ID",
    "Reservation reference",
  ]);
  const termRows = (rows: typeof details) =>
    rows.map(([label, value]) => (
      <div key={label}>
        <dt>{label}</dt>
        <dd className={value?.startsWith("0x") ? "address-value" : undefined}>
          {value}
        </dd>
      </div>
    ));
  return (
    <div className="flow-grid">
      <section className="flow-panel">
        <div className="payment-summary">
          <span>Your share of the group deposit</span>
          <strong>
            {policy
              ? money(policy.contributionPerParticipant)
              : evaluation
                ? money(evaluation.terms.contributionPerParticipant)
                : "Not calculated yet"}
          </strong>
          <span>Test tokens on Sepolia · No real booking</span>
        </div>
        <div className="panel-heading">
          <h2>{policy ? "Your shared spending plan" : "Spending terms"}</h2>
          <span className="pill">
            {expired
              ? "Expired"
              : policy
                ? "Saved · not chain-verified"
                : selected
                  ? "Proposal only"
                  : "Awaiting proposal"}
          </span>
        </div>
        <p className="flow-muted">
          {policy
            ? "Every participant reviews this same saved policy and hash. Saving it does not approve or transfer tokens."
            : "Prepare a complete policy from the group's frozen evaluation. Terms cannot be edited after preparation."}
        </p>
        <dl className="terms-list">
          {termRows(
            details.filter(([label]) => !verificationLabels.has(label!)),
          )}
        </dl>
        <details className="policy-details">
          <summary>Contract addresses & verification details</summary>
          <p className="flow-muted">
            Inspect the token, escrow, executor, and exact policy identifiers
            before signing.
          </p>
          <dl className="terms-list">
            {termRows(
              details.filter(([label]) => verificationLabels.has(label!)),
            )}
          </dl>
        </details>
        {policy && (
          <details>
            <summary>
              Participant wallets ({policy.participants.length})
            </summary>
            <ol className="policy-wallets">
              {policy.participants.map((wallet) => (
                <li className="address-value" key={wallet}>
                  {wallet}
                </li>
              ))}
            </ol>
          </details>
        )}
        <Link className="text-button" href={`${root}/results`}>
          ← Back to results
        </Link>
        {selected && <CalendarPanel overview={overview} />}
      </section>
      <section className="flow-panel">
        <ShieldCheck size={26} />
        <h2>
          {expired
            ? "This policy has expired"
            : policy
              ? "Approve and pay your share"
              : selected
                ? "Ready to agree on the costs?"
                : "Approval is not available yet"}
        </h2>
        <p>
          {expired
            ? "This saved policy cannot be renewed or reused. A new group decision with fresh approvals is required."
            : policy
              ? "Register this saved policy, then each participant allows and contributes their exact share from their own wallet."
              : selected
                ? "Preparation locks the merchant, amounts and all participant wallets into one policy. It expires in up to one hour, before the reservation begins. No transaction is sent."
                : "First confirm every participant's preferences and run the group evaluation."}
        </p>
        {!policy && selected && (
          <button
            className="primary"
            disabled={busy || !onPrepare}
            onClick={onPrepare}
          >
            {busy ? "Saving terms…" : "Save these terms for everyone"}
          </button>
        )}
        {signingPolicy && (
          <GroupChainPanel
            autoTestFunds={Boolean(overview.livePlan?.testPayment)}
            key={signingPolicy.policyHash}
            groupId={overview.group.id}
            saved={signingPolicy}
          />
        )}
        <ol className="approval-steps">
          <li>
            <strong>Review the policy</strong>
            <p>Check the merchant, token, network, amounts, expiry and hash.</p>
          </li>
          <li>
            <strong>Register on chain</strong>
            <p>
              The saved decision must be registered and verified before
              contributions.
            </p>
          </li>
          <li>
            <strong>Allow tokens, then contribute</strong>
            <p>
              Each participant signs for the same policy. Two wallet
              confirmations may be needed.
            </p>
          </li>
        </ol>
        <p className="flow-note">
          Ordinary groups use their own wallets and funds. No automated
          participants or demo funding are added.
        </p>
      </section>
    </div>
  );
}
