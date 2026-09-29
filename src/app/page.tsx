import Link from "next/link";

export default function HomePage() {
  return (
    <div className="container">
      <nav className="nav">
        <span className="nav-brand">Converge</span>
        <div className="nav-links">
          <Link href="/">Groups</Link>
          <Link href="/evidence">Evidence</Link>
        </div>
      </nav>

      <h1>Your Groups</h1>
      <p className="subtitle">
        AI proposes. Humans approve. Smart contracts enforce.
      </p>

      <div className="card">
        <div className="grid-2" style={{ alignItems: "center" }}>
          <div>
            <h3>Seoul Saturday Dinner</h3>
            <p className="muted mb-2">6 of 6 participants</p>
            <span className="badge badge-green">Ready to evaluate</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <Link href="/group/demo-001" className="btn btn-primary">
              Open
            </Link>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="grid-2" style={{ alignItems: "center" }}>
          <div>
            <h3>New Group</h3>
            <p className="muted mb-2">
              Create a group and invite up to 6 participants
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <Link href="/group/new" className="btn">
              Create group
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
