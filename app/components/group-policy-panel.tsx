import Link from "next/link";
import { formatUnits } from "viem";
import { ShieldCheck } from "lucide-react";
import type { GroupOverview } from "../../src/lib/group-view";

const money = (value: string) => `${formatUnits(BigInt(value), 6)} MockUSDC`;

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
  const selected = evaluation?.catalog.find(
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
  return (
    <div className="flow-grid">
      <section className="flow-panel">
        <div className="panel-heading">
          <h2>{policy ? "Immutable signing policy" : "Spending terms"}</h2>
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
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd
                className={
                  value?.startsWith("0x") ? "address-value" : undefined
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
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
      </section>
      <section className="flow-panel">
        <ShieldCheck size={26} />
        <h2>
          {expired
            ? "This policy has expired"
            : policy
              ? "Policy prepared for review"
              : selected
                ? "Prepare your group's policy"
                : "Approval is not available yet"}
        </h2>
        <p>
          {expired
            ? "This saved policy cannot be renewed or reused. A new group decision with fresh approvals is required."
            : policy
              ? "On-chain registration and contribution are not connected to this group yet. No wallet transaction is requested by this page."
              : selected
                ? "Preparation locks the merchant, amounts and six participant wallets into one policy. It expires in up to one hour, before the reservation begins. No transaction is sent."
                : "First confirm all six participants' preferences and run the group evaluation."}
        </p>
        {!policy && selected && (
          <button
            className="primary"
            disabled={busy || !onPrepare}
            onClick={onPrepare}
          >
            {busy ? "Preparing policy…" : "Prepare signing policy"}
          </button>
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
