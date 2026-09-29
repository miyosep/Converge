"use client";

import { useEffect, useState } from "react";
import type { SavedEvaluation } from "../../src/lib/group-view.js";
import type {
  FlowUsage,
  SavedExplanation,
} from "../../src/lib/db/group-insights.js";

type Insights = {
  explanation: SavedExplanation | null;
  usage: FlowUsage[];
  cacheHit?: boolean;
};

const measured = (value: number | null) =>
  value === null ? "—" : value.toLocaleString("en-US");

export function GroupInsightsPanel({
  groupId,
  evaluation,
}: {
  groupId: string;
  evaluation: SavedEvaluation;
}) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/insights/${encodeURIComponent(groupId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("INSIGHTS_UNAVAILABLE");
        return (await response.json()) as Insights;
      })
      .then(setInsights)
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Usage records are unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [groupId, evaluation.id]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/insights/${encodeURIComponent(groupId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const result = (await response.json()) as Insights & { error?: string };
      if (!response.ok) {
        setError(
          result.error === "EXPLANATION_IN_PROGRESS"
            ? "Another member is preparing the explanation. Refresh in a moment."
            : "The explanation could not be prepared. Please try again.",
        );
        return;
      }
      setInsights(result);
    } catch {
      setError("The explanation could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flow-panel" aria-label="Explanation and AI usage">
      <h2>Why this result?</h2>
      <p className="flow-muted">
        The explanation uses only public candidate facts. Individual inputs and
        rejection reasons are never sent to the explanation model.
      </p>
      {insights?.explanation ? (
        <div className="flow-note" role="status">
          <strong>
            {insights.explanation.source === "kiln"
              ? "Kiln-selected public facts"
              : "Deterministic fallback"}
          </strong>
          <p>{insights.explanation.text}</p>
          <small>
            The restaurant catalog and prices are synthetic. This explanation
            does not authorize a payment.
          </small>
        </div>
      ) : evaluation.status === "PROPOSAL_READY" ? (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void generate()}
        >
          {busy ? "Preparing explanation…" : "Explain the saved result"}
        </button>
      ) : (
        <p>No restaurant met all confirmed requirements.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <h3>AI usage for this group</h3>
      <p className="flow-muted">
        Attempts include retries and failures. A dash means the provider did not
        report a complete measurement; cache hits did not call the model.
      </p>
      {loading ? (
        <p role="status">Loading usage…</p>
      ) : insights ? (
        <div
          className="review-table-scroll"
          tabIndex={0}
          aria-label="Group AI usage"
        >
          <table className="review-table">
            <thead>
              <tr>
                <th scope="col">Flow</th>
                <th scope="col">Attempts</th>
                <th scope="col">Failures</th>
                <th scope="col">Retries</th>
                <th scope="col">No token counts</th>
                <th scope="col">Input tokens</th>
                <th scope="col">Output tokens</th>
                <th scope="col">Reported USD</th>
                <th scope="col">Cache hits</th>
              </tr>
            </thead>
            <tbody>
              {insights.usage.map((flow) => (
                <tr key={flow.flow}>
                  <th scope="row">{flow.flow.replaceAll("_", " ")}</th>
                  <td>{flow.attempts}</td>
                  <td>{flow.failedAttempts}</td>
                  <td>{flow.retryAttempts}</td>
                  <td>{flow.unavailableUsageAttempts}</td>
                  <td>{measured(flow.inputTokens)}</td>
                  <td>{measured(flow.outputTokens)}</td>
                  <td>
                    {flow.reportedCostUsd === null
                      ? "—"
                      : `$${flow.reportedCostUsd.toFixed(8)}`}
                  </td>
                  <td>{flow.applicationCacheHits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="flow-muted">Energy use is unavailable from the provider.</p>
    </section>
  );
}
