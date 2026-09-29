import Link from "next/link";
import { WorkspaceFrame } from "./components/workspace-frame";

export default function NotFound() {
  return (
    <WorkspaceFrame>
      <section className="flow-panel flow-empty">
        <div className="eyebrow">404</div>
        <h1>This page isn't available</h1>
        <p>Return to your groups or choose a published evidence record.</p>
        <div className="flow-actions">
          <Link className="primary flow-link" href="/">
            My groups
          </Link>
          <Link className="secondary flow-link" href="/evidence">
            Evidence
          </Link>
        </div>
      </section>
    </WorkspaceFrame>
  );
}
