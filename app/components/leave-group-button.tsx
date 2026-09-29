"use client";

import { useState } from "react";

export function LeaveGroupButton({
  groupId,
  locked,
}: {
  groupId: string;
  locked: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function leave() {
    if (
      !window.confirm(
        "Leave this group? Your preferences and any saved comparison will be removed. If you are the last member, the group will be deleted.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(groupId)}/leave`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "REQUEST_FAILED");
      if (localStorage.getItem("converge:last-group") === groupId)
        localStorage.removeItem("converge:last-group");
      window.location.assign("/");
    } catch (failure) {
      const code =
        failure instanceof Error ? failure.message : "REQUEST_FAILED";
      setError(
        code === "GROUP_LOCKED"
          ? "Membership is fixed after a proposal locks the group."
          : code === "NOT_MEMBER"
            ? "This wallet is no longer a group member."
            : "Could not leave the group. Please try again.",
      );
      setBusy(false);
    }
  }

  if (locked)
    return (
      <p className="flow-note">
        Membership is fixed after a proposal locks the group.
      </p>
    );
  return (
    <div>
      <button
        className="secondary"
        type="button"
        disabled={busy}
        onClick={() => void leave()}
      >
        {busy ? "Leaving…" : "Leave group"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
