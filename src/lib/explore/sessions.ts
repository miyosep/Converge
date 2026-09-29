import type { ExploreRun } from "./types.js";

export function canRestartDemo(run: ExploreRun) {
  return (
    !run.command &&
    run.transactions.every((tx) => tx.confirmed) &&
    (["completed", "cancelled", "expired"].includes(run.phase) ||
      (["preferences", "review", "proposal"].includes(run.phase) &&
        run.transactions.length === 0))
  );
}

export function latestRuns(runs: ExploreRun[]) {
  return runs.sort(
    (a, b) =>
      (b.sequence ?? 0) - (a.sequence ?? 0) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id.localeCompare(a.id),
  );
}

// Reclaim only idle, pre-payment capacity. Never discard a run or financial history.
export function occupiesDemoSlot(run: ExploreRun, now = Date.now()) {
  if (["completed", "cancelled", "expired"].includes(run.phase)) return false;
  if (
    run.command ||
    run.policy ||
    run.transactions.length ||
    run.searchInFlight ||
    run.extractionInFlight
  )
    return true;
  const activity = Date.parse(run.lastActiveAt ?? run.createdAt);
  return !Number.isFinite(activity) || now - activity < 30 * 60_000;
}
