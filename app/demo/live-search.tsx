"use client";

import { useEffect, useRef, useState } from "react";
import type { ExploreRun, ExploreCommand } from "../../src/lib/explore/types";
import { demoMembers } from "../../src/lib/explore/demo-members";
import type { DemoReview } from "../../src/lib/explore/preference-review";

function DemoBookingTerms({
  run,
  disabled,
  onCommand,
}: {
  run: ExploreRun;
  disabled: boolean;
  onCommand: (command: ExploreCommand) => void;
}) {
  const [deposit, setDeposit] = useState("45");
  const [accepted, setAccepted] = useState(false);
  const amount = Number(deposit);
  const validAmount = Number.isInteger(amount) && amount >= 1 && amount <= 60;
  const place = run.selectedPlace!;
  return (
    <section className="explore-section demo-booking-terms">
      <h2>{place.name}</h2>
      <p>{run.groupDecision?.rationale}</p>
      <div className="demo-chosen-venue">
        <p>{place.address}</p>
        <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer">
          View selected venue ↗
        </a>
      </div>
      {!!run.groupDecision?.uncertainties?.length && (
        <details className="demo-chosen-reason">
          <summary>What remains unverified</summary>
          <ul>
            {run.groupDecision.uncertainties.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </details>
      )}
      <form
        className="demo-request-review"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || !validAmount || !accepted) return;
          onCommand({
            action: "select_place",
            revision: run.revision,
            placeId: place.id,
            depositUsdc: amount,
            acknowledgeDemo: true,
          });
        }}
      >
        <h3>
          Before you <em>approve together</em>
        </h3>
        <p>
          Set the test deposit for this plan. This is not a restaurant quote.
        </p>
        <label htmlFor="demo-deposit">Group test deposit (MockUSDC)</label>
        <input
          id="demo-deposit"
          type="number"
          min={1}
          max={60}
          step={1}
          required
          value={deposit}
          disabled={disabled}
          aria-describedby="demo-payment-summary"
          onChange={(event) => {
            setDeposit(event.target.value);
            setAccepted(false);
          }}
        />
        <p id="demo-payment-summary">
          Each person contributes 10 MockUSDC, for a total of 60.
          {validAmount &&
            ` The group can claim back the remaining ${60 - amount} after payment.`}
        </p>
        <label className="demo-consent">
          <input
            type="checkbox"
            checked={accepted}
            disabled={disabled}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          I understand this is a simulated booking on Sepolia. The test deposit
          goes to a demo recipient, not the restaurant.
        </label>
        <button
          className="primary"
          disabled={disabled || !validAmount || !accepted}
        >
          {run.command?.action === "select_place"
            ? "Saving booking terms…"
            : "Confirm booking terms"}
        </button>
        <p>No payment now. You’ll approve in your wallet next.</p>
      </form>
    </section>
  );
}

export function LiveDemoSearch({
  run,
  disabled,
  configured,
  onCommand,
}: {
  run: ExploreRun;
  disabled: boolean;
  configured: boolean;
  onCommand: (command: ExploreCommand) => void;
}) {
  const [text, setText] = useState(run.text ?? "");
  const [reviewedText, setReviewedText] = useState<string | null>(null);
  const [summary, setSummary] = useState<DemoReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const reviewSequence = useRef(0);
  useEffect(
    () => () => {
      reviewSequence.current++;
    },
    [],
  );
  function clearReview() {
    reviewSequence.current++;
    setReviewedText(null);
    setSummary(null);
    setReviewError("");
    setReviewing(false);
  }
  async function review() {
    const sequence = ++reviewSequence.current;
    const requestText = text.trim();
    setReviewing(true);
    setSummary(null);
    setReviewedText(null);
    setReviewError("");
    try {
      const response = await fetch("/api/demo/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id, text: requestText }),
      });
      if (!response.ok) throw new Error("REVIEW_FAILED");
      const data = (await response.json()) as {
        text: string;
        summary: DemoReview;
      };
      if (sequence !== reviewSequence.current) return;
      setSummary(data.summary);
      setReviewedText(data.text);
    } catch {
      if (sequence === reviewSequence.current)
        setReviewError(
          "We couldn’t review your preferences. Please try again.",
        );
    } finally {
      if (sequence === reviewSequence.current) setReviewing(false);
    }
  }
  const searching =
    run.command?.action === "group_search" ||
    run.command?.action === "search" ||
    run.searchInFlight;
  useEffect(() => {
    setReviewedText(null);
    setSummary(null);
    reviewSequence.current++;
    setReviewing(false);
  }, [run.revision]);
  if (searching)
    return (
      <section
        className="explore-section demo-group-progress"
        aria-live="polite"
      >
        <h2>
          Six perspectives.
          <br />
          <em>One shared plan.</em>
        </h2>
        <p>We’re finding one restaurant for everyone.</p>
        <ol>
          {[
            ["aggregating", "Qwen brings all six opinions together"],
            ["searching", "xAPI finds real restaurant candidates"],
            ["choosing", "Qwen chooses one place for the group"],
          ].map(([stage, label], index) => (
            <li
              key={stage}
              className={run.groupDecision?.stage === stage ? "current" : ""}
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <p>Your wallet will ask for approval later. No payment is made now.</p>
      </section>
    );
  if (run.groupDecision?.stage === "ready" && run.selectedPlace && !run.policy)
    return (
      <DemoBookingTerms run={run} disabled={disabled} onCommand={onCommand} />
    );
  return (
    <section className="explore-section demo-live-search">
      <h2>
        What sounds <em>good to you?</em>
      </h2>
      <p>
        Tell us the cuisine, budget and atmosphere you have in mind. Write in
        English.
      </p>
      <details className="demo-scope">
        <summary>Search area &amp; demo reservation</summary>
        <p>
          The search area is fixed; walking distance is not guaranteed.
          Simulated reservation: January 5, 2030, 7:00 PM (Asia/Seoul).
        </p>
      </details>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void review();
        }}
      >
        <label htmlFor="demo-live-request">
          What would you like for dinner?
        </label>
        <textarea
          id="demo-live-request"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            clearReview();
          }}
          required
          minLength={3}
          maxLength={2000}
          rows={3}
          placeholder="A quiet Japanese restaurant for six, under KRW 30,000 per person."
        />
        <div className="discovery-links">
          {[
            "Japanese food for six people.",
            "A quiet Italian restaurant under KRW 30,000 per person.",
            "Korean barbecue with parking.",
          ].map((example) => (
            <button
              type="button"
              className="secondary"
              key={example}
              disabled={disabled}
              onClick={() => {
                setText(example);
                clearReview();
              }}
            >
              {example}
            </button>
          ))}
        </div>
        {!configured && (
          <p role="status">
            Restaurant search is temporarily unavailable. Please try again
            later.
          </p>
        )}
        <button
          className="primary"
          disabled={
            disabled ||
            reviewing ||
            !configured ||
            (run.searchCalls ?? 0) >= 3 ||
            text.trim().length < 3
          }
        >
          {reviewing
            ? "Understanding your preferences…"
            : searching
              ? "Searching Gangnam Station…"
              : "Review preferences"}
        </button>
        <p>{run.searchCalls ?? 0} of 3 group searches used.</p>
      </form>
      {reviewing && (
        <p role="status">
          Organizing your cuisine, budget and other preferences…
        </p>
      )}
      {reviewError && <p role="alert">{reviewError}</p>}
      {reviewedText !== null && summary && !searching && (
        <section
          className="demo-request-review"
          aria-label="Review your request"
        >
          <h3>
            Sound like <em>your kind of evening?</em>
          </h3>
          <ul className="demo-interpreted-preferences">
            {summary.requirements.map((requirement, index) => (
              <li key={index}>
                <span>{requirement.text}</span>
                <small>
                  {requirement.importance === "required"
                    ? "Must have"
                    : "Preferred"}
                </small>
              </li>
            ))}
          </ul>
          {!summary.requirements.length && <p>No specific requirements.</p>}
          {summary.notes.map((note, index) => (
            <p className="demo-review-note" key={index}>
              {note}
            </p>
          ))}
          {!!summary.clarifications.length && (
            <div className="demo-clarifications" role="status">
              <h4>A little more detail</h4>
              <ul>
                {summary.clarifications.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
              <p>Update your request above, then review again.</p>
            </div>
          )}
          <details className="demo-group-opinions">
            <summary>Five more perspectives join yours</summary>
            {demoMembers.map((member) => (
              <div key={member.address}>
                <strong>{member.name}</strong>
                <span>{member.preference.requirements[0]!.text}</span>
                <small>{member.address}</small>
              </div>
            ))}
          </details>
          <p>
            Qwen will combine all six opinions, search real places with xAPI,
            and choose one restaurant.
          </p>
          <button
            type="button"
            className="primary"
            disabled={
              disabled ||
              summary.clarifications.length > 0 ||
              !configured ||
              (run.searchCalls ?? 0) >= 3 ||
              reviewedText !== text.trim()
            }
            onClick={() => {
              onCommand({
                action: "group_search",
                text: reviewedText,
                preference: summary,
              });
            }}
          >
            Find our shared plan
          </button>
        </section>
      )}
      {searching && (
        <p className="demo-search-progress" role="status">
          Finding real places for your group… This can take a moment.
        </p>
      )}
      {run.error?.includes("SEARCH") && !searching && (
        <p role="alert">
          The search could not finish. Your request is saved; you can retry
          while searches remain.
        </p>
      )}
      {run.groupDecision?.stage === "blocked" && (
        <p role="status">{run.groupDecision.rationale}</p>
      )}
      {run.groupDecision?.stage === "failed" && (
        <p role="alert">
          We couldn’t finish the group decision. Review your preferences and try
          again.
        </p>
      )}
    </section>
  );
}
