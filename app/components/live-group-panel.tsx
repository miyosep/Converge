"use client";
import { useEffect, useRef, useState } from "react";
import type { LivePreference } from "../../src/lib/discovery/group-preferences";
import type { GroupOverview } from "../../src/lib/group-view";
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
    setChoice("");
    setAccepted(false);
  }, [
    overview.livePlan?.recommendationRevision,
    overview.livePlan?.recommendationReady,
  ]);
  const [choice, setChoice] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState("");
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
      | "decisions"
      | "invite"
      | "live-preferences"
      | "live-confirm"
      | "recommend",
    body: unknown = {},
  ) {
    setBusy(true);
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
          NOT_CREATOR: "Only the group organizer can create an invitation.",
          GROUP_FULL: "Everyone has joined. You can now agree on a place.",
          GROUP_LOCKED: "The policy is already fixed. Refresh to review it.",
          UNANIMOUS_CHOICE_REQUIRED:
            "Every invited member must join and choose the same place first.",
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
              ? "Candidates found using every member’s confirmed requirements. Review before agreeing."
              : "No candidates are ready. Review the group search result below."
            : name === "vote"
              ? "Your choice is saved. No payment has been approved."
              : "The policy is fixed. Each person must still approve and contribute from their wallet.",
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed.");
    } finally {
      if (name === "live-preferences" || name === "live-confirm")
        await loadOwn().catch(() => {});
      setBusy(false);
    }
  }
  const plan = overview.livePlan!;
  const agreed = unanimousPlace(
    plan,
    overview.participants.map((member) => member.walletAddress),
    overview.group.targetMemberCount,
  );
  return (
    <>
      <section className="flow-panel">
        <h2>Choose together, then approve separately</h2>
        <p>
          {overview.participants.length} of {overview.group.targetMemberCount}{" "}
          members joined. Each person contributes 10 MockUSDC; the exact group
          deposit is {plan.depositUsdc} MockUSDC.
        </p>
        <p>
          This is a test booking. Availability and USDC acceptance are demo
          assumptions. The recipient is a demo booking wallet:{" "}
          <span className="address-value">{plan.merchant}</span>.
        </p>
        <p>
          Everyone submits their own preferences privately. After every member
          confirms their interpretation, we search for places using the whole
          group's requirements. Search listings may still leave conditions
          unverified.
        </p>
        {!overview.group.locked && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void action("invite")}
          >
            Create invitation link
          </button>
        )}
        {invite && (
          <label>
            Share this private invitation
            <input
              readOnly
              value={invite}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        )}
        <ul>
          {overview.participants.map((member) => (
            <li key={member.walletAddress}>
              {member.displayName} —{" "}
              {member.confirmed
                ? "Preferences confirmed"
                : member.submitted
                  ? "Reviewing preferences"
                  : "Waiting for preferences"}{" "}
              ·{" "}
              {plan.places.find(
                (place) =>
                  place.id === plan.votes[member.walletAddress.toLowerCase()],
              )?.name ?? "Has not chosen yet"}
            </li>
          ))}
        </ul>
        {notice && <p role="status">{notice}</p>}
      </section>
      {!overview.signingPolicy && (
        <section className="flow-panel">
          <h2>Your private preferences</h2>
          <p>
            Tell us what you need and what you would enjoy. Your text and
            interpretation are visible only to you; the group sees your
            confirmation status.
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
              What matters to you?
              <textarea
                required
                maxLength={2000}
                rows={4}
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
              Interpret my preferences
            </button>
          </form>
          {preference?.status === "failed" && (
            <p role="status">
              Interpretation failed. Your text is saved; submit again to retry.
            </p>
          )}
          {preference?.status === "extracting" && (
            <p role="status">
              Interpretation is pending. If it was interrupted, submit your text
              again.
            </p>
          )}
          {preference?.extraction && (
            <>
              <h3>Review your interpretation</h3>
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
                To correct an interpretation, edit your text and submit again.
                Changes require a new group search and fresh place agreements.
              </p>
            </>
          )}
          <h3>Find a place for everyone</h3>
          <p>
            {overview.participants.filter((member) => member.confirmed).length}{" "}
            of {overview.group.targetMemberCount} members confirmed.
          </p>
          <button
            className="primary"
            disabled={
              busy ||
              overview.participants.length !==
                overview.group.targetMemberCount ||
              overview.participants.some((member) => !member.confirmed)
            }
            onClick={() => void action("recommend")}
          >
            {busy
              ? "Working…"
              : plan.recommendationReady
                ? "Search again for the group"
                : "Find places for our group"}
          </button>
          {plan.conflicts?.map((message) => (
            <p key={message} role="status">
              {message}
            </p>
          ))}
          {!plan.recommendationReady &&
            plan.recommendationRevision &&
            !plan.conflicts?.length && (
              <p>
                No candidates are ready. Review your requirements and search
                again.
              </p>
            )}
        </section>
      )}
      {!overview.signingPolicy && plan.recommendationReady && (
        <form
          className="flow-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void action("vote", {
              placeId: choice,
              recommendationRevision: plan.recommendationRevision,
              acknowledgeDemo: accepted,
            });
          }}
        >
          <fieldset disabled={busy || overview.group.locked}>
            <legend>Your preferred place</legend>
            {plan.places.map((place) => (
              <article className="discovery-card" key={place.id}>
                <label>
                  <input
                    type="radio"
                    name="live-place"
                    value={place.id}
                    checked={choice === place.id}
                    onChange={() => {
                      setChoice(place.id);
                      setAccepted(false);
                    }}
                    required
                  />
                  {place.name}
                </label>
                <p>{place.address}</p>
                <p>{place.price ?? "Price not provided"}</p>
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
                <a
                  href={place.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View source and location
                </a>
              </article>
            ))}
            <label>
              <input
                type="checkbox"
                required
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />{" "}
              I agree to this candidate, the {plan.depositUsdc} MockUSDC group
              deposit and my 10 MockUSDC contribution under the demo assumptions
              above. My wallet approval happens separately.
            </label>
            <button className="primary" disabled={busy || !choice || !accepted}>
              Save my choice
            </button>
          </fieldset>
          <p>
            {agreed
              ? `Everyone chose ${agreed.name}. You can now prepare the shared payment policy.`
              : "Everyone must choose the same place. Members can change their choice until the policy is prepared."}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy || !agreed}
            onClick={() => void action("decisions")}
          >
            Prepare agreed payment policy
          </button>
        </form>
      )}
      <section className="flow-panel">
        <h2>Membership</h2>
        <LeaveGroupButton
          groupId={overview.group.id}
          locked={overview.group.locked}
        />
      </section>
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
    </>
  );
}
