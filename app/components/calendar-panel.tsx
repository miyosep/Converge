"use client";
import { useState } from "react";
import { CalendarDays, Copy, ArrowUpRight } from "lucide-react";
import type { GroupOverview } from "../../src/lib/group-view";

export function CalendarPanel({ overview }: { overview: GroupOverview }) {
  const [notice, setNotice] = useState("");
  const selected = overview.evaluation?.catalog.find(
    (item) => item.id === overview.evaluation?.winnerId,
  );
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: overview.group.timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(overview.group.startsAt));
  const text = [
    `[Converge plan] ${overview.group.name}`,
    `When: ${date} (${overview.group.timeZone})`,
    `Place: ${selected?.name ?? "To be decided"}${selected?.area ? ` · ${selected.area}` : ""}`,
    `Group: ${overview.group.targetMemberCount} people`,
    "End time: choose in your calendar.",
    "Prototype plan — sample venue, not a confirmed reservation.",
  ].join("\n");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(
        "Copied. Paste into a new Google Calendar event and review the date and time before saving.",
      );
    } catch {
      setNotice("Select the text above and copy it manually.");
    }
  }
  return (
    <section className="flow-panel calendar-panel">
      <h3>
        <CalendarDays size={21} aria-hidden="true" />
        Keep the plan on your calendar
      </h3>
      <p>
        Copy these details into Google Calendar. No account connection needed.
      </p>
      <label>
        Details to copy
        <textarea
          className="calendar-copy"
          readOnly
          rows={7}
          value={text}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <div className="flow-actions">
        <button className="secondary" onClick={() => void copy()}>
          <Copy size={16} aria-hidden="true" />
          Copy event details
        </button>
        <a
          className="text-button"
          href="https://calendar.google.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open Google Calendar <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </div>
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>Google Calendar integration</summary>
        <p>
          With Google Calendar connected, plans can be added automatically after
          the group's payment is confirmed. Account connection is not enabled in
          this preview; use copy and paste for now.
        </p>
      </details>
    </section>
  );
}
