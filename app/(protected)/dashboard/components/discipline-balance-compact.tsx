import type { WeeklyDisciplineBalance, DisciplineImbalance } from "@/lib/training/discipline-balance";
import Link from "next/link";

type Props = {
  balance: WeeklyDisciplineBalance;
  imbalances: DisciplineImbalance[];
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

function getDeltaColor(deltaPp: number): string {
  const abs = Math.abs(deltaPp);
  if (abs <= 3) return "text-success";
  if (abs <= 7) return "text-warning";
  return "text-danger";
}

function formatDelta(deltaPp: number): string {
  if (deltaPp === 0) return "on plan";
  const sign = deltaPp > 0 ? "+" : "";
  return `${sign}${deltaPp}% vs plan`;
}

export function DisciplineBalanceCompact({ balance, imbalances }: Props) {
  const { actual, planned, totalActualTss, totalPlannedTss } = balance;
  const sports = ["swim", "bike", "run"].filter((s) => actual[s] || planned[s]);

  if (sports.length === 0) return null;

  return (
    <article className="surface p-4">
      <p className="card-kicker">Discipline balance</p>

      <div className="mt-3 space-y-2.5">
        {sports.map((sport) => {
          const actualTss = actual[sport]?.tss ?? 0;
          const plannedTss = planned[sport]?.tss ?? 0;
          const actualPct = totalActualTss > 0 ? Math.round((actualTss / totalActualTss) * 100) : 0;
          const plannedPct = totalPlannedTss > 0 ? Math.round((plannedTss / totalPlannedTss) * 100) : 0;
          const deltaPp = actualPct - plannedPct;
          const tooltip =
            totalPlannedTss > 0
              ? `${SPORT_LABELS[sport] ?? sport}: ${actualPct}% actual vs ${plannedPct}% planned`
              : `${SPORT_LABELS[sport] ?? sport}: ${actualPct}% actual`;

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
                <span className="text-xs text-muted">{SPORT_LABELS[sport] ?? sport}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                <div
                  className="h-full rounded-full transition-ui"
                  style={{ width: `${actualPct}%`, backgroundColor: SPORT_COLORS[sport] }}
                />
              </div>
              {totalPlannedTss > 0 ? (
                <span className={`text-right text-[11px] font-medium tabular-nums ${getDeltaColor(deltaPp)}`}>
                  {formatDelta(deltaPp)}
                </span>
              ) : (
                <span className="text-right text-[11px] font-medium tabular-nums text-tertiary">
                  {actualPct}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {imbalances.length > 0 ? (
        <Link href="/plan" className="mt-3 inline-flex text-[11px] text-tertiary transition hover:text-white">
          Rebalancing recommendation available →
        </Link>
      ) : null}
    </article>
  );
}
