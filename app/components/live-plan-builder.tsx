"use client";
import { useRef, useState } from "react";

export function LivePlanBuilder({
  searchId,
  placeIds,
}: {
  searchId: string;
  placeIds: string[];
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [count, setCount] = useState(4);
  const [deposit, setDeposit] = useState(30);
  const [when, setWhen] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef("");
  return (
    <form
      className="flow-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        requestId.current ||= crypto.randomUUID();
        void (async () => {
          try {
            const response = await fetch("/api/groups/live", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requestId: requestId.current,
                searchId,
                placeIds,
                name,
                displayName,
                targetMemberCount: count,
                depositUsdc: deposit,
                slot: {
                  startsAt: new Date(when)
                    .toISOString()
                    .replace(/\.\d{3}Z$/, "Z"),
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
                acknowledgeDemo: accepted,
              }),
            });
            const data = await response.json();
            if (!response.ok)
              throw new Error(
                data.error === "RESERVATION_PASSED"
                  ? "Choose a future date and time."
                  : "Could not create the group. Check the date, group size and deposit, then retry.",
              );
            window.location.assign(
              `/group/${encodeURIComponent(data.groupId)}`,
            );
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not create the group.",
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h2>Plan with friends</h2>
      <p>
        Use this search as a starting point and invite your friends. Everyone
        shares their own preferences privately; a new search will include all
        confirmed requirements before anyone agrees or pays.
      </p>
      <label>
        Plan name
        <input
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Your name
        <input
          required
          maxLength={80}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <label>
        People, including you
        <input
          required
          type="number"
          min={2}
          max={100}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        />
      </label>
      <label>
        Plan date and time
        <input
          required
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
        />
      </label>
      <label>
        Exact group deposit (MockUSDC)
        <input
          required
          type="number"
          min={1}
          max={Math.min(60, count * 10)}
          step={1}
          value={deposit}
          onChange={(event) => setDeposit(Number(event.target.value))}
        />
      </label>
      <p>
        Each person contributes 10 MockUSDC on Sepolia. The unused balance can
        be refunded. Participants need test tokens and Sepolia gas in their own
        wallets.
      </p>
      <label>
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          required
        />{" "}
        Share this starting shortlist and search area with invited members.
        Venue conditions may be unverified. Booking and USDC acceptance are demo
        assumptions; the recipient is the configured demo booking wallet.
      </label>
      <button
        className="primary"
        disabled={busy || !accepted || !placeIds.length}
      >
        {busy ? "Saving group…" : "Save group & invite friends"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
