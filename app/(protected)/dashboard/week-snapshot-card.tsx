import Link from "next/link";
import { WeekStrip } from "./week-strip";

type WeekSnapshotCardProps = {
  completionPct: number;
  completedTimeLabel: string;
  plannedTimeLabel: string;
  remainingTimeLabel: string;
  missedPlannedCount: number;
  unmatchedExtraCount: number;
  remainingSessionCount: number;
  weekStartIso: string;
  weekStripDays: Array<{
    dateIso: string;
    label: string;
    plannedCount: number;
    completedCount: number;
    state: "rest" | "planned" | "completed" | "in_progress" | "missed";
    isToday: boolean;
  }>;
};

export function WeekSnapshotCard({
  completionPct,
  completedTimeLabel,
  plannedTimeLabel,
  remainingTimeLabel,
  missedPlannedCount,
  unmatchedExtraCount,
  remainingSessionCount,
  weekStartIso,
  weekStripDays
}: WeekSnapshotCardProps) {
  const ringPct = Math.max(0, Math.min(completionPct, 100));

  return (
    <article className="surface p-5 md:p-6">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--fg-muted))]">Week snapshot</p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-end gap-2">
            <p className="text-3xl font-semibold leading-none text-[hsl(var(--fg))]">{ringPct}%</p>
            <p className="pb-0.5 text-sm text-[hsl(var(--fg-muted))]">complete</p>
          </div>
          <p className="mt-1 text-sm font-semibold text-[hsl(var(--fg))]">{completedTimeLabel} / {plannedTimeLabel}</p>
          <p className="mt-1 text-xs text-[hsl(var(--fg-muted))]">Remaining sessions: {remainingSessionCount}</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 text-[11px]">
          <span className="inline-flex items-center rounded-full border border-[hsl(var(--border)/0.9)] bg-[hsl(var(--surface-2)/0.58)] px-2 py-0.5 text-[hsl(var(--fg-muted))]">
            Remaining: {remainingTimeLabel}
          </span>
          <span className="signal-load inline-flex items-center rounded-full border px-2 py-0.5 font-semibold text-[hsl(var(--warning))]">
            Missed: {missedPlannedCount}
          </span>
          <span className="inline-flex items-center rounded-full border border-[hsl(var(--border)/0.9)] bg-[hsl(var(--surface-2)/0.58)] px-2 py-0.5 text-[hsl(var(--fg-muted))]">
            Extras: {unmatchedExtraCount}
          </span>
        </div>
      </div>

      <WeekStrip weekStartIso={weekStartIso} days={weekStripDays} />

      <div className="mt-4">
        <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">Open calendar</Link>
      </div>
    </article>
  );
}
