import Link from "next/link";
import type { ReactNode } from "react";

export type GroupStage =
  "lobby" | "preferences" | "results" | "approve" | "execution";
export const groupStages: { key: GroupStage; label: string; path: string }[] = [
  { key: "lobby", label: "Group", path: "" },
  { key: "preferences", label: "Preferences", path: "/preferences" },
  { key: "results", label: "Results", path: "/results" },
  { key: "approve", label: "Policy & approval", path: "/approve" },
  { key: "execution", label: "Execution", path: "/execution" },
];

export function GroupNavigation({
  id,
  active,
}: {
  id: string;
  active: GroupStage;
}) {
  return (
    <nav className="workflow-nav" aria-label="Group workflow">
      {groupStages.map((stage, index) => (
        <Link
          key={stage.key}
          href={`/group/${encodeURIComponent(id)}${stage.path}`}
          aria-current={stage.key === active ? "page" : undefined}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          {stage.label}
        </Link>
      ))}
    </nav>
  );
}

export function WorkspaceFrame({ children }: { children: ReactNode }) {
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">C</span>Converge
        </Link>
        <nav className="top-actions" aria-label="Main navigation">
          <Link className="text-button" href="/">
            My groups
          </Link>
          <Link className="text-button" href="/evidence">
            Evidence
          </Link>
          <Link className="text-button" href="/demo">
            Explore Demo ↗
          </Link>
        </nav>
      </header>
      <div className="flow-content">{children}</div>
    </main>
  );
}
