import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, LockKeyhole, Sparkles, ShieldCheck } from "lucide-react";
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
  const baseline = publishedEvidence.find(
    (entry) => entry.id === "group-acceptance-001-baseline",
  )!;
  const payment = baseline.transactions.find(
    (entry) => entry.label === "baseline-payment",
  );
  return (
    <WorkspaceFrame active="evidence">
      <section className="evidence-intro" aria-labelledby="evidence-title">
        <p className="eyebrow">BEHIND THE DEMO</p>
        <h1 id="evidence-title">
          Private wishes. Shared plans.
          <br />
          Payment you approve.
        </h1>
        <p>
          Converge helps a group find a plan together, then lets an agent carry
          out the payment within the terms everyone approved.
        </p>
        <Link className="secondary" href="/demo">
          Explore the demo <ExternalLink size={16} />
        </Link>
      </section>
      <section className="evidence-features" aria-label="How Converge works">
        {[
          {
            Icon: LockKeyhole,
            title: "Share privately",
            text: "Tell us your budget and needs. Your individual answers stay private from the rest of your group.",
          },
          {
            Icon: Sparkles,
            title: "Find a shared fit",
            text: "AI helps understand your preferences. You review them, then suggestions are checked against everyone's confirmed requirements.",
          },
          {
            Icon: ShieldCheck,
            title: "Approve, then delegate",
            text: "Everyone reviews the same payment terms and contributes their share. Your agent can then pay within those approved limits.",
          },
        ].map(({ Icon, title, text }) => (
          <article key={title}>
            <Icon size={24} aria-hidden="true" />
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="evidence-outcomes" aria-labelledby="outcomes-title">
        <p className="eyebrow">WHAT WE VERIFIED</p>
        <h2 id="outcomes-title">
          Approved payments go through.
          <br />
          Spending limits hold.
        </h2>
        <p className="flow-muted">
          Highlights from the saved baseline group test on Ethereum Sepolia.
        </p>
        <div className="evidence-outcome-grid">
          <article>
            <span className="pill">Payment recorded</span>
            <h3>An agent completed the approved payment.</h3>
            <p>
              Six wallet sessions approved and funded the group plan. The agent
              paid{" "}
              {baseline.facts.find((fact) => fact.label === "Payment")?.value},
              and unused funds were refunded.
            </p>
            {payment && (
              <a
                className="flow-external"
                href={`https://sepolia.etherscan.io/tx/${payment.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View the payment receipt <ExternalLink size={16} />
              </a>
            )}
          </article>
          <article>
            <span className="pill">Limit enforced in simulation</span>
            <h3>A request above the deposit limit was rejected.</h3>
            <p>
              An 80 USDC request failed the contract's spending check. This was
              a read-only simulation; no invalid payment transaction was sent.
            </p>
            <Link href="/evidence?run=group-acceptance-001-baseline#saved-records">
              Inspect the baseline record
            </Link>
          </article>
        </div>
        <p className="evidence-scope">
          These tests used synthetic preferences and test tokens, with one
          operator controlling six wallets. They demonstrate the recorded flow;
          reservations are simulated. Your private groups and current demo
          session are not published here.
        </p>
      </section>
      <section
        id="saved-records"
        className="evidence-records"
        aria-labelledby="records-title"
      >
        <h2 id="records-title">Explore the saved records</h2>
        <p className="flow-muted">
          Choose a test, then open the details you want to inspect.
        </p>
        <nav className="evidence-selector" aria-label="Select evidence run">
          {publishedEvidence.map((entry) => (
            <Link
              key={entry.id}
              href={`/evidence?run=${entry.id}#saved-records`}
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
            <span className="pill">
              {run.completeness ?? "Partial evidence"}
            </span>
          </div>
          <p>{run.summary}</p>
          <p className="flow-note">{run.limitation}</p>
          <details>
            <summary>Test details and verification facts</summary>
            <dl className="terms-list">
              {run.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
        {run.scenarios.length > 0 && (
          <details className="flow-panel evidence-disclosure">
            <summary>Test scenario and selection results</summary>
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
          </details>
        )}
        <details className="flow-panel evidence-disclosure">
          <summary>AI calls and token usage</summary>
          <p className="flow-muted">
            A dash means no measured usage is available in this record. It does
            not mean zero.
          </p>
          <div
            className="review-table-scroll"
            tabIndex={0}
            aria-label="AI usage"
          >
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
                    <td>
                      {usage.outputTokens?.toLocaleString("en-US") ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details className="flow-panel evidence-disclosure">
          <summary>Payment and transaction records</summary>
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
                          {transaction.hash.slice(-6)}{" "}
                          <ExternalLink size={14} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </section>
    </WorkspaceFrame>
  );
}
