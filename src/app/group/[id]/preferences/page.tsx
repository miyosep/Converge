import Link from "next/link";

export default function PreferencesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="container">
      <nav className="nav">
        <span className="nav-brand">Converge</span>
        <div className="nav-links">
          <Link href="/">Groups</Link>
          <Link href="/evidence">Evidence</Link>
        </div>
      </nav>

      <h1>Your Preferences</h1>
      <p className="subtitle">
        Your input is private. Other members only see a sanitized result.
      </p>

      <div className="card">
        <h3>1. Tell us what you want</h3>
        <p className="muted mb-2">
          Write in natural language. The AI will extract structured constraints.
        </p>
        <div className="form-group">
          <textarea
            rows={3}
            placeholder="I can spend at most $35 per person, and I would like somewhere quiet."
            defaultValue="I can spend at most $35 per person, and I would like somewhere quiet."
          />
        </div>
        <button className="btn btn-primary">Extract with AI</button>
      </div>

      <div className="card">
        <h3>2. Review extracted constraints</h3>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="badge badge-red">Hard</span>
              </td>
              <td>budget_per_person_cents ≤</td>
              <td>$35.00</td>
            </tr>
            <tr>
              <td>
                <span className="badge badge-blue">Soft</span>
              </td>
              <td>quiet</td>
              <td>weight 0.8</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-4" style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn">Edit</button>
          <Link href="/group/demo-001" className="btn btn-primary">
            Confirm
          </Link>
        </div>
      </div>
    </div>
  );
}
