import type { SessionComparison } from "@/lib/training/session-comparison";
import type { WeeklyTrend } from "@/lib/training/trends";

const comparisonDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});

type Props = {
  comparison: SessionComparison;
  trends?: WeeklyTrend[];
};

export function SessionComparisonCard({ comparison, trends = [] }: Props) {
  const previousDateLabel = comparisonDateFormatter.format(new Date(`${comparison.previousDate}T00:00:00.000Z`));

  // Match trends to metrics in this comparison
  const matchedTrends = trends.filter((trend) =>
    comparison.metrics.some((m) =>
      m.metric.toLowerCase().includes(trend.metric.toLowerCase().split(" ").pop() ?? "")
    )
  );

  return (
    <article className="surface p-5">
      <p className="label">Compared to last time</p>
      <p className="mt-1 text-xs text-tertiary">{previousDateLabel}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {comparison.metrics.map((m) => (
          <div key={m.metric} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
            <p className="text-xs text-muted">{m.metric}</p>
            <p className="mt-1 text-base font-semibold text-bright">{m.current}</p>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`text-sm font-medium ${
                  m.direction === "better"
                    ? "text-success"
                    : m.direction === "worse"
                    ? "text-danger"
                    : "text-tertiary"
                }`}
              >
                {m.direction === "better" ? "▲ " : m.direction === "worse" ? "▼ " : ""}
                {m.delta}
              </span>
              <span className="text-xs text-tertiary">vs {m.previous}</span>
            </div>
          </div>
        ))}
      </div>

      {matchedTrends.length > 0 ? (
        <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
          <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-tertiary">Multi-week trend</p>
          {matchedTrends.map((trend) => (
            <div key={trend.metric} className="flex items-start justify-between gap-3 text-xs">
              <span className="text-muted">{trend.metric}</span>
              <div className="flex items-center gap-2">
                <span className="flex gap-1">
                  {trend.dataPoints.slice(-4).map((pt) => (
                    <span key={pt.weekStart} className="rounded border border-[hsl(var(--border))] px-1.5 py-0.5 text-[10px] text-tertiary">{pt.label}</span>
                  ))}
                </span>
                <span className={`font-medium ${trend.direction === "improving" ? "text-success" : trend.direction === "declining" ? "text-danger" : "text-tertiary"}`}>
                  {trend.direction === "improving" ? "▲" : trend.direction === "declining" ? "▼" : "—"}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
