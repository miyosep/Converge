"use client";
import {
  ArrowRight,
  Check,
  Copy,
  Link2,
  LockKeyhole,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LivePreference } from "../../src/lib/discovery/group-preferences";
import type { GroupOverview } from "../../src/lib/group-view";
import { LivePaymentSetup } from "./live-payment-setup";
import { unanimousPlace } from "../../src/lib/discovery/live-plan";
import { LeaveGroupButton } from "./leave-group-button";
import { GroupPolicyPanel } from "./group-policy-panel";
import { GroupExecutionPanel } from "./group-execution-panel";

export function LiveGroupPanel({ initial }: { initial: GroupOverview }) {
  const [overview, setOverview] = useState(initial);
  const [preference, setPreference] = useState<LivePreference | null>(null);
  const [text, setText] = useState("");
  const [ownLoaded, setOwnLoaded] = useState(false);
  async function loadOwn(initialLoad = false) {
    const response = await fetch(`${base}/live-preferences`, {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "Could not load your private preferences. Refresh and sign in again if needed.",
      );
    const data = await response.json();
    setPreference(data.preference);
    if (initialLoad) setText(data.preference?.rawText ?? "");
    setOwnLoaded(true);
  }
  useEffect(() => {
    void loadOwn(true).catch((error) => setNotice(error.message));
  }, []);
  useEffect(() => {
    setChoice(
      overview.livePlan?.places.length === 1
        ? overview.livePlan.places[0]!.id
        : "",
    );
    setAccepted(false);
  }, [
    overview.livePlan?.recommendationRevision,
    overview.livePlan?.recommendationReady,
  ]);
  const [choice, setChoice] = useState(
    initial.livePlan?.places.length === 1 ? initial.livePlan.places[0]!.id : "",
  );
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState("");
  const [copied, setCopied] = useState(false);
  const refreshing = useRef(false);
  const refreshVersion = useRef(0);
  const base = `/api/groups/${encodeURIComponent(initial.group.id)}`;
  async function refresh() {
    if (refreshing.current) return;
    refreshing.current = true;
    const version = ++refreshVersion.current;
    try {
      const response = await fetch(`${base}/overview`, { cache: "no-store" });
      if (!response.ok)
        throw new Error(
          "Could not refresh the group. Reconnect your wallet if your session expired.",
        );
      const data = await response.json();
      if (version === refreshVersion.current) setOverview(data);
    } finally {
      refreshing.current = false;
    }
  }
  useEffect(() => {
    const timer = setInterval(
      () => void refresh().catch((error) => setNotice(error.message)),
      5000,
    );
    return () => clearInterval(timer);
  }, [base]);
  async function action(
    name:
      | "vote"
      | "invite"
      | "live-preferences"
      | "live-confirm"
      | "recommend"
      | "decisions",
    body: unknown = {},
  ) {
    setBusy(true);
    setSearchPending(name === "recommend");
    refreshVersion.current++;
    setNotice("");
    try {
      const response = await fetch(`${base}/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      refreshVersion.current++;
      if (!response.ok) {
        const messages: Record<string, string> = {
          PREFERENCES_NOT_CONFIRMED:
            "Everyone must join and confirm their own interpreted requirements first.",
          PREFERENCES_NOT_READY:
            "Review the clarification questions and resubmit your requirements.",
          STALE_REVISION:
            "Your preferences changed in another tab. Review the saved version before submitting again.",
          STALE_RECOMMENDATION:
            "Someone changed their requirements or the group changed. Search again using everyone's latest confirmations.",
          SEARCH_IN_PROGRESS:
            "A group search is already running. Wait a moment and refresh.",
          GROUP_SEARCH_UNAVAILABLE:
            "The group search failed. Your confirmed requirements are saved; try again.",
          EXTRACTION_FAILED:
            "Your text was saved, but interpretation failed. Try submitting again.",
          BOOKING_QUOTE_UNAVAILABLE:
            "The venue’s booking amount has not been confirmed. Payment is unavailable.",
          NOT_CREATOR:
            "Only the organizer can set payment terms or create invitations.",
          GROUP_FULL: "Everyone has joined. You can now agree on a place.",
          GROUP_LOCKED: "The policy is already fixed. Refresh to review it.",
          UNANIMOUS_CHOICE_REQUIRED:
            "Every invited member must join and agree to the proposed place first.",
          RESERVATION_PASSED:
            "This plan is too close or has passed. Create a new plan with a future time.",
        };
        throw new Error(
          messages[data.error] ??
            "Could not complete the request. Refresh the group and retry.",
        );
      }
      if (name === "invite") {
        const url = new URL(window.location.origin);
        url.searchParams.set("group", overview.group.id);
        url.searchParams.set("invite", data.token);
        setInvite(url.toString());
        setCopied(false);
      } else if (name === "live-preferences" || name === "live-confirm") {
        setPreference(data.preference);
        setNotice(
          name === "live-confirm"
            ? "Your interpretation is confirmed. It will be included with every other member's preferences."
            : "Review your interpreted requirements before confirming.",
        );
        await refresh();
      } else {
        setOverview(data);
        setNotice(
          name === "recommend"
            ? data.livePlan?.recommendationReady
              ? "Your shared place is ready. Review the proposal before agreeing."
              : "The proposal is not ready. Check the search status below."
            : name === "decisions"
              ? "Payment terms saved. Each person approves separately in their wallet."
              : "Your choice is saved. No payment has been approved.",
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed.");
    } finally {
      if (name === "live-preferences" || name === "live-confirm")
        await loadOwn().catch(() => {});
      setBusy(false);
      setSearchPending(false);
    }
  }
  const plan = overview.livePlan!;
  const agreed = unanimousPlace(
    plan,
    overview.participants.map((member) => member.walletAddress),
    overview.group.targetMemberCount,
  );
  const confirmed = overview.participants.filter(
    (member) => member.confirmed,
  ).length;
  const target = overview.group.targetMemberCount;
  const ready = overview.participants.length === target && confirmed === target;
  const currentStep = agreed
    ? 3
    : plan.recommendationReady || ready
      ? 2
      : overview.participants.length === target
        ? 1
        : 0;
  return (
    <div className="gathering-workspace">
      <ol className="gathering-steps" aria-label="Plan progress">
        {[
          "Gather your people",
          "Share preferences",
          "Choose together",
          "Confirm details",
        ].map((label, index) => (
          <li
            key={label}
            className={
              index === currentStep
                ? "is-current"
                : index < currentStep
                  ? "is-done"
                  : ""
            }
            aria-current={index === currentStep ? "step" : undefined}
          >
            <span>
              {index < currentStep ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                `0${index + 1}`
              )}
            </span>
            {label}
          </li>
        ))}
      </ol>
      {notice && (
        <p className="gathering-notice" role="status">
          {notice}
        </p>
      )}
      <div className="gathering-layout">
        <div className="gathering-primary">
          {!overview.signingPolicy && (
            <section className="gathering-card gathering-preferences">
              <div className="gathering-card-heading">
                <span className="gathering-kicker">A PLAN THAT FITS YOU</span>
                <span className="gathering-private">
                  <LockKeyhole size={13} aria-hidden="true" /> Only you
                </span>
              </div>
              <h2>
                What would make it <em>your kind of place?</em>
              </h2>
              <p className="gathering-muted">
                The food, the budget, the atmosphere. Tell us what matters.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void action("live-preferences", {
                    text,
                    expectedRevisionId: preference?.revisionId ?? null,
                  });
                }}
              >
                <label>
                  Your preferences
                  <textarea
                    required
                    maxLength={2000}
                    rows={5}
                    disabled={busy}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="I need vegetarian options, under KRW 30,000 per person. I would prefer somewhere quiet."
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || !ownLoaded || !text.trim()}
                >
                  {busy
                    ? "Working…"
                    : preference?.extraction
                      ? "Update my preferences"
                      : "Review my preferences"}{" "}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </form>
              {preference?.status === "failed" && (
                <p role="status">
                  Interpretation failed. Your text is saved; submit again to
                  retry.
                </p>
              )}
              {preference?.status === "draft" && (
                <p role="status">
                  Your earlier note is saved here. Review it when you’re ready.
                </p>
              )}
              {preference?.status === "extracting" && (
                <p role="status">
                  Interpretation is pending. If it was interrupted, submit your
                  text again.
                </p>
              )}
              {preference?.extraction && (
                <div className="gathering-review">
                  <h3>Here’s what we understood</h3>
                  <ul>
                    {preference.extraction.requirements.map((item, index) => (
                      <li key={index}>
                        <strong>
                          {item.importance === "required"
                            ? "Required"
                            : "Preferred"}
                          :
                        </strong>{" "}
                        {item.text}
                      </li>
                    ))}
                  </ul>
                  {!preference.extraction.requirements.length && (
                    <p>
                      No specific requirements recorded. Confirm only if that is
                      correct.
                    </p>
                  )}
                  {preference.extraction.clarifications.map((question) => (
                    <p key={question} role="status">
                      {question}
                    </p>
                  ))}
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      preference.confirmed ||
                      !!preference.extraction.clarifications.length ||
                      text.trim() !== preference.rawText
                    }
                    onClick={() =>
                      void action("live-confirm", {
                        revisionId: preference.revisionId,
                      })
                    }
                  >
                    {preference.confirmed
                      ? "Preferences confirmed"
                      : "Confirm this interpretation"}
                  </button>
                  <p>
                    Something missing? Edit your note above and review it again.
                  </p>
                </div>
              )}
            </section>
          )}
          {!overview.signingPolicy &&
            plan.recommendationReady &&
            plan.places.length > 1 && (
              <section className="gathering-card" role="status">
                <h2>One place for everyone</h2>
                <p>
                  Search again to turn your saved options into one shared
                  recommendation.
                </p>
              </section>
            )}
          {!overview.signingPolicy &&
            plan.recommendationReady &&
            plan.places.length === 1 && (
              <form
                className="gathering-card gathering-candidates"
                onSubmit={(event) => {
                  event.preventDefault();
                  void action("vote", {
                    placeId: choice,
                    recommendationRevision: plan.recommendationRevision,
                    acknowledgeChoice: accepted,
                  });
                }}
              >
                <fieldset disabled={busy || overview.group.locked}>
                  <legend>Your shared place</legend>
                  <p className="gathering-muted">
                    One place, chosen around everyone’s preferences.
                  </p>
                  {plan.places.map((place) => (
                    <article className="discovery-card" key={place.id}>
                      <h3>{place.name}</h3>
                      <p>{place.address}</p>
                      <p>{place.price ?? "Price not provided"}</p>
                      <details className="gathering-evidence">
                        <summary>How it fits your group</summary>
                        <ul>
                          {place.evidence.map((fact, index) => (
                            <li key={index}>
                              {fact.condition}:{" "}
                              {fact.status === "reported"
                                ? "Provider reported"
                                : fact.status === "conflict"
                                  ? "Does not meet"
                                  : "Needs confirmation"}
                              . {fact.detail}
                            </li>
                          ))}
                        </ul>
                      </details>
                      <a
                        href={place.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View source and location
                      </a>
                    </article>
                  ))}
                  <label className="gathering-choice-consent">
                    <input
                      type="checkbox"
                      required
                      checked={accepted}
                      onChange={(event) => setAccepted(event.target.checked)}
                    />{" "}
                    I agree to this place. Any payment requires a confirmed
                    amount and my separate approval.
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !choice || !accepted}
                  >
                    Agree to this place
                  </button>
                </fieldset>
                <p>
                  {agreed
                    ? `Everyone chose ${agreed.name}. Review the shared payment terms next.`
                    : "Everyone reviews this proposal and agrees separately before payment."}
                </p>
                {agreed && !overview.signingPolicy && (
                  <LivePaymentSetup
                    overview={overview}
                    placeId={agreed.id}
                    busy={busy}
                    onSave={(terms) => void action("decisions", terms)}
                  />
                )}
              </form>
            )}
          {overview.signingPolicy && (
            <>
              <GroupPolicyPanel overview={overview} busy={busy} />
              <GroupExecutionPanel
                groupId={overview.group.id}
                saved={overview.signingPolicy}
                showChain={false}
              />
            </>
          )}
        </div>
        <aside className="gathering-people">
          <section className="gathering-card">
            <div className="gathering-card-heading">
              <h2>Your people</h2>
              <span className="gathering-count">
                <Users size={14} aria-hidden="true" />{" "}
                {overview.participants.length}/{target}
              </span>
            </div>
            <p className="gathering-muted">Good plans start with everyone.</p>
            <ul className="gathering-members">
              {overview.participants.map((member) => (
                <li key={member.walletAddress}>
                  <span className="gathering-avatar" aria-hidden="true">
                    {member.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{member.displayName}</strong>
                    <small>
                      {member.confirmed
                        ? "Preferences confirmed"
                        : member.submitted
                          ? "Reviewing preferences"
                          : "Yet to share preferences"}
                    </small>
                    {plan.recommendationReady &&
                      plan.votes[member.walletAddress.toLowerCase()] && (
                        <small className="gathering-vote">
                          Chose{" "}
                          {
                            plan.places.find(
                              (place) =>
                                place.id ===
                                plan.votes[member.walletAddress.toLowerCase()],
                            )?.name
                          }
                        </small>
                      )}
                  </div>
                  {member.confirmed && (
                    <Check size={16} aria-label="Confirmed" />
                  )}
                </li>
              ))}
            </ul>
            {overview.participants.length < target && (
              <p className="gathering-spots">
                {target - overview.participants.length} more{" "}
                {target - overview.participants.length === 1
                  ? "friend"
                  : "friends"}{" "}
                to join
              </p>
            )}
            {!overview.group.locked && (
              <button
                type="button"
                className="secondary gathering-invite"
                disabled={busy}
                onClick={() => void action("invite")}
              >
                <Link2 size={16} aria-hidden="true" />{" "}
                {invite ? "Refresh invitation" : "Invite friends"}
              </button>
            )}
            {invite && (
              <div className="gathering-invite-link">
                <label htmlFor="gathering-invitation">Invitation link</label>
                <div>
                  <input
                    id="gathering-invitation"
                    readOnly
                    value={invite}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={
                      copied ? "Invitation copied" : "Copy invitation link"
                    }
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(invite);
                        setCopied(true);
                      } catch {
                        setNotice(
                          "Select the invitation link and copy it to share.",
                        );
                      }
                    }}
                  >
                    {copied ? <Check size={17} /> : <Copy size={17} />}
                  </button>
                </div>
                <span role="status">
                  {copied ? "Copied — ready to share" : ""}
                </span>
              </div>
            )}
          </section>
          <section className="gathering-card gathering-progress-card">
            <span className="gathering-kicker">NEXT, TOGETHER</span>
            <h2>
              {agreed
                ? "You found your place"
                : ready
                  ? "Everyone’s in"
                  : "A little more to go"}
            </h2>
            <p>
              {confirmed} of {target} preferences confirmed
            </p>
            <progress
              value={confirmed}
              max={target}
              aria-label="Preferences confirmed"
            />
            <p className="gathering-muted">
              {agreed
                ? "Confirm the booking details with your venue."
                : ready
                  ? "You’re ready to find a place for everyone."
                  : "We’ll search once everyone has shared and confirmed."}
            </p>
            {!overview.signingPolicy && (
              <button
                type="button"
                className="primary"
                disabled={busy || plan.searching || !ready}
                onClick={() => void action("recommend")}
              >
                <Search size={16} aria-hidden="true" />{" "}
                {searchPending || plan.searching
                  ? "Finding your shared place…"
                  : plan.recommendationReady
                    ? "Search again"
                    : "Find our place"}
              </button>
            )}
            {!searchPending &&
              !plan.searching &&
              plan.conflicts?.map((message) => (
                <p key={message} role="status">
                  {message}
                </p>
              ))}
            {(searchPending || plan.searching) && (
              <p role="status">
                Finding one place for your group. Please wait.
              </p>
            )}
            {!searchPending &&
              !plan.searching &&
              !plan.recommendationReady &&
              plan.recommendationRevision &&
              !plan.conflicts?.length &&
              plan.recommendationStatus !== "idle" && (
                <p role="status">
                  {plan.recommendationStatus === "empty"
                    ? "The place search returned no results. Try another area or search again."
                    : "We couldn't finish the recommendation. Your preferences are saved. Please try again."}
                </p>
              )}
          </section>
          <div className="gathering-leave">
            <LeaveGroupButton
              groupId={overview.group.id}
              locked={overview.group.locked}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
