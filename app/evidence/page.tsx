import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileCheck2 } from "lucide-react";
import { publishedEvidence } from "../../src/lib/published-evidence";
import { WorkspaceFrame } from "../components/workspace-frame";

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run: runId } = await searchParams;
  const run = publishedEvidence.find(
    (entry) => entry.id === (runId ?? "group-acceptance-001-baseline"),
  );
  if (!run) notFound();
  return (
    <WorkspaceFrame active="evidence">
      <div className="heading">
        <div>
          <div className="eyebrow">PUBLISHED EVIDENCE</div>
          <h1>See what was recorded.</h1>
          <p className="flow-muted">
            Synthetic test records, with their scope and missing evidence kept
            visible.
          </p>
        </div>
        <FileCheck2 size={30} />
      </div>
      <p className="flow-note">
        These published records are separate from your private groups and your
        current Explore Demo session.
      </p>
      <nav className="evidence-selector" aria-label="Select evidence run">
        {publishedEvidence.map((entry) => (
          <Link
            key={entry.id}
            href={`/evidence?run=${entry.id}`}
            aria-current={entry.id === run.id ? "page" : undefined}
          >
            <small>{entry.scope}</small>
            <strong>{entry.title}</strong>
          </Link>
        ))}
      </nav>
      <section className="flow-panel">
        <div className="panel-heading">
          <h2>{run.title}</h2>
          <span className="pill">{run.completeness ?? "Partial evidence"}</span>
        </div>
        <p>{run.summary}</p>
        <p className="flow-note">{run.limitation}</p>
        <dl className="terms-list">
          {run.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {run.scenarios.length > 0 && (
        <section className="flow-panel">
          <h2>Condition-change comparison</h2>
          <div
            className="review-table-scroll"
            tabIndex={0}
            aria-label="Condition-change comparison"
          >
            <table className="review-table">
              <caption>
                {run.scenarioCaption ?? "Fixture outcomes only"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th scope="col">Condition</th>
                  <th scope="col">Selected candidate</th>
                </tr>
              </thead>
              <tbody>
                {run.scenarios.map((scenario) => (
                  <tr key={scenario.id}>
                    <th scope="row">{scenario.id.replaceAll("-", " ")}</th>
                    <td>{scenario.condition}</td>
                    <td>{scenario.winner ?? "No match"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="flow-panel">
        <h2>AI usage by flow</h2>
        <p className="flow-muted">
          A dash means no measured usage is available in this record. It does
          not mean zero.
        </p>
        <div className="review-table-scroll" tabIndex={0} aria-label="AI usage">
          <table className="review-table">
            <caption>Usage recorded for {run.id}</caption>
            <thead>
              <tr>
                <th scope="col">Flow</th>
                <th scope="col">Recorded calls</th>
                <th scope="col">Input tokens</th>
                <th scope="col">Output tokens</th>
              </tr>
            </thead>
            <tbody>
              {run.usage.map((usage) => (
                <tr key={usage.flow}>
                  <th scope="row">{usage.flow.replaceAll("_", " ")}</th>
                  <td>{usage.calls ?? "—"}</td>
                  <td>{usage.inputTokens?.toLocaleString("en-US") ?? "—"}</td>
                  <td>{usage.outputTokens?.toLocaleString("en-US") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="flow-panel">
        <h2>Chain records</h2>
        {run.transactions.length === 0 ? (
          <p className="flow-muted">
            This record contains no chain transaction evidence.
          </p>
        ) : (
          <div
            className="review-table-scroll"
            tabIndex={0}
            aria-label="Recorded chain transactions"
          >
            <table className="review-table">
              <caption>Saved Sepolia receipts</caption>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Block</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {run.transactions.map((transaction) => (
                  <tr key={transaction.hash}>
                    <th scope="row">{transaction.label}</th>
                    <td>{transaction.status}</td>
                    <td>{transaction.block}</td>
                    <td>
                      <a
                        className="flow-external"
                        href={`https://sepolia.etherscan.io/tx/${transaction.hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {transaction.hash.slice(0, 8)}…
                        {transaction.hash.slice(-6)} <ExternalLink size={14} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </WorkspaceFrame>
  );
}
