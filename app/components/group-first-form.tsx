"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BedDouble,
  Building2,
  Check,
  Copy,
  MapPin,
  Palette,
  Trophy,
  Users,
  Utensils,
} from "lucide-react";
import {
  discoveryCategories,
  type DiscoveryCategory,
} from "../../src/lib/discovery/types";

const icons = {
  restaurant: Utensils,
  stay: BedDouble,
  space: Building2,
  sport: Trophy,
  class: Palette,
};

export function GroupFirstForm({
  wallet,
  sessionLoading,
  onSignIn,
  onBusyChange,
}: {
  wallet: string | null;
  sessionLoading: boolean;
  onSignIn: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [category, setCategory] = useState<DiscoveryCategory>("restaurant");
  const [location, setLocation] = useState("Gangnam Station, Seoul");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [count, setCount] = useState(4);
  const [when, setWhen] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [groupId, setGroupId] = useState("");
  const [invite, setInvite] = useState("");
  const [copied, setCopied] = useState(false);
  const requestId = useRef("");
  const previousWallet = useRef(wallet);
  useEffect(() => {
    if (previousWallet.current && previousWallet.current !== wallet) {
      setGroupId("");
      setInvite("");
      setText("");
      setDisplayName("");
      setError("");
      setCopied(false);
      requestId.current = "";
    }
    previousWallet.current = wallet;
  }, [wallet]);

  async function createInvite(id: string) {
    const response = await fetch(
      `/api/groups/${encodeURIComponent(id)}/invite`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    if (!response.ok)
      throw new Error(
        "Your group is saved. Try creating the invite link again, or open your group.",
      );
    const data = await response.json();
    const url = new URL("/", window.location.origin);
    url.searchParams.set("group", id);
    url.searchParams.set("invite", data.token);
    setInvite(url.toString());
  }
  async function save() {
    if (busy) return;
    if (!wallet) {
      onSignIn();
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      let id = groupId;
      if (!id) {
        const response = await fetch("/api/groups/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: requestId.current,
            category,
            location,
            name:
              name.trim() ||
              `${discoveryCategories[category].label} with friends`,
            displayName,
            targetMemberCount: count,
            slot: {
              startsAt: new Date(when).toISOString().replace(/\.\d{3}Z$/, "Z"),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
            initialPreferences: text,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 401) {
            onSignIn();
            throw new Error(
              "Sign in, then save again. Your details are still here.",
            );
          }
          throw new Error(
            data.error === "RESERVATION_PASSED"
              ? "Choose a future date and time."
              : "Could not save your group. Check the details and try again.",
          );
        }
        id = data.groupId;
        setGroupId(id);
      }
      await createInvite(id);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save your group.",
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  if (groupId)
    return (
      <section
        className="discovery-form group-invite-ready"
        aria-labelledby="group-saved-title"
      >
        <div className="group-saved-icon">
          <Check size={26} aria-hidden="true" />
        </div>
        <h2 id="group-saved-title">Your people, next</h2>
        <p>
          Your group is saved. Invite your friends to share their preferences
          privately.
        </p>
        {invite && (
          <div className="discovery-field">
            <label htmlFor="new-group-invite">Your invitation link</label>
            <input
              id="new-group-invite"
              readOnly
              value={invite}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(invite);
                  setCopied(true);
                } catch {
                  setError("Select the link above and copy it to share.");
                }
              }}
            >
              <Copy size={16} aria-hidden="true" />{" "}
              {copied ? "Copied" : "Copy invite link"}
            </button>
          </div>
        )}
        <p className="discovery-hint">
          Places are searched only after everyone joins and confirms their
          preferences.
        </p>
        {!invite && (
          <button
            className="secondary"
            disabled={busy || sessionLoading}
            onClick={() => void save()}
          >
            {busy ? "Creating link…" : "Create invitation link"}
          </button>
        )}
        <Link
          className="primary"
          href={`/group/${encodeURIComponent(groupId)}`}
        >
          Open your group <ArrowRight size={18} aria-hidden="true" />
        </Link>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <span className="sr-only" role="status">
          {copied ? "Invitation link copied" : ""}
        </span>
      </section>
    );
  return (
    <form
      className="discovery-form group-first-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset className="group-setup-fields" disabled={busy}>
        <fieldset className="discovery-categories">
          <legend>What brings you together?</legend>
          <div>
            {Object.entries(discoveryCategories).map(([value, item]) => {
              const Icon = icons[value as DiscoveryCategory];
              return (
                <button
                  type="button"
                  key={value}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value as DiscoveryCategory)}
                >
                  <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="discovery-field">
          <label htmlFor="group-location">Where shall we meet?</label>
          <div className="discovery-location-wrap">
            <MapPin size={18} aria-hidden="true" />
            <input
              id="group-location"
              required
              minLength={2}
              maxLength={160}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="City, neighborhood or landmark"
            />
          </div>
        </div>
        <div className="group-setup-grid">
          <div className="discovery-field">
            <label htmlFor="group-name">
              Plan name <span>(optional)</span>
            </label>
            <input
              id="group-name"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Friday with friends"
            />
          </div>
          <div className="discovery-field">
            <label htmlFor="organizer-name">Your name</label>
            <input
              id="organizer-name"
              required
              maxLength={80}
              autoComplete="given-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="What should friends call you?"
            />
          </div>
          <div className="discovery-field">
            <label htmlFor="group-size">People, including you</label>
            <input
              id="group-size"
              type="number"
              required
              min={2}
              max={100}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </div>
          <div className="discovery-field">
            <label htmlFor="group-date">When are we meeting?</label>
            <input
              id="group-date"
              type="datetime-local"
              required
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </div>
        </div>
        <div className="discovery-field">
          <label htmlFor="group-preferences">
            What matters to you? <span>(optional)</span>
          </label>
          <textarea
            id="group-preferences"
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={discoveryCategories[category].example}
            aria-describedby="group-preferences-help"
          />
          <p id="group-preferences-help" className="discovery-hint">
            Saved privately for you to review in the group. Your friends will
            add their own.
          </p>
        </div>
      </fieldset>
      <button
        type="submit"
        className="primary"
        disabled={busy || sessionLoading}
      >
        <Users size={18} aria-hidden="true" />
        {busy ? "Saving group…" : "Save group & invite friends"}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <p className="discovery-form-note">
        Everyone’s preferences first. The right place, together.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
