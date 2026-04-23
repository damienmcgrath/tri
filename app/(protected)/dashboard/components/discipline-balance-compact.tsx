import type { WeeklyDisciplineBalance } from "@/lib/training/discipline-balance";
import Link from "next/link";

type Props = {
  balance: WeeklyDisciplineBalance;
};

const SPORT_LABELS: Record<string, string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run",
};

const SPORT_COLORS: Record<string, string> = {
  swim: "var(--color-swim)",
  bike: "var(--color-bike)",
  run: "var(--color-run)",
};

function formatHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

function formatDeltaPercent(actual: number, planned: number): string {
  if (planned <= 0) return "";
  const pct = Math.round(((actual - planned) / planned) * 100);
  if (pct === 0) return "on plan";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

function getDeltaClass(actual: number, planned: number): string {
  if (planned <= 0) return "text-tertiary";
  const pct = ((actual - planned) / planned) * 100;
  const abs = Math.abs(pct);
  if (abs <= 5) return "text-success";
  if (abs <= 15) return "text-warning";
  return "text-danger";
}

// F15 revised (Apr 22): pick the sport with the largest under-plan hours
// gap and render an actionable one-liner instead of a vague "see
// recommendation" link. The bar above already shows *that* something is
// off; this line tells the user *what to do*. Computed independently of
// `detectDisciplineImbalance` because that function uses TSS-share
// thresholds that miss small-absolute-but-clearly-short cases.
function buildRebalancingHint(
  balance: WeeklyDisciplineBalance
): { message: string } | null {
  type Gap = { sport: string; gapMinutes: number };
  const gaps: Gap[] = ["swim", "bike", "run"]
    .map((sport) => {
      const actualMins = balance.actual[sport]?.durationMinutes ?? 0;
      const plannedMins = balance.planned[sport]?.durationMinutes ?? 0;
      return { sport, gapMinutes: Math.max(plannedMins - actualMins, 0) };
    })
    .filter((g) => g.gapMinutes >= 30)
    .sort((a, b) => b.gapMinutes - a.gapMinutes);
  if (gaps.length === 0) return null;
  const worst = gaps[0];
  const sportLabel = SPORT_LABELS[worst.sport] ?? worst.sport;
  return {
    message: `${sportLabel} is running lowest — ${formatHours(worst.gapMinutes)} short of plan this week`
  };
}

export function DisciplineBalanceCompact({ balance }: Props) {
  const { actual, planned } = balance;
  const sports = ["swim", "bike", "run"].filter((s) => actual[s] || planned[s]);

  if (sports.length === 0) return null;

  const hint = buildRebalancingHint(balance);

  return (
    <article className="surface p-4">
      <p className="card-kicker">Discipline balance</p>

      <div className="mt-3 space-y-3">
        {sports.map((sport) => {
          const actualMins = actual[sport]?.durationMinutes ?? 0;
          const plannedMins = planned[sport]?.durationMinutes ?? 0;
          // F15: fill width reflects how close the user is to their plan for
          // *that* sport — short-on-plan reads as a visibly shorter fill.
          const completionPct =
            plannedMins > 0 ? Math.min(100, (actualMins / plannedMins) * 100) : 0;
          const delta = formatDeltaPercent(actualMins, plannedMins);
          const deltaClass = getDeltaClass(actualMins, plannedMins);
          const tooltip = plannedMins > 0
            ? `${SPORT_LABELS[sport] ?? sport}: ${formatHours(actualMins)} actual · ${formatHours(plannedMins)} planned`
            : `${SPORT_LABELS[sport] ?? sport}: ${formatHours(actualMins)} actual`;

          return (
            <div
              key={sport}
              className="grid grid-cols-[56px_1fr_auto] items-center gap-3"
              title={tooltip}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: SPORT_COLORS[sport] }}
                />
                <span className="text-ui-label text-muted">{SPORT_LABELS[sport] ?? sport}</span>
              </div>
              <div
                className="relative h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]"
                role="img"
                aria-label={tooltip}
              >
                <div
                  className="h-full rounded-full transition-ui"
                  style={{ width: `${completionPct}%`, backgroundColor: SPORT_COLORS[sport] }}
                />
              </div>
              <div className="flex items-baseline gap-1.5 tabular-nums">
                <span className="text-ui-label text-[rgba(255,255,255,0.78)]">
                  {formatHours(actualMins)}
                  <span className="text-tertiary">/{formatHours(plannedMins)}</span>
                </span>
                {delta ? (
                  <span className={`text-ui-label font-medium ${deltaClass}`}>{delta}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {hint ? (
        <Link
          href="/plan"
          className="mt-3 flex items-start gap-2 rounded-lg border border-[rgba(255,180,60,0.24)] bg-[rgba(255,180,60,0.06)] px-2.5 py-1.5 text-ui-label transition-ui hover:border-[rgba(255,180,60,0.45)] hover:bg-[rgba(255,180,60,0.12)]"
        >
          <span aria-hidden="true" className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" />
          <span className="flex-1 text-[rgba(255,255,255,0.88)]">{hint.message}</span>
          <span aria-hidden="true" className="shrink-0 text-[var(--color-warning)]">Rebalance →</span>
        </Link>
      ) : null}
    </article>
  );
}
