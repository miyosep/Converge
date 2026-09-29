import type { Constraint, Extraction } from "../../src/lib/schemas/constraints";

function describe(condition: Constraint): [string, string] {
  switch (condition.field) {
    case "budget_per_person_cents":
      return [
        "Budget per person",
        `Up to $${(condition.value / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
      ];
    case "quiet":
      return ["Atmosphere", "Somewhere quiet"];
    case "atmosphere":
      return ["Atmosphere", "The setting matters"];
    case "subway_proximity":
      return ["Getting there", "Close to the station"];
    case "subway_distance_meters":
      return [
        "From the station",
        `Within ${condition.value.toLocaleString("en-US")} m`,
      ];
    case "minimum_beds":
      return ["Beds", `At least ${condition.value}`];
    case "reservation_slot":
      return [
        "Date & time",
        new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: condition.value.timeZone,
        }).format(new Date(condition.value.startsAt)) +
          ` · ${condition.value.timeZone}`,
      ];
    case "shellfish_safe":
      return ["Dietary safety", "Shellfish-safe dining"];
    case "wheelchair_accessible":
      return ["Accessibility", "Wheelchair access"];
    case "dietary_requirement":
      return ["Dietary needs", condition.value.replaceAll("_", " ")];
    case "facility_requirement":
      return ["Facilities", condition.value.replaceAll("_", " ")];
  }
}

export function DemoPreferenceSummary({
  extraction,
}: {
  extraction: Extraction;
}) {
  return (
    <>
      <div className="demo-condition-grid">
        {extraction.constraints.map((condition, index) => {
          const [label, value] = describe(condition);
          return (
            <div className="demo-condition" key={index}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>
                {condition.type === "soft"
                  ? "Nice to have"
                  : condition.type === "non_negotiable"
                    ? "Must have"
                    : "Required"}
              </small>
            </div>
          );
        })}
      </div>
      {!extraction.constraints.length && (
        <p>No preferences captured yet. Update your request to try again.</p>
      )}
      {(extraction.clarifications.length > 0 ||
        extraction.unsupportedRequirements.length > 0) && (
        <div className="demo-clarifications" role="status">
          <h4>A little more detail</h4>
          <p>Update your preferences above, then review them again.</p>
          {extraction.clarifications.length > 0 && (
            <section>
              <strong>Please clarify</strong>
              <ul>
                {extraction.clarifications.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </section>
          )}
          {extraction.unsupportedRequirements.length > 0 && (
            <section>
              <strong>Not supported in this demo</strong>
              <ul>
                {extraction.unsupportedRequirements.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
