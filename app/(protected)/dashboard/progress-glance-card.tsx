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
  compact?: boolean;
};

export function ProgressGlanceCard({
  weekRangeLabel,
  completionPct,
  completedTimeLabel,
  plannedTimeLabel,
  remainingTimeLabel,
  statusLabel,
  unmatchedExtraCount,
  missedPlannedCount,
  compact = false
}: ProgressGlanceCardProps) {
  const ringPct = Math.max(0, Math.min(completionPct, 100));
  const statusClassName = statusLabel === "Ahead"
    ? "signal-ready"
    : statusLabel === "On track"
      ? "border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]"
      : "signal-load";

  return (
    <Link href="#week-progress-details" className="block">
      <article className={`surface transition hover:border-[hsl(var(--fg)/0.22)] ${compact ? "p-2.5" : "p-4"}`}>
        <div className={`flex items-start ${compact ? "gap-2.5" : "gap-4"}`}>
          <div className={`relative flex shrink-0 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] ${compact ? "h-10 w-10" : "h-14 w-14"}`}>
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(hsl(var(--signal-recovery) / 0.76) ${ringPct * 3.6}deg, hsl(var(--surface-2)) 0deg)`
              }}
            />
            <div className={`relative flex items-center justify-center rounded-full bg-[hsl(var(--surface-1))] font-semibold ${compact ? "h-6.5 w-6.5 text-[10px]" : "h-10 w-10 text-xs"}`}>
              {ringPct}%
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className={`${compact ? "text-[10px]" : "text-[11px]"} uppercase tracking-[0.12em] text-[hsl(var(--fg-muted))]`}>{weekRangeLabel}</p>
            <p className={`${compact ? "mt-0.5 text-xs" : "text-sm"} font-semibold text-[hsl(var(--fg))]`}>{completedTimeLabel} / {plannedTimeLabel}</p>
            <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
              <span className="signal-load inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-[hsl(var(--warning))]">Missed: {missedPlannedCount}</span>
              <span className="inline-flex items-center rounded-full border border-[hsl(var(--border)/0.9)] bg-[hsl(var(--surface-2)/0.58)] px-2 py-0.5 text-[hsl(var(--fg-muted))]">Extras: {unmatchedExtraCount}</span>
              <span className="inline-flex items-center rounded-full border border-[hsl(var(--border)/0.9)] bg-[hsl(var(--surface-2)/0.58)] px-2 py-0.5 text-[hsl(var(--fg-muted))]">Remaining: {remainingTimeLabel}</span>
            </div>
          </div>

          <div className="text-right">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClassName}`}>
              {statusLabel}
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
