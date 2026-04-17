import type { FatigueSignal } from "@/lib/training/fatigue-detection";
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
  improving: "text-success",
  declining: "text-[hsl(var(--signal-risk))]",
  stable: "text-muted"
};

const SPORT_LABEL: Record<string, string> = {
  run: "run",
  bike: "bike",
  swim: "swim"
};

function formatSports(sports: string[]): string {
  if (sports.length === 0) return "";
  if (sports.length === 1) return SPORT_LABEL[sports[0]] ?? sports[0];
  if (sports.length === 2) return `${SPORT_LABEL[sports[0]] ?? sports[0]} and ${SPORT_LABEL[sports[1]] ?? sports[1]}`;
  return `${sports.slice(0, -1).map((s) => SPORT_LABEL[s] ?? s).join(", ")}, and ${SPORT_LABEL[sports[sports.length - 1]] ?? sports[sports.length - 1]}`;
}

export function TrendCards({ trends, fatigueSignal }: { trends: WeeklyTrend[]; fatigueSignal?: FatigueSignal | null }) {
  if (trends.length === 0 && !fatigueSignal) return null;

  return (
    <article className="surface p-4 md:p-5">
      <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Recent trends</p>
      {fatigueSignal ? (
        <div
          className={`mt-3 rounded-xl border p-3 ${
            fatigueSignal.severity === "alert"
              ? "border-[hsl(var(--signal-risk))] bg-[hsl(var(--signal-risk)/0.08)]"
              : "border-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.08)]"
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white">
            Cross-discipline fatigue
          </p>
          <p className="mt-1 text-sm text-white">
            {formatSports(fatigueSignal.sports)} are both trending down over the same window — consider protecting this week&apos;s key session.
          </p>
          <p className="mt-1 text-[11px] text-muted">{fatigueSignal.detail}</p>
        </div>
      ) : null}
      {trends.length > 0 ? (
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
                <span className="text-base font-semibold text-white">
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
      ) : null}
    </article>
  );
}
