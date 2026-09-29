import Link from "next/link";

export default function ApprovePage({
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

      <h1>Review & Approve</h1>
      <p className="subtitle">
        This policy is immutable. Changing any term requires a new decision and
        fresh approvals.
      </p>

      <div className="card">
        <h3>Spending Policy</h3>
        <table>
          <tbody>
            <tr>
              <td className="muted">Merchant</td>
              <td>Restaurant A</td>
            </tr>
            <tr>
              <td className="muted">Token</td>
              <td>Mock USDC (6 decimals)</td>
            </tr>
            <tr>
              <td className="muted">Chain ID</td>
              <td className="mono">11155111 (Sepolia)</td>
            </tr>
            <tr>
              <td className="muted">Your contribution</td>
              <td>10.000000 Mock USDC</td>
            </tr>
            <tr>
              <td className="muted">Exact payment</td>
              <td>45.000000 Mock USDC</td>
            </tr>
            <tr>
              <td className="muted">Max deposit</td>
              <td>60.000000 Mock USDC</td>
            </tr>
            <tr>
              <td className="muted">Max total spend</td>
              <td>60.000000 Mock USDC</td>
            </tr>
            <tr>
              <td className="muted">Approval threshold</td>
              <td>6 of 6 participants</td>
            </tr>
            <tr>
              <td className="muted">Expiry</td>
              <td>2026-10-04 19:00 KST</td>
            </tr>
            <tr>
              <td className="muted">Decision hash</td>
              <td className="mono">0x8f3a...2b1e</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Your contribution</h3>
        <p className="muted mb-2">
          Approving requires two wallet transactions: token allowance, then
          contribution.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn">1. Approve token allowance</button>
          <Link href="/group/demo-001/execution" className="btn btn-primary">
            2. Contribute 10 Mock USDC
          </Link>
        </div>
      </div>

      <div className="card">
        <h3>Approval progress</h3>
        <table>
          <thead>
            <tr>
              <th>Participant</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Alice", "Approved"],
              ["Bob", "Approved"],
              ["Charlie", "Approved"],
              ["Dana", "Approved"],
              ["Erin", "Approved"],
              ["You", "Pending"],
            ].map(([name, status]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>
                  {status === "Approved" ? (
                    <span className="badge badge-green">Approved</span>
                  ) : (
                    <span className="badge badge-yellow">Pending</span>
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
