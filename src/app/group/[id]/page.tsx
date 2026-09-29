import Link from "next/link";

const participants = [
  { name: "Alice", wallet: "0x71C2...9f3A", submitted: true, confirmed: true },
  { name: "Bob", wallet: "0x4E8b...21Cd", submitted: true, confirmed: true },
  {
    name: "Charlie",
    wallet: "0x9aF0...7b2E",
    submitted: true,
    confirmed: true,
  },
  { name: "Dana", wallet: "0x3dB1...84fA", submitted: true, confirmed: true },
  { name: "Erin", wallet: "0x6cE4...19D3", submitted: true, confirmed: true },
  { name: "Farah", wallet: "0x2A5f...e0B7", submitted: true, confirmed: true },
];

export default function GroupLobbyPage({
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

      <h1>Seoul Saturday Dinner</h1>
      <p className="subtitle">
        Saturday, Oct 3 · 7:00 PM · Asia/Seoul · 6 participants
      </p>

      <div className="card">
        <h3>Participants</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Wallet</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td className="mono">{p.wallet}</td>
                <td>
                  {p.confirmed ? (
                    <span className="badge badge-green">Confirmed</span>
                  ) : p.submitted ? (
                    <span className="badge badge-yellow">
                      Awaiting confirmation
                    </span>
                  ) : (
                    <span className="badge badge-blue">Not submitted</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Next steps</h3>
        <p className="muted mb-4">
          All six participants have confirmed their preferences. Proceed to
          evaluation.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href="/group/demo-001/preferences" className="btn">
            My preferences
          </Link>
          <Link href="/group/demo-001/results" className="btn btn-primary">
            View results
          </Link>
        </div>
      </div>
    </div>
  );
}
