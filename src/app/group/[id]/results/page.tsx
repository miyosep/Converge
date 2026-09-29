import Link from "next/link";

const candidates = [
  {
    id: "A",
    name: "Restaurant A",
    price: "$32/person",
    deposit: "45 USDC",
    score: 92.3,
    eligible: true,
    reason: null,
  },
  {
    id: "B",
    name: "Restaurant B",
    price: "$24/person",
    deposit: "36 USDC",
    score: 70.0,
    eligible: true,
    reason: null,
  },
  {
    id: "C",
    name: "Restaurant C",
    price: "$22/person",
    deposit: "30 USDC",
    score: null,
    eligible: false,
    reason: "Shellfish safety not confirmed",
  },
  {
    id: "D",
    name: "Restaurant D",
    price: "$28/person",
    deposit: "42 USDC",
    score: 55.0,
    eligible: true,
    reason: null,
  },
  {
    id: "E",
    name: "Restaurant E",
    price: "$30/person",
    deposit: "45 USDC",
    score: null,
    eligible: false,
    reason: "Not available on this slot",
  },
];

export default function ResultsPage({
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

      <h1>Results</h1>
      <p className="subtitle">
        Meets the group's confirmed requirements and has the highest preference
        score among eligible options.
      </p>

      <div className="card" style={{ borderColor: "var(--green)" }}>
        <h3 style={{ color: "var(--green)" }}>Recommended: Restaurant A</h3>
        <p className="muted mb-2">
          Score 92.3/100 · $32/person · 150m from subway
        </p>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <Link href="/group/demo-001/approve" className="btn btn-primary">
            Review policy & approve
          </Link>
        </div>
      </div>

      <div className="card">
        <h3>All candidates</h3>
        <table>
          <thead>
            <tr>
              <th>Restaurant</th>
              <th>Price/person</th>
              <th>Deposit</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name}
                  {c.id === "A" && (
                    <span
                      className="badge badge-green"
                      style={{ marginLeft: "0.5rem" }}
                    >
                      Winner
                    </span>
                  )}
                </td>
                <td>{c.price}</td>
                <td>{c.deposit}</td>
                <td>{c.score !== null ? c.score.toFixed(1) : "—"}</td>
                <td>
                  {c.eligible ? (
                    <span className="badge badge-green">Eligible</span>
                  ) : (
                    <span className="badge badge-red">{c.reason}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
