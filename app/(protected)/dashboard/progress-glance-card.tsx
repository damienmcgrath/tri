import Link from "next/link";

type ProgressGlanceCardProps = {
  weekRangeLabel: string;
  completionPct: number;
  completedTimeLabel: string;
  plannedTimeLabel: string;
  remainingTimeLabel: string;
  statusLabel: "Ahead" | "On track" | "Behind plan";
  unmatchedExtraCount: number;
  missedPlannedCount: number;
};

export function ProgressGlanceCard({
  weekRangeLabel,
  completionPct,
  completedTimeLabel,
  plannedTimeLabel,
  remainingTimeLabel,
  statusLabel,
  unmatchedExtraCount,
  missedPlannedCount
}: ProgressGlanceCardProps) {
  const ringPct = Math.max(0, Math.min(completionPct, 100));

  return (
    <Link href="#week-progress-details" className="block">
      <article className="performance-lab-panel p-4 transition hover:border-[hsl(var(--lab-line-strong))]">
        <div className="flex items-center gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--lab-line))] bg-[hsl(var(--lab-panel-muted))]">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(hsl(var(--lab-live) / 0.76) ${ringPct * 3.6}deg, hsl(var(--lab-panel)) 0deg)`
              }}
            />
            <div className="performance-lab-reading relative flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--lab-panel))] text-xs font-semibold">
              {ringPct}%
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="performance-lab-kicker">{weekRangeLabel}</p>
            <p className="text-sm font-semibold text-[hsl(var(--fg))]">{completedTimeLabel} / {plannedTimeLabel}</p>
            <p className="text-xs text-[hsl(var(--fg-muted))]">{remainingTimeLabel} remaining • {unmatchedExtraCount} extra sessions (additive) • {missedPlannedCount} missed planned</p>
          </div>

          <div className="text-right">
            <span className={`performance-lab-chip ${statusLabel === "Ahead" ? "performance-lab-chip-positive" : statusLabel === "On track" ? "performance-lab-chip-live" : "performance-lab-chip-warning"}`}>
              {statusLabel}
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
