import type { WeeklyTrend } from "@/lib/training/trends";
import { Sparkline } from "@/lib/ui/sparkline";

const METRIC_SPORT: Record<string, string> = {
  "Run avg HR": "run",
  "Run pace": "run",
  "Bike avg power": "bike",
  "Swim pace": "swim",
  "Strength duration": "strength"
};

const SPORT_COLOR: Record<string, string> = {
  run: "hsl(var(--run))",
  bike: "hsl(var(--bike))",
  swim: "hsl(var(--swim))",
  strength: "hsl(var(--strength))"
};

const DIRECTION_ARROW: Record<string, string> = {
  improving: "↑",
  declining: "↓",
  stable: "→"
};

const DIRECTION_CLASS: Record<string, string> = {
  improving: "text-[hsl(var(--success))]",
  declining: "text-[hsl(var(--signal-risk))]",
  stable: "text-muted"
};

export function TrendCards({ trends }: { trends: WeeklyTrend[] }) {
  if (trends.length === 0) return null;

  return (
    <article className="surface p-4 md:p-5">
      <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Recent trends</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {trends.map((trend) => {
          const sport = METRIC_SPORT[trend.metric] ?? "other";
          const color = SPORT_COLOR[sport] ?? "hsl(var(--accent))";
          const values = trend.dataPoints.map((d) => d.value);
          const currentLabel = trend.dataPoints[trend.dataPoints.length - 1]?.label ?? "";

          return (
            <div
              key={trend.metric}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted">{trend.metric}</p>
                <Sparkline values={values} color={color} width={80} height={24} />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-base font-semibold text-[hsl(var(--text-primary))]">
                  {currentLabel}
                </span>
                <span className={`text-xs font-medium ${DIRECTION_CLASS[trend.direction]}`}>
                  {DIRECTION_ARROW[trend.direction]} {trend.direction}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted">{trend.detail}</p>
            </div>
          );
        })}
      </div>
    </article>
  );
}
