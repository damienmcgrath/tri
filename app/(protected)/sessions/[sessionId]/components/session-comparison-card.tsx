import type { SessionComparison } from "@/lib/training/session-comparison";
import type { WeeklyTrend } from "@/lib/training/trends";
import type { StoredComparison } from "@/lib/training/session-comparison-engine";

const comparisonDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});

type Props = {
  comparison: SessionComparison;
  trends?: WeeklyTrend[];
  aiComparisons?: StoredComparison[];
};

function trendBadge(direction: string, confidence?: string) {
  const isLowConfidence = confidence === "low";
  if (direction === "improving") return {
    label: isLowConfidence ? "Possibly improving" : "Improving",
    className: isLowConfidence
      ? "border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.06)] text-tertiary"
      : "border-[rgba(52,211,153,0.3)] bg-[rgba(52,211,153,0.1)] text-success"
  };
  if (direction === "declining") return {
    label: isLowConfidence ? "Possible decline" : "Declining",
    className: isLowConfidence
      ? "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] text-tertiary"
      : "border-[rgba(255,90,40,0.3)] bg-[rgba(255,90,40,0.1)] text-danger"
  };
  return { label: "Stable", className: "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] text-tertiary" };
}

export function SessionComparisonCard({ comparison, trends = [], aiComparisons = [] }: Props) {
  const previousDateLabel = comparisonDateFormatter.format(new Date(`${comparison.previousDate}T00:00:00.000Z`));

  // Match trends to metrics in this comparison
  const matchedTrends = trends.filter((trend) =>
    comparison.metrics.some((m) =>
      m.metric.toLowerCase().includes(trend.metric.toLowerCase().split(" ").pop() ?? "")
    )
  );

  // Get best AI narrative (prefer recent range)
  const bestAiComparison = aiComparisons.find((c) => c.comparisonRange === "recent") ?? aiComparisons[0];

  return (
    <article className="surface p-5">
      <div>
        <div className="flex items-center gap-2.5">
          <p className="label">Compared to previous</p>
          {bestAiComparison ? (
            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em] leading-none ${trendBadge(bestAiComparison.trendDirection, bestAiComparison.trendConfidence).className}`}>
              {trendBadge(bestAiComparison.trendDirection, bestAiComparison.trendConfidence).label}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-tertiary">{previousDateLabel}</p>
      </div>

      {/* AI narrative */}
      {bestAiComparison ? (
        <p className="mt-3 text-sm text-white">{bestAiComparison.comparisonSummary}</p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {comparison.metrics.map((m) => (
          <div key={m.metric} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
            <p className="text-xs text-muted">{m.metric}</p>
            <p className="mt-1 text-base font-semibold text-white">{m.current}</p>
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
          <p className="mb-3 text-[10px] uppercase tracking-[0.08em] text-tertiary">Multi-week trend</p>
          <div className="space-y-2.5">
            {matchedTrends.map((trend) => (
              <div key={trend.metric} className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted whitespace-nowrap">{trend.metric}</span>
                <div className="flex items-center gap-1.5">
                  {trend.dataPoints.slice(-4).map((pt, idx) => {
                    const isLatest = idx === trend.dataPoints.slice(-4).length - 1;
                    return (
                      <span
                        key={pt.weekStart}
                        className={`rounded border px-2 py-1 text-xs tabular-nums ${
                          isLatest
                            ? "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.06)] text-white font-medium"
                            : "border-[hsl(var(--border))] text-tertiary"
                        }`}
                      >
                        {pt.label}
                      </span>
                    );
                  })}
                  <span className={`ml-0.5 text-sm font-medium ${trend.direction === "improving" ? "text-success" : trend.direction === "declining" ? "text-danger" : "text-tertiary"}`}>
                    {trend.direction === "improving" ? "▲" : trend.direction === "declining" ? "▼" : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
