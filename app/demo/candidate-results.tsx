import type { publicEvaluation } from "../../src/lib/decision-engine";
import { scorePercent } from "../../src/lib/group-view";

export function DemoCandidateResults({
  result,
}: {
  result: ReturnType<typeof publicEvaluation>;
}) {
  if (result.candidates.length === 0) return null;
  const candidates = [...result.candidates].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return result.ranking.indexOf(a.id) - result.ranking.indexOf(b.id);
  });
  return (
    <section className="explore-section">
      <h2>Compare demo candidates</h2>
      <p className="explore-disclosure">
        Sample restaurants evaluated against this demo session's confirmed
        conditions. Personal requirements and rejection details stay private.
      </p>
      <div
        className="review-table-scroll"
        tabIndex={0}
        aria-label="Demo candidate comparison"
      >
        <table className="review-table">
          <caption>Current demo evaluation</caption>
          <thead>
            <tr>
              <th scope="col">Candidate</th>
              <th scope="col">Score / 100</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.id}>
                <th scope="row">{candidate.id}</th>
                <td>
                  {candidate.scoreMicros === null
                    ? "—"
                    : scorePercent(candidate.scoreMicros)}
                </td>
                <td>
                  {candidate.id === result.winnerId
                    ? "Recommended"
                    : candidate.eligible
                      ? "Eligible"
                      : "Does not meet group requirements"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.status === "NO_MATCH" && (
        <p>
          No candidate meets all requirements. Revise your preferences to try
          again.
        </p>
      )}
    </section>
  );
}
