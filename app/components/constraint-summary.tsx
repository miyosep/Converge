import {
  extractionSchema,
  type Constraint,
} from "../../src/lib/schemas/constraints";

function valueLabel(condition: Constraint) {
  if (condition.field === "minimum_beds")
    return `At least ${condition.value} beds`;
  if (condition.type === "soft") return `Weight ${condition.weight}`;
  if (condition.field === "budget_per_person_cents")
    return `At most $${(condition.value / 100).toFixed(2)} per person`;
  if (condition.field === "subway_distance_meters")
    return `At most ${condition.value} m`;
  if (condition.field === "reservation_slot")
    return `${condition.value.startsAt} (${condition.value.timeZone})`;
  return condition.value === true
    ? "Required"
    : condition.value.replaceAll("_", " ");
}

export function ConstraintSummary({ value }: { value: unknown }) {
  const parsed = extractionSchema.safeParse(value);
  if (!parsed.success) return null;
  const extraction = parsed.data;
  return (
    <div>
      <div
        className="review-table-scroll"
        tabIndex={0}
        aria-label="Your extracted conditions"
      >
        <table className="review-table">
          <caption>Your extracted conditions</caption>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Condition</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {extraction.constraints.map((condition, index) => (
              <tr key={index}>
                <td>
                  {condition.type === "soft"
                    ? "Preference"
                    : condition.type === "hard"
                      ? "Requirement"
                      : "Non-negotiable"}
                </td>
                <td>{condition.field.replaceAll("_", " ")}</td>
                <td>{valueLabel(condition)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {extraction.constraints.length === 0 && (
        <p>No structured conditions were extracted.</p>
      )}
      {[
        ...extraction.clarifications,
        ...extraction.unsupportedRequirements,
      ].map((message, index) => (
        <p className="notice" key={index}>
          {message}
        </p>
      ))}
    </div>
  );
}
