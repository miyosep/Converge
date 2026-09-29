"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getMetaMaskProvider } from "../../src/lib/browser-wallet";
import {
  connectWalletAccount,
  signWalletLogin,
  walletConnectionError,
} from "../../src/lib/wallet-connection";
import { SignInDialog } from "./sign-in-dialog";
import {
  discoveryCategories,
  EXPLORE_SEARCH_LOCATION,
  type DiscoveryCategory,
} from "../../src/lib/discovery/types";
import type {
  DiscoveredPlace,
  DiscoveryResult,
} from "../../src/lib/discovery/types";

export function DiscoveryCard({
  place,
  selected,
  disabled,
  onToggle,
}: {
  place: DiscoveredPlace;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="discovery-card">
      <div className="discovery-card-heading">
        <h3>{place.name}</h3>
        <label className="discovery-select">
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled && !selected}
            onChange={onToggle}
          />
          Compare<span className="sr-only"> {place.name}</span>
        </label>
      </div>
      <p>{place.address}</p>
      <p>
        <strong>{place.price ?? "Menu price not provided"}</strong>
      </p>
      <ul className="discovery-evidence">
        {place.evidence.map((entry, index) => (
          <li key={index}>
            <span className={`discovery-status ${entry.status}`}>
              {entry.status === "reported"
                ? "Provider reported"
                : entry.status === "conflict"
                  ? "Does not meet"
                  : "Needs confirmation"}
            </span>
            <strong>{entry.condition}</strong>
            <p>{entry.detail}</p>
          </li>
        ))}
      </ul>
      <div className="discovery-links">
        <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer">
          View source & location ↗
        </a>
        {place.websiteUrl && (
          <a href={place.websiteUrl} target="_blank" rel="noopener noreferrer">
            Venue website ↗
          </a>
        )}
      </div>
      {place.attributions.map((entry, index) => (
        <small key={index}>
          {entry.url ? (
            <a href={entry.url} target="_blank" rel="noopener noreferrer">
              {entry.name}
            </a>
          ) : (
            entry.name
          )}
        </small>
      ))}
    </article>
  );
}

export function RestaurantDiscovery({
  configured,
  source,
  explore = false,
  onSignedIn,
}: {
  configured: boolean;
  source: DiscoveryResult["source"];
  explore?: boolean;
  onSignedIn?: () => void;
}) {
  const [location, setLocation] = useState(
    explore ? EXPLORE_SEARCH_LOCATION : "Gangnam Station, Seoul",
  );
  const [category, setCategory] = useState<DiscoveryCategory>("restaurant");
  const [text, setText] = useState("");
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInNotice, setSignInNotice] = useState("");
  async function signIn() {
    setSigningIn(true);
    setSignInNotice("Open MetaMask to sign in.");
    try {
      const provider = await getMetaMaskProvider();
      if (!provider) throw new Error("Install or open MetaMask to sign in.");
      const address = await connectWalletAccount(provider);
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!challengeResponse.ok)
        throw new Error("Could not start sign-in. Please try again.");
      const challenge = await challengeResponse.json();
      const signature = await signWalletLogin(
        provider,
        challenge.message,
        address,
      );
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, signature }),
      });
      if (!response.ok)
        throw new Error("Could not verify sign-in. Please try again.");
      setSignInOpen(false);
      setNeedsLogin(false);
      setError("");
      onSignedIn?.();
    } catch (failure) {
      setSignInNotice(walletConnectionError(failure));
    } finally {
      setSigningIn(false);
    }
  }
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  function invalidate() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setResult(null);
    setSelected([]);
    setComparing(false);
    setError("");
    setNeedsLogin(false);
  }
  async function search() {
    invalidate();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: explore ? "explore" : "general",
          category,
          location,
          text,
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (pending.current !== controller) return;
      if (!response.ok) {
        setNeedsLogin(response.status === 401);
        throw new Error(
          response.status === 401
            ? "Sign in, then search again. Your request stays here."
            : data.error === "PLACES_NOT_CONFIGURED" ||
                data.error === "KILN_NOT_CONFIGURED"
              ? "Live search is not connected yet. The site owner needs to configure the search service."
              : data.error === "SEARCH_CREDIT_EXHAUSTED"
                ? "The search service has reached its spending limit. The site owner needs to check the search credits."
                : "The search service could not complete this request. Please try again.",
        );
      }
      setResult(data as DiscoveryResult);
    } catch (failure) {
      if (pending.current === controller && !controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Search failed. Please try again.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  const places =
    result?.places.filter(
      (place) => !comparing || selected.includes(place.id),
    ) ?? [];
  return (
    <section className="discovery">
      <div className="discovery-intro">
        <span className="eyebrow">REAL PLACES · AI SEARCH</span>
        {explore ? (
          <h2>Dinner around Gangnam Station</h2>
        ) : (
          <h1>A place that fits your people.</h1>
        )}
        <p>
          {explore
            ? "The area is set. Tell us what matters for dinner. Search real restaurants,"
            : "Tell us where you want to meet and what matters. Search real places,"}
          inspect the evidence and compare up to five candidates together.
        </p>
      </div>
      <form
        className="discovery-form"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        {!explore && (
          <>
            <label htmlFor="discovery-category">What are you planning?</label>
            <select
              id="discovery-category"
              value={category}
              onChange={(event) => {
                invalidate();
                setCategory(event.target.value as DiscoveryCategory);
                setText("");
              }}
            >
              {Object.entries(discoveryCategories).map(([value, item]) => (
                <option
                  key={value}
                  value={value}
                  disabled={
                    source !== "xAPI (Google Maps)" && value !== "restaurant"
                  }
                >
                  {item.label}
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor="discovery-location">
          City, neighborhood or landmark
        </label>
        <input
          id="discovery-location"
          value={location}
          readOnly={explore}
          required
          minLength={2}
          maxLength={160}
          onChange={(event) => {
            invalidate();
            setLocation(event.target.value);
          }}
        />
        {explore && (
          <p>
            The area is fixed for this demo. Describe cuisine, budget or
            atmosphere below. Check candidate addresses on the map; walking
            distance is not guaranteed.
          </p>
        )}
        <label htmlFor="discovery-request">What does your group need?</label>
        <textarea
          id="discovery-request"
          value={text}
          required
          minLength={3}
          maxLength={2000}
          rows={4}
          aria-describedby="discovery-help"
          placeholder={discoveryCategories[category].example}
          onChange={(event) => {
            invalidate();
            setText(event.target.value);
          }}
        />
        {explore && (
          <div className="discovery-links" aria-label="Example requests">
            {[
              "Japanese food for six people.",
              "A quiet Italian restaurant under KRW 30,000 per person.",
              "Korean barbecue with parking.",
            ].map((example) => (
              <button
                key={example}
                type="button"
                className="secondary"
                onClick={() => {
                  invalidate();
                  setText(example);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        )}
        <p id="discovery-help">
          Describe your needs in English. If you have a budget, state the
          currency and whether it is per person, per night, per hour or a total.
          Prices and facilities may need confirmation with the venue.
        </p>
        <p className="flow-note">
          Hackathon assumption: search results can be reserved with USDC.
          Booking availability is not checked.
        </p>
        {!configured && (
          <p className="notice" role="status">
            Live search is not connected yet. You can explore the planning demo
            while the search service is being configured.{" "}
            <Link href="/demo/catalog">Open planning demo</Link>
          </p>
        )}
        <button
          type="submit"
          className="primary"
          disabled={
            !configured ||
            busy ||
            location.trim().length < 2 ||
            text.trim().length < 3
          }
        >
          {busy
            ? "Interpreting and searching…"
            : `Find ${discoveryCategories[category].label.toLowerCase()}`}
        </button>
      </form>
      <div role="status" aria-live="polite" aria-busy={busy}>
        {busy && (
          <p>
            Reading your requirements, searching {source} and checking the
            available facts…
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}{" "}
          {needsLogin && (
            <button
              type="button"
              className="secondary"
              onClick={() => setSignInOpen(true)}
            >
              Sign in
            </button>
          )}
        </p>
      )}
      {result && (
        <>
          <section className="flow-note" aria-label="Search interpretation">
            <h2>What we searched</h2>
            <p>
              {result.intent.area}
              {result.intent.cuisine && ` · ${result.intent.cuisine}`}
            </p>
            <ul>
              {result.intent.budget && (
                <li>
                  Budget: {result.intent.budget.currency}{" "}
                  {result.intent.budget.amount} per person
                </li>
              )}
              {result.intent.people && <li>{result.intent.people} people</li>}
              {result.intent.facilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {result.intent.otherRequirements.map((item, index) => (
                <li key={index}>{item} — needs confirmation</li>
              ))}
            </ul>
            {!!result.intent.clarifications.length && (
              <>
                <h3>Please clarify your request</h3>
                <ul>
                  {result.intent.clarifications.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
                <p>
                  Edit the sentence above and search again. No places have been
                  searched yet.
                </p>
              </>
            )}
          </section>
          {!result.intent.clarifications.length && (
            <>
              <div className="discovery-toolbar">
                <div>
                  <h2>
                    {comparing
                      ? "Your comparison"
                      : `${result.places.length} candidates to consider`}
                  </h2>
                  <p>
                    {result.excludedCount > 0 &&
                      `${result.excludedCount} unavailable or conflicting candidates excluded. `}
                    Missing information is not a confirmed match.
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={!selected.length}
                  onClick={() => setComparing(!comparing)}
                >
                  {comparing
                    ? "Show all candidates"
                    : `Compare selected (${selected.length}/5)`}
                </button>
              </div>
              {!places.length && (
                <p className="notice">
                  No candidates found. Try a nearby neighborhood or a broader
                  type of place. Your requirements have not been silently
                  relaxed.
                </p>
              )}
              <div className="discovery-grid">
                {places.map((place) => (
                  <DiscoveryCard
                    key={place.id}
                    place={place}
                    selected={selected.includes(place.id)}
                    disabled={selected.length >= 5}
                    onToggle={() => {
                      setSelected((previous) =>
                        previous.includes(place.id)
                          ? previous.filter((id) => id !== place.id)
                          : previous.length < 5
                            ? [...previous, place.id]
                            : previous,
                      );
                      setComparing(false);
                    }}
                  />
                ))}
              </div>
              <p className="discovery-attribution">
                Place information: <strong>{result.source}</strong> · Retrieved{" "}
                {new Date(result.searchedAt).toLocaleString()}. Source
                information may change. Searching and comparing places does not
                send a payment.
              </p>
            </>
          )}
        </>
      )}
      <p className="discovery-attribution">
        Looking for the fictional examples?{" "}
        <Link href="/demo/catalog">Open archived planning demo</Link>.
      </p>
      <SignInDialog
        open={signInOpen}
        busy={signingIn}
        notice={signInNotice}
        onClose={() => setSignInOpen(false)}
        onConnect={() => void signIn()}
      />
    </section>
  );
}
