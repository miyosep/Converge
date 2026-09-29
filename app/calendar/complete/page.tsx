"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WorkspaceFrame } from "../../components/workspace-frame";
export default function CalendarComplete() {
  const started = useRef(false),
    [error, setError] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (new URLSearchParams(location.search).has("error")) {
      setError(true);
      return;
    }
    void fetch("/api/calendar/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        location.replace(data.redirect);
      })
      .catch(() => setError(true));
  }, []);
  return (
    <WorkspaceFrame>
      <section className="flow-panel">
        <h1>
          {error
            ? "Google wasn't connected"
            : "Finishing your Google connection…"}
        </h1>
        <p role="status">
          {error
            ? "Sign in with the same wallet and try connecting again from your plan. You may have declined access or the connection request expired."
            : "Please keep this page open. Your wallet stays your Converge account."}
        </p>
        {error && <Link href="/">Back to my plans</Link>}
      </section>
    </WorkspaceFrame>
  );
}
