import { AlertTriangle, Info, CircleAlert } from "lucide-react";
import type { PublicDiagnostic } from "../../src/lib/diagnostics/types";

export function DiagnosticsList({
  diagnostics,
}: {
  diagnostics: PublicDiagnostic[];
}) {
  if (!diagnostics.length) return null;
  return (
    <section
      className="group-diagnostics"
      aria-label="Group guidance"
      aria-live="polite"
    >
      <ul>
        {diagnostics.map((item) => {
          const Icon =
            item.severity === "error"
              ? CircleAlert
              : item.severity === "warning"
                ? AlertTriangle
                : Info;
          return (
            <li
              key={item.code}
              className={`group-diagnostic group-diagnostic-${item.severity}`}
            >
              <Icon size={18} aria-hidden="true" />
              <div>
                <strong>
                  {item.severity === "error"
                    ? "Action needed"
                    : item.severity === "warning"
                      ? "Attention"
                      : "Next step"}
                  : {item.title}
                </strong>
                <p>{item.guidance}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
