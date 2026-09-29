"use client";

import { useEffect, useRef, useState } from "react";
import type { ExploreRun, ExploreCommand } from "../../src/lib/explore/types";
import type { DemoReview } from "../../src/lib/explore/preference-review";

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
  const [placeId, setPlaceId] = useState("");
  const [deposit, setDeposit] = useState("45");
  const [accepted, setAccepted] = useState(false);
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
  const searching = run.command?.action === "search" || run.searchInFlight;
  useEffect(() => {
    setPlaceId("");
    setAccepted(false);
    setReviewedText(null);
    setSummary(null);
    reviewSequence.current++;
    setReviewing(false);
  }, [run.revision]);
  const result = run.discovery;
  const amount = Number(deposit);
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
        <p>
          {run.searchCalls ?? 0} of 3 searches used. Results stay fixed until
          you search again.
        </p>
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
          <p>For six people near Gangnam Station. No payment at this step.</p>
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
              setPlaceId("");
              setAccepted(false);
              onCommand({ action: "search", text: reviewedText });
            }}
          >
            Confirm &amp; find places
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
      {!!run.searchUsage?.length && (
        <details>
          <summary>Search activity</summary>
          <ul>
            {run.searchUsage.map((usage, index) => (
              <li key={index}>
                {usage.flow === "search_tool_selection"
                  ? "Qwen tool selection"
                  : "xAPI place search"}
                : {usage.status ?? "no response"} · {usage.durationMs} ms
                {usage.totalTokens !== null
                  ? ` · ${usage.totalTokens} tokens`
                  : ""}
                {usage.validationError ? " · request failed validation" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {result && (
        <>
          <h3>Review the search</h3>
          <p>{result.query || result.intent.area}</p>
          <p>Request used: {run.text}</p>
          {text !== (run.text ?? "") && (
            <p role="status">
              Your draft has changed. Search again to use the new conditions.
            </p>
          )}
          {result.intent.clarifications.map((question) => (
            <p role="status" key={question}>
              {question}
            </p>
          ))}
          {!result.intent.clarifications.length && !result.places.length && (
            <p>
              No candidates found. Change your requirements and search again.
            </p>
          )}
          <div className="discovery-grid">
            {result.places.map((place) => (
              <article className="discovery-card" key={place.id}>
                <label>
                  <input
                    type="radio"
                    name="demo-place"
                    checked={placeId === place.id}
                    disabled={disabled}
                    onChange={() => {
                      setPlaceId(place.id);
                      setAccepted(false);
                    }}
                  />{" "}
                  {place.name}
                </label>
                <p>{place.address}</p>
                <p>{place.price ?? "Venue price not provided"}</p>
                <a
                  href={place.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View source & location ↗
                </a>
                <details className="demo-place-evidence">
                  <summary>How it fits</summary>
                  <ul>
                    {place.evidence.map((entry, index) => (
                      <li key={index}>
                        {entry.condition}:{" "}
                        {entry.status === "unknown"
                          ? "Not verified"
                          : entry.status}
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            ))}
          </div>
          {!!result.places.length && !result.intent.clarifications.length && (
            <>
              <p>
                Source: {result.source}. Search candidates are not verified
                matches. The five automated participants follow the demo terms;
                their participation is not independent human approval.
              </p>
              <label htmlFor="demo-deposit">
                Demo reservation deposit (whole MockUSDC, 1–60)
              </label>
              <input
                id="demo-deposit"
                type="number"
                min={1}
                max={60}
                step={1}
                value={deposit}
                disabled={disabled}
                onChange={(event) => {
                  setDeposit(event.target.value);
                  setAccepted(false);
                }}
              />
              <p>
                Each of six participants contributes 10 MockUSDC. The deposit is
                a demo amount, not the restaurant's quote. Payment goes to the
                configured demo booking recipient, not the real venue. Unused
                funds are refundable.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={disabled}
                  onChange={(event) => setAccepted(event.target.checked)}
                />{" "}
                I understand that venue conditions are unverified and USDC
                booking availability is assumed for this demo. This does not
                confirm a real reservation.
              </label>
              <button
                type="button"
                className="primary"
                disabled={
                  disabled ||
                  !placeId ||
                  !accepted ||
                  text !== (run.text ?? "") ||
                  !Number.isInteger(amount) ||
                  amount < 1 ||
                  amount > 60
                }
                onClick={() =>
                  onCommand({
                    action: "select_place",
                    revision: run.revision,
                    placeId,
                    depositUsdc: amount,
                    acknowledgeDemo: true,
                  })
                }
              >
                Review this booking policy
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
