import Link from "next/link";

export default function ExecutionPage({
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

      <h1>Execution</h1>
      <p className="subtitle">
        The contract enforces the approved policy. The agent cannot spend
        outside it.
      </p>

      <div className="card">
        <h3>Decision status</h3>
        <p className="mt-2">
          <span className="badge badge-green">Active</span>
        </p>
        <table className="mt-4">
          <tbody>
            <tr>
              <td className="muted">Total contributed</td>
              <td>60.000000 Mock USDC</td>
            </tr>
            <tr>
              <td className="muted">Spent</td>
              <td>0.000000 Mock USDC</td>
            </tr>
            <tr>
              <td className="muted">Remaining</td>
              <td>60.000000 Mock USDC</td>
            </tr>
            <tr>
              <td className="muted">Refund per person</td>
              <td>2.500000 Mock USDC (after payment)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Payment attempts</h3>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Recipient</th>
              <th>Amount</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>2026-09-28 21:30</td>
              <td>Restaurant A</td>
              <td>80.000000</td>
              <td>
                <span className="badge badge-red">MAX_DEPOSIT_EXCEEDED</span>
              </td>
            </tr>
            <tr>
              <td>2026-09-28 21:31</td>
              <td>Restaurant A</td>
              <td>45.000000</td>
              <td>
                <span className="badge badge-green">Success</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted mt-2">
          Invalid attempt was a deliberate test of the spending ceiling.
        </p>
      </div>

      <div className="card">
        <h3>Refunds</h3>
        <p className="muted mb-2">
          After payment, 15.000000 Mock USDC remains. Each participant can claim
          2.500000 Mock USDC.
        </p>
        <button className="btn">Claim my refund</button>
      </div>
    </div>
  );
}
