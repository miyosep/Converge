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
