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

/**
 * Derive a cross-discipline fatigue synthesis from the trend cards themselves when the
 * TSB-based `detectCrossDisciplineFatigue` hasn't fired. This catches the case where
 * performance metrics (pace, power) are declining together even before the
 * load-balance model shows TSB drift.
 */
function deriveTrendFatigueSynthesis(trends: WeeklyTrend[]): { sports: string[]; metrics: string[] } | null {
  // Only flag on output-metric declines (pace, power) — HR declining is ambiguous.
  const OUTPUT_METRICS = new Set(["Run pace", "Bike avg power", "Swim pace"]);
  const decliningOutputs = trends.filter(
    (t) => t.direction === "declining" && OUTPUT_METRICS.has(t.metric) && t.confidence !== "low"
  );
  const distinctSports = new Set(decliningOutputs.map((t) => METRIC_SPORT[t.metric] ?? t.sport));
  if (distinctSports.size < 2) return null;
  return {
    sports: Array.from(distinctSports),
    metrics: decliningOutputs.map((t) => t.metric)
  };
}

export function TrendCards({ trends, fatigueSignal }: { trends: WeeklyTrend[]; fatigueSignal?: FatigueSignal | null }) {
  if (trends.length === 0 && !fatigueSignal) return null;

  // Prefer the TSB-based signal when present; otherwise synthesize from trend directions.
  const derivedSynthesis = !fatigueSignal ? deriveTrendFatigueSynthesis(trends) : null;
  const synthesisSports = fatigueSignal?.sports ?? derivedSynthesis?.sports ?? null;
  const synthesisSeverity = fatigueSignal?.severity ?? "warning";

  return (
    <div className="space-y-3">
      {synthesisSports && synthesisSports.length >= 2 ? (
        <article
          className={`rounded-2xl border p-4 md:p-5 ${
            synthesisSeverity === "alert"
              ? "border-[hsl(var(--signal-risk))] bg-[hsl(var(--signal-risk)/0.08)]"
              : "border-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.08)]"
          }`}
          aria-label="Cross-discipline fatigue synthesis"
        >
          <p className="text-kicker font-medium text-white">
            Cross-discipline fatigue
          </p>
          <p className="mt-2 text-body text-white">
            {formatSports(synthesisSports)} are trending down together over the same window.
            This pattern typically indicates accumulated fatigue rather than
            discipline-specific weakness. Prioritize recovery this weekend and watch how
            your legs feel on the next long session.
          </p>
          {fatigueSignal?.detail ? (
            <p className="mt-2 text-ui-label text-muted">{fatigueSignal.detail}</p>
          ) : null}
        </article>
      ) : null}
      {trends.length > 0 ? (
        <article className="surface p-4 md:p-5">
          <p className="text-kicker text-tertiary">Recent trends</p>
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
                    <p className="text-ui-label text-muted">{trend.metric}</p>
                    <Sparkline values={values} color={color} width={80} height={24} />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-body font-semibold text-white">
                      {currentLabel}
                    </span>
                    <span className={`text-ui-label font-medium ${DIRECTION_CLASS[trend.direction]}`}>
                      {DIRECTION_ARROW[trend.direction]} {trend.direction}
                    </span>
                  </div>
                  <p className="mt-1 text-ui-label leading-snug text-muted">{trend.detail}</p>
                </div>
              );
            })}
          </div>
        </article>
      ) : null}
    </div>
  );
}
