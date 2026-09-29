"use client";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import type { GroupHistory } from "../../src/lib/group-execution";
import type { SigningPolicy } from "../../src/lib/group-policy";
import { GroupChainPanel } from "./group-chain-panel";

const money = (value: string) => `${formatUnits(BigInt(value), 6)} MockUSDC`;
export function GroupExecutionPanel({
  groupId,
  saved,
}: {
  groupId: string;
  saved: SigningPolicy;
}) {
  const [history, setHistory] = useState<GroupHistory | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false,
      checking = false;
    const refresh = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch(
          `/api/groups/${encodeURIComponent(groupId)}/history`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("History unavailable");
        const next = (await response.json()) as GroupHistory;
        if (!stopped) {
          setHistory(next);
          setError("");
        }
      } catch {
        if (!stopped) {
          setHistory(null);
          setError(
            "Execution history could not be loaded. No completion is inferred.",
          );
        }
      } finally {
        checking = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [groupId]);
  const snapshot = history?.snapshot;
  return (
    <>
      <section className="flow-panel">
        <h2>Agent payment and settlement</h2>
        <p>
          The executor can pay only this policy's approved merchant and exact
          amount after every participant contributes. Each participant claims
          their own unused funds.
        </p>
        {snapshot ? (
          <>
            <p>
              Total contributed: {money(snapshot.state.contributed)} · Paid:{" "}
              {money(snapshot.state.spent)} · Refunded:{" "}
              {money(snapshot.state.refunded)}
            </p>
            <p>
              Worker checked block {snapshot.blockNumber} at{" "}
              {new Date(snapshot.checkedAt).toLocaleString()}. These saved
              records have two block confirmations, not finalized status.
            </p>
          </>
        ) : (
          <p>
            No worker snapshot is recorded yet. The configured group executor
            must be running to record history and execute eligible payments.
          </p>
        )}
        {history?.execution && (
          <p>
            Agent transaction:{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${history.execution.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              {history.execution.status}
            </a>
            {history.execution.errorCode
              ? ` · ${history.execution.errorCode}`
              : ""}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      <section className="flow-panel">
        <h2>Recorded transaction events</h2>
        {history?.events.length ? (
          <ul>
            {history.events.map((event) => (
              <li key={`${event.hash}:${event.logIndex}`}>
                <strong>{event.kind}</strong>
                {event.amount ? ` · ${money(event.amount)}` : ""}
                {event.participant
                  ? ` · ${event.participant.slice(0, 6)}…${event.participant.slice(-4)}`
                  : ""}{" "}
                ·{" "}
                <a
                  href={`https://sepolia.etherscan.io/tx/${event.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Block {event.blockNumber}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>No confirmed events are recorded yet.</p>
        )}
      </section>
      <section className="flow-panel">
        <GroupChainPanel
          key={saved.policyHash}
          groupId={groupId}
          saved={saved}
        />
      </section>
    </>
  );
}
