import Link from "next/link";

type ProgressGlanceCardProps = {
  completionPct: number;
  completedTimeLabel: string;
  plannedTimeLabel: string;
  remainingTimeLabel: string;
  statusLabel: "Ahead" | "On track" | "Behind plan";
  unmatchedExtraCount: number;
  missedPlannedCount: number;
};

export function ProgressGlanceCard({
  completionPct,
  completedTimeLabel,
  plannedTimeLabel,
  remainingTimeLabel,
  statusLabel,
  unmatchedExtraCount,
  missedPlannedCount
}: ProgressGlanceCardProps) {
  const ringPct = Math.max(0, Math.min(completionPct, 100));
  const statusClassName = statusLabel === "Ahead"
    ? "signal-ready"
    : statusLabel === "On track"
      ? "border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]"
      : "signal-load";

  return (
    <Link href="#week-progress-details" className="block">
      <article className="surface p-4 transition hover:border-[hsl(var(--fg)/0.22)]">
        <div className="flex items-center gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(hsl(var(--signal-recovery) / 0.76) ${ringPct * 3.6}deg, hsl(var(--surface-2)) 0deg)`
              }}
            />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--surface-1))] text-xs font-semibold">
              {ringPct}%
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[hsl(var(--fg))]">{completedTimeLabel} / {plannedTimeLabel}</p>
            <p className="text-xs text-muted">{remainingTimeLabel} remaining • {unmatchedExtraCount} extra sessions (additive) • {missedPlannedCount} missed planned</p>
          </div>

          <div className="text-right">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClassName}`}>
              {statusLabel}
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
