import Link from "next/link";
import type { ReactNode } from "react";
import { AppHeader } from "./product-ui";

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

export function WorkspaceFrame({
  children,
  active = "workspace",
}: {
  children: ReactNode;
  active?: "workspace" | "evidence";
}) {
  return (
    <div className="shell">
      <AppHeader active={active} />
      <main className="flow-content" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
