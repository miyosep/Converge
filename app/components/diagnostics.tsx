"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type { DiagnosticSeverity } from "../../src/lib/diagnostics/types";

type PublicDiagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  stage: string;
  retryable: boolean;
  title: string;
  guidance: string;
};

type DiagnosticSummary = {
  worst: DiagnosticSeverity | null;
  blocking: boolean;
  bySeverity: Record<DiagnosticSeverity, number>;
};

type Props = {
  diagnostics: PublicDiagnostic[];
  summary?: DiagnosticSummary | null;
  // Offered only when a reminder is actually retryable, so the UI never invites a
  // retry that is guaranteed to fail the same way.
  onRetry?: () => void;
  onDismiss?: () => void;
  isBusy?: boolean;
};

const ICONS: Record<DiagnosticSeverity, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
};

const STAGE_LABELS: Record<string, string> = {
  input: "Input",
  preference: "Preferences",
  eligibility: "Candidate matching",
  ranking: "Ranking",
  approval: "Approval",
  funding: "Funding",
  execution: "Payment",
  settlement: "Settlement",
  infrastructure: "System",
};

function severityLabel(severity: DiagnosticSeverity) {
  return severity === "error"
    ? "Blocked"
    : severity === "warning"
      ? "Needs attention"
      : "Note";
}

export function DiagnosticList({
  diagnostics,
  summary,
  onRetry,
  onDismiss,
  isBusy,
}: Props) {
  if (!diagnostics.length && !summary) return null;

  // Errors first, then warnings, then notes; stable within a severity because
  // the server already sorted by stage and code.
  const order: DiagnosticSeverity[] = ["error", "warning", "info"];
  const sorted = [...diagnostics].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );

  if (!sorted.length)
    return (
      <div className="diagnostics" role="status">
        <div className="diagnostic diagnostic--info">
          <CheckCircle2 size={17} aria-hidden />
          <div className="diagnostic-body">
            <div className="diagnostic-head">
              <strong>No outstanding issues</strong>
              <span className="diagnostic-severity">Clear</span>
            </div>
            <p>Every check for the current step passed.</p>
          </div>
        </div>
      </div>
    );

  const retryable = sorted.some((entry) => entry.retryable);

  return (
    <div className="diagnostics" role="status" aria-live="polite">
      {onRetry && retryable && (
        <div className="diagnostic-actions">
          <button
            className="secondary"
            type="button"
            onClick={onRetry}
            disabled={isBusy}
          >
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      )}
      {onDismiss && (
        <button
          className="diagnostic-dismiss"
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss reminders"
        >
          Dismiss
        </button>
      )}
      {sorted.map((entry, index) => {
        const Icon = ICONS[entry.severity] ?? Info;
        return (
          <div
            className={`diagnostic diagnostic--${entry.severity}`}
            key={`${entry.code}-${index}`}
          >
            <Icon size={17} aria-hidden />
            <div className="diagnostic-body">
              <div className="diagnostic-head">
                <strong>{entry.title}</strong>
                <span className="diagnostic-severity">
                  {severityLabel(entry.severity)}
                </span>
              </div>
              <p>{entry.guidance}</p>
              <div className="diagnostic-meta">
                <span className="diagnostic-stage">
                  {STAGE_LABELS[entry.stage] ?? entry.stage}
                </span>
                <code>{entry.code}</code>
                {!entry.retryable && (
                  <span className="diagnostic-noretry">
                    Retry will not help
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Compact form for the sidebar or the participants panel: counts plus the
// highest-severity title, expandable to the full list.
export function DiagnosticBadge({
  diagnostics,
  summary,
}: {
  diagnostics: PublicDiagnostic[];
  summary?: DiagnosticSummary | null;
}) {
  if (!summary || summary.worst === null) return null;
  const worst = diagnostics.find((entry) => entry.severity === summary.worst);
  const Icon = ICONS[summary.worst] ?? Info;
  return (
    <div className={`diagnostic-badge diagnostic-badge--${summary.worst}`}>
      <Icon size={15} aria-hidden />
      <span>{worst?.title ?? "Issue detected"}</span>
      {summary.bySeverity.error > 0 && (
        <b>{summary.bySeverity.error} blocked</b>
      )}
      {summary.bySeverity.warning > 0 && (
        <b>{summary.bySeverity.warning} to review</b>
      )}
    </div>
  );
}
