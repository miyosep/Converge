"use client";

import { useEffect, useState } from "react";
import type { ExploreRun, ExploreCommand } from "../../src/lib/explore/types";

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
  useEffect(() => {
    setPlaceId("");
    setAccepted(false);
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
          setPlaceId("");
          setAccepted(false);
          onCommand({ action: "search", text });
        }}
      >
        <label htmlFor="demo-live-request">
          What would you like for dinner?
        </label>
        <textarea
          id="demo-live-request"
          value={text}
          onChange={(event) => setText(event.target.value)}
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
              onClick={() => setText(example)}
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
            !configured ||
            (run.searchCalls ?? 0) >= 3 ||
            text.trim().length < 3
          }
        >
          {run.command?.action === "search"
            ? "Searching Gangnam Station…"
            : "Search restaurants"}
        </button>
        <p>
          {run.searchCalls ?? 0} of 3 searches used. Results stay fixed until
          you search again.
        </p>
      </form>
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
