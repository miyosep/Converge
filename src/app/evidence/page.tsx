import Link from "next/link";

export default function EvidencePage() {
  return (
    <div className="container">
      <nav className="nav">
        <span className="nav-brand">Converge</span>
        <div className="nav-links">
          <Link href="/">Groups</Link>
          <Link href="/evidence">Evidence</Link>
        </div>
      </nav>

      <h1>Evidence</h1>
      <p className="subtitle">
        Per-flow AI usage, chain records, and condition-change comparison.
      </p>

      <div className="card">
        <h3>Run: Baseline</h3>
        <table>
          <tbody>
            <tr>
              <td className="muted">Selected restaurant</td>
              <td>Restaurant A</td>
            </tr>
            <tr>
              <td className="muted">Payment</td>
              <td>45 Mock USDC to Restaurant A</td>
            </tr>
            <tr>
              <td className="muted">Invalid attempt</td>
              <td>80 Mock USDC rejected: MAX_DEPOSIT_EXCEEDED</td>
            </tr>
            <tr>
              <td className="muted">Refunds</td>
              <td>6 × 2.5 Mock USDC</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Kiln usage by flow</h3>
        <table>
          <thead>
            <tr>
              <th>Flow</th>
              <th>Calls</th>
              <th>Input tokens</th>
              <th>Output tokens</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>constraint_extraction</td>
              <td>6</td>
              <td>—</td>
              <td>—</td>
            </tr>
            <tr>
              <td>decision_explanation</td>
              <td>1</td>
              <td>—</td>
              <td>—</td>
            </tr>
            <tr>
              <td>candidate_analysis</td>
              <td>0</td>
              <td>—</td>
              <td>—</td>
            </tr>
            <tr>
              <td>clarification</td>
              <td>0</td>
              <td>—</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
        <p className="muted mt-2">
          Token counts pending live runs. Unknown values remain unknown rather
          than being reported as zero.
        </p>
      </div>

      <div className="card">
        <h3>Condition change runs</h3>
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Changed condition</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Baseline</td>
              <td>—</td>
              <td>Restaurant A</td>
            </tr>
            <tr>
              <td>Lower budget</td>
              <td>Alice max: $35 → $25</td>
              <td>Restaurant B</td>
            </tr>
            <tr>
              <td>Merchant excluded</td>
              <td>A removed from permitted set</td>
              <td>Restaurant B</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
