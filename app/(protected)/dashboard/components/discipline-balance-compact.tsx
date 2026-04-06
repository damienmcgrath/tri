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
  swim: "var(--color-swim, hsl(200, 80%, 60%))",
  bike: "var(--color-bike, hsl(45, 90%, 55%))",
  run: "var(--color-run, hsl(150, 60%, 50%))",
};

function getDeltaColor(deltaPp: number): string {
  const abs = Math.abs(deltaPp);
  if (abs <= 3) return "text-success";
  if (abs <= 7) return "text-[hsl(35,90%,55%)]";
  return "text-danger";
}

export function DisciplineBalanceCompact({ balance, imbalances }: Props) {
  const { actual, planned, totalActualTss, totalPlannedTss } = balance;
  const sports = ["swim", "bike", "run"].filter(
    (s) => actual[s] || planned[s]
  );

  if (sports.length === 0) return null;

  return (
    <article className="surface p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">Discipline balance</p>

      <div className="mt-3 space-y-2">
        {sports.map((sport) => {
          const actualTss = actual[sport]?.tss ?? 0;
          const plannedTss = planned[sport]?.tss ?? 0;
          const actualPct = totalActualTss > 0 ? Math.round((actualTss / totalActualTss) * 100) : 0;
          const plannedPct = totalPlannedTss > 0 ? Math.round((plannedTss / totalPlannedTss) * 100) : 0;
          const deltaPp = actualPct - plannedPct;

          return (
            <div key={sport} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: SPORT_COLORS[sport] }}
                />
                <span className="w-10 text-xs text-muted">{SPORT_LABELS[sport] ?? sport}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-white">{actualPct}%</span>
                {totalPlannedTss > 0 ? (
                  <>
                    <span className="text-[11px] text-tertiary">of {plannedPct}%</span>
                    <span className={`w-10 text-right text-xs font-medium ${getDeltaColor(deltaPp)}`}>
                      {deltaPp > 0 ? "+" : ""}{deltaPp}%
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {imbalances.length > 0 ? (
        <div className="mt-3 border-t border-[rgba(255,255,255,0.08)] pt-2">
          <Link href="/plan" className="text-[11px] text-cyan-400 hover:text-cyan-300">
            Rebalancing recommendation available →
          </Link>
        </div>
      ) : null}
    </article>
  );
}
