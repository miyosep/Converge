import { ChevronDown, ExternalLink } from "lucide-react";
import type { ExploreRun } from "../../src/lib/explore/types";

type Transactions = ExploreRun["transactions"];
const PREVIEW_COUNT = 5;

function TransactionList({ transactions }: { transactions: Transactions }) {
  return (
    <ul className="explore-history">
      {transactions.map((tx) => (
        <li key={tx.hash}>
          <span>
            {tx.label.startsWith("Contribution ")
              ? "Automated contribution"
              : tx.label.startsWith("Allowance ")
                ? "Automated token allowance"
                : tx.label.startsWith("Refund ")
                  ? "Automated refund"
                  : tx.label}
            <small>
              {tx.failed ? "Reverted" : tx.confirmed ? "Confirmed" : "Pending"}
            </small>
          </span>
          <a
            href={`https://sepolia.etherscan.io/tx/${tx.hash}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${tx.label} transaction ${tx.hash} on Sepolia Etherscan`}
          >
            {tx.hash.slice(0, 6)}…{tx.hash.slice(-4)}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function DemoTransactionHistory({
  transactions,
}: {
  transactions: Transactions;
}) {
  if (transactions.length === 0) return null;
  // The worker appends transactions in submission order. Copy before reversing.
  const latestFirst = [...transactions].reverse();
  const earlier = latestFirst.slice(PREVIEW_COUNT);
  return (
    <section className="explore-section">
      <div className="history-heading">
        <h2>Transaction history</h2>
        <span className="pill">{transactions.length} total</span>
      </div>
      <p className="explore-disclosure history-description">
        Newest first. Progress uses two block confirmations; finality follows
        Ethereum consensus.
      </p>
      <TransactionList transactions={latestFirst.slice(0, PREVIEW_COUNT)} />
      {earlier.length > 0 && (
        <details className="history-more">
          <summary>
            <span className="history-show-more">
              Show {earlier.length} earlier{" "}
              {earlier.length === 1 ? "transaction" : "transactions"}
            </span>
            <span className="history-show-less">Show fewer transactions</span>
            <ChevronDown size={17} aria-hidden="true" />
          </summary>
          <TransactionList transactions={earlier} />
        </details>
      )}
    </section>
  );
}
