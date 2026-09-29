"use client";

import { DiagnosticsList } from "./diagnostics";
import { groupDiagnostics } from "../../src/lib/diagnostics/group";
import { diagnosticMessage } from "../../src/lib/diagnostics/errors";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, LockKeyhole, RefreshCw, Users } from "lucide-react";
import { formatUnits } from "viem";
import { scorePercent, type GroupOverview } from "../../src/lib/group-view";
import { GroupPolicyPanel } from "./group-policy-panel";
import { GroupInsightsPanel } from "./group-insights-panel";
import { GroupExecutionPanel } from "./group-execution-panel";
import { LeaveGroupButton } from "./leave-group-button";
import { restaurantLabel } from "../../src/lib/restaurant-options";
import {
  GroupNavigation,
  WorkspaceFrame,
  type GroupStage,
} from "./workspace-frame";

const titles = {
  lobby: "Your group",
  preferences: "Your preferences",
  results: "Find the right fit",
  approve: "Review before you sign",
  execution: "Follow the decision",
};
const money = (value: string) => `${formatUnits(BigInt(value), 6)} MockUSDC`;

export function GroupStageContent({
  overview,
  stage,
  busy = false,
  onEvaluate,
  onPreparePolicy,
}: {
  overview: GroupOverview;
  stage: GroupStage;
  busy?: boolean;
  onEvaluate?: (() => void) | undefined;
  onPreparePolicy?: (() => void) | undefined;
}) {
  const { group, participants, evaluation } = overview;
  const targetMemberCount = group.targetMemberCount;
  const root = `/group/${encodeURIComponent(group.id)}`;
  const selected = evaluation?.catalog.find(
    (candidate) => candidate.id === evaluation.winnerId,
  );
  const confirmed = participants.filter((member) => member.confirmed).length;
  if (stage === "lobby")
    return (
      <div className="flow-grid">
        <section className="flow-panel">
          <div className="panel-heading">
            <h2>Your people. One decision.</h2>
            <span className="pill">
              {participants.length} / {targetMemberCount} joined
            </span>
          </div>
          <p className="flow-muted">
            Everyone reviews and confirms their own private requirements.
          </p>
          <p>
            Permitted restaurants:{" "}
            {(group.permittedRestaurantIds ?? ["A", "B", "C", "D", "E"])
              .map(restaurantLabel)
              .join(", ")}
          </p>
          <div className="flow-members">
            {participants.map((person) => (
              <div className="flow-member" key={person.walletAddress}>
                <span className="avatar">
                  {person.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{person.displayName}</strong>
                  <small>
                    {person.walletAddress.slice(0, 6)}…
                    {person.walletAddress.slice(-4)}
                  </small>
                </div>
                <span className={`pill ${person.confirmed ? "positive" : ""}`}>
                  {person.confirmed
                    ? "Confirmed"
                    : person.submitted
                      ? "Review needed"
                      : "Waiting"}
                </span>
              </div>
            ))}
          </div>
          <Link className="primary flow-link" href={`${root}/preferences`}>
            My preferences & invitations <ArrowRight size={16} />
          </Link>
        </section>
        <aside className="flow-panel">
          <span className="eyebrow">GROUP PROGRESS</span>
          <div className="big-number">
            {confirmed}
            <span> / {targetMemberCount}</span>
          </div>
          <p className="flow-muted">members have confirmed</p>
          <progress
            className="flow-progress"
            value={confirmed}
            max={targetMemberCount}
            aria-label="Confirmed participants"
          />
          <h3>
            {evaluation?.status === "PROPOSAL_READY"
              ? "Proposal saved"
              : confirmed === targetMemberCount
                ? "Ready for evaluation"
                : "Waiting for your group"}
          </h3>
          <p>
            {evaluation?.status === "PROPOSAL_READY"
              ? "View the recorded candidate comparison before reviewing spending terms."
              : confirmed === targetMemberCount
                ? "Everyone has confirmed. Open Results to evaluate your group."
                : `Results become available after all ${targetMemberCount} members confirm and an evaluation is recorded.`}
          </p>
          <Link className="text-button" href={`${root}/results`}>
            View results →
          </Link>
          {group.locked && (
            <p className="flow-note">
              <LockKeyhole size={16} />
              Preferences are locked for this proposal.
            </p>
          )}
        </aside>
      </div>
    );
  if (stage === "results")
    return (
      <>
        {!group.locked && (
          <section className="flow-panel">
            <div className="panel-heading">
              <div>
                <h2>Evaluate confirmed preferences</h2>
                <p className="flow-muted">
                  Uses every member's confirmed inputs and the synthetic
                  restaurant catalog. A matching proposal locks the inputs; a
                  no-match result leaves them editable.
                </p>
              </div>
              <button
                className="primary"
                disabled={
                  busy || confirmed !== targetMemberCount || !onEvaluate
                }
                onClick={onEvaluate}
              >
                {busy
                  ? "Evaluating…"
                  : evaluation
                    ? "Evaluate again"
                    : "Evaluate group"}
              </button>
            </div>
            {confirmed !== targetMemberCount && (
              <p>
                {confirmed} of {targetMemberCount} confirmations received.
              </p>
            )}
            {evaluation?.status === "NO_MATCH" && (
              <Link
                className="secondary flow-link"
                href={`${root}/preferences`}
              >
                Revise my preferences
              </Link>
            )}
          </section>
        )}
        {!evaluation ? (
          <EmptyPanel
            title={
              confirmed === targetMemberCount
                ? "Waiting for an evaluation"
                : "Your group is still deciding"
            }
            description={
              confirmed === targetMemberCount
                ? "All preferences are confirmed. Evaluate the sample catalog to compare candidates. A matching result locks these confirmed preferences."
                : `${confirmed} of ${targetMemberCount} members have confirmed. No candidate has been selected yet.`
            }
            href={`${root}/preferences`}
            label="Review my preferences"
          />
        ) : (
          <>
            <section className="flow-panel winner-panel">
              <span className="eyebrow">
                {selected ? "RECOMMENDED FOR YOUR GROUP" : "EVALUATION RESULT"}
              </span>
              <h2>{selected?.name ?? "No matching candidate"}</h2>
              <p>
                {selected
                  ? "Meets the confirmed group requirements and ranks highest among eligible candidates."
                  : "No candidate satisfies the confirmed requirements."}
              </p>
              <div className="flow-actions">
                {selected && (
                  <>
                    <span className="pill positive">
                      ${(selected.mealPricePerPersonCents / 100).toFixed(2)} /
                      person
                    </span>
                    <span className="pill">
                      {money(selected.depositBaseUnits)} deposit
                    </span>
                    <Link
                      className="primary flow-link"
                      href={`${root}/approve`}
                    >
                      Review spending terms <ArrowRight size={16} />
                    </Link>
                  </>
                )}
              </div>
            </section>
            <section className="flow-panel">
              <h2>Candidate comparison</h2>
              <p className="flow-muted">
                Scores reflect group preferences. Private rejection details are
                not shared.
              </p>
              {evaluation.syntheticCatalog && (
                <p className="flow-note">
                  Sample restaurant catalog · availability is synthetic.
                </p>
              )}
              <div
                className="review-table-scroll"
                tabIndex={0}
                aria-label="Candidate comparison"
              >
                <table className="review-table">
                  <caption>Saved evaluation</caption>
                  <thead>
                    <tr>
                      <th scope="col">Candidate</th>
                      <th scope="col">Meal / person</th>
                      <th scope="col">Deposit</th>
                      <th scope="col">Score / 100</th>
                      <th scope="col">Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...evaluation.candidates]
                      .sort(
                        (a, b) =>
                          Number(b.eligible) - Number(a.eligible) ||
                          evaluation.ranking.indexOf(a.id) -
                            evaluation.ranking.indexOf(b.id),
                      )
                      .map((candidate) => {
                        const item = evaluation.catalog.find(
                          (entry) => entry.id === candidate.id,
                        );
                        return (
                          <tr key={candidate.id}>
                            <th scope="row">{item?.name ?? candidate.id}</th>
                            <td>
                              {item
                                ? `$${(item.mealPricePerPersonCents / 100).toFixed(2)}`
                                : "—"}
                            </td>
                            <td>{item ? money(item.depositBaseUnits) : "—"}</td>
                            <td>{scorePercent(candidate.scoreMicros)}</td>
                            <td>
                              <span
                                className={`pill ${candidate.id === evaluation.winnerId ? "positive" : ""}`}
                              >
                                {candidate.id === evaluation.winnerId
                                  ? "Recommended"
                                  : candidate.eligible
                                    ? "Eligible"
                                    : "Not eligible"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <p className="flow-muted">
                Recorded {new Date(evaluation.createdAt).toLocaleString()} ·{" "}
                {evaluation.engineVersion}
              </p>
            </section>
            <GroupInsightsPanel groupId={group.id} evaluation={evaluation} />
          </>
        )}
      </>
    );
  if (stage === "approve")
    return (
      <GroupPolicyPanel
        overview={overview}
        busy={busy}
        onPrepare={onPreparePolicy}
      />
    );
  if (overview.signingPolicy)
    return (
      <GroupExecutionPanel
        key={overview.signingPolicy.policyHash}
        groupId={group.id}
        saved={overview.signingPolicy}
      />
    );
  return (
    <>
      <div className="metric-grid">
        {["Contributed", "Spent", "Your refund"].map((label) => (
          <div className="flow-panel" key={label}>
            <span className="eyebrow">{label}</span>
            <div className="big-number">—</div>
            <small>No reconciled record</small>
          </div>
        ))}
      </div>
      <EmptyPanel
        title="No execution record is connected"
        description="Group settlement is not connected yet. Balances, payment attempts and refund eligibility will appear only after this group's chain records can be verified."
        href={`${root}/approve`}
        label="Review policy status"
      />
      <section className="flow-panel">
        <h2>Transaction history</h2>
        <p className="flow-muted">
          No transactions available for this group. A missing record does not
          prove that no transaction occurred.
        </p>
        <div className="flow-note">
          Pending, confirmed and reverted transactions will be shown separately.
          Read-only rejection checks are not transactions.
        </div>
      </section>
    </>
  );
}

function EmptyPanel({
  title,
  description,
  href,
  label,
}: {
  title: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <section className="flow-panel flow-empty">
      <Users size={28} />
      <h2>{title}</h2>
      <p>{description}</p>
      <Link className="secondary flow-link" href={href}>
        {label} <ArrowRight size={16} />
      </Link>
    </section>
  );
}

export function GroupScreen({ id, stage }: { id: string; stage: GroupStage }) {
  const [overview, setOverview] = useState<GroupOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  async function act(action: "evaluate" | "decisions") {
    setBusy(true);
    setActionNotice("");
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "REQUEST_FAILED");
      setOverview(data as GroupOverview);
      setActionNotice(
        action === "decisions"
          ? "Signing policy saved. No transaction was sent."
          : data.evaluation?.status === "NO_MATCH"
            ? "No candidate matches. Revise your preferences and confirm again."
            : "Evaluation saved. Your group's confirmed preferences are now locked.",
      );
    } catch (failure) {
      const code =
        failure instanceof Error ? failure.message : "REQUEST_FAILED";
      const messages: Record<string, string> = {
        INCOMPLETE_GROUP:
          "Every member must join and confirm before evaluation. Refresh the group to see the latest progress.",
        UNSUPPORTED_PAYMENT_GROUP_SIZE:
          "This legacy payment policy requires six members. Create a new group to use flexible-size payments. Your group's preferences and recommendation are saved.",
        PAYMENT_NOT_CONFIGURED:
          "The payment service is not configured yet. Your group's recommendation is saved.",
        AUTH_REQUIRED:
          "Your session expired. Reconnect your wallet to continue.",
        NOT_MEMBER: "Only group members can perform this action.",
        NO_PROPOSAL: "A matching, saved evaluation is required first.",
        STALE_EVALUATION:
          "The saved evaluation could not be verified. No policy was created.",
        RESERVATION_PASSED:
          "The reservation is too close or has passed. Create a new group with a future reservation.",
      };
      setActionNotice(
        diagnosticMessage(code) ??
          messages[code] ??
          "The request could not be completed. Refresh to check its saved status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setOverview(null);
    void fetch(`/api/groups/${encodeURIComponent(id)}/overview`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "REQUEST_FAILED");
        return data as GroupOverview;
      })
      .then(setOverview)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "REQUEST_FAILED",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, revision]);
  return (
    <WorkspaceFrame>
      <div className="heading">
        <div>
          <div className="eyebrow">GROUP WORKSPACE</div>
          <h1>{titles[stage]}</h1>
          <p className="flow-muted">
            {overview
              ? `${overview.group.name} · ${new Date(overview.group.startsAt).toLocaleString("en-US", { timeZone: overview.group.timeZone })} · ${overview.group.timeZone}`
              : "A shared decision with independently controlled wallets."}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh group"
          disabled={loading || busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <GroupNavigation id={id} active={stage} />
      {overview && !loading && !error && (
        <DiagnosticsList diagnostics={groupDiagnostics(overview).diagnostics} />
      )}
      {actionNotice && (
        <p className="flow-note" role="status">
          {actionNotice}
        </p>
      )}
      {loading ? (
        <section className="flow-panel" role="status">
          Loading your group…
        </section>
      ) : error ? (
        <section className="flow-panel flow-empty" role="alert">
          <LockKeyhole size={28} />
          <h2>
            {error === "AUTH_REQUIRED"
              ? "Connect to your group"
              : error === "NOT_MEMBER"
                ? "This group is private"
                : "We couldn't load this group"}
          </h2>
          <p>
            {error === "AUTH_REQUIRED"
              ? "Connect the wallet you used to join. Your group data stays private."
              : error === "NOT_MEMBER"
                ? "Use a member wallet or ask the organizer for an invitation."
                : "Your saved data has not changed. Retry in a moment."}
          </p>
          <Link
            className="primary flow-link"
            href={`/?group=${encodeURIComponent(id)}`}
          >
            Open wallet workspace
          </Link>
        </section>
      ) : (
        overview && (
          <>
            <GroupStageContent
              overview={overview}
              stage={stage}
              busy={busy}
              onEvaluate={() => void act("evaluate")}
              onPreparePolicy={() => void act("decisions")}
            />
            <section className="flow-panel">
              <h2>Membership</h2>
              <LeaveGroupButton groupId={id} locked={overview.group.locked} />
            </section>
          </>
        )
      )}
    </WorkspaceFrame>
  );
}
