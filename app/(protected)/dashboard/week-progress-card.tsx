"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Discipline = {
  key: "bike" | "run" | "swim" | "strength";
  label: string;
  plannedMinutes: number;
  completedMinutes: number;
  color: string;
};

type WeekProgressCardProps = {
  plannedTotalMinutes: number;
  completedTotalMinutes: number;
  extraTotalMinutes?: number;
  disciplines: Array<Discipline & { extraMinutes?: number }>;
  showStatusChip?: boolean;
  compact?: boolean;
  className?: string;
  defaultExpanded?: boolean;
};

function formatMinutes(minutes: number) {
  return `${Math.max(0, Math.round(minutes))}m`;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function WeekProgressCard({
  plannedTotalMinutes,
  completedTotalMinutes,
  extraTotalMinutes = 0,
  disciplines,
  showStatusChip = true,
  compact = false,
  className,
  defaultExpanded = !compact
}: WeekProgressCardProps) {
  const [hideEmpty, setHideEmpty] = useState(true);
  const [workFilter, setWorkFilter] = useState<"all" | "planned" | "unscheduled">("all");
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const remainingMinutes = plannedTotalMinutes - completedTotalMinutes;
  const overMinutes = Math.max(completedTotalMinutes - plannedTotalMinutes, 0);

  const disciplineRows = useMemo(
    () =>
      disciplines.map((discipline) => {
        const visibleCompletedMinutes = workFilter === "planned" ? discipline.completedMinutes : workFilter === "unscheduled" ? discipline.extraMinutes ?? 0 : discipline.completedMinutes + (discipline.extraMinutes ?? 0);
        const visiblePlannedMinutes = workFilter === "unscheduled" ? 0 : discipline.plannedMinutes;
        const discPercent = visiblePlannedMinutes > 0 ? visibleCompletedMinutes / visiblePlannedMinutes : 0;
        const discPercentCapped = Math.min(discPercent, 1);
        const discOverMinutes = Math.max(visibleCompletedMinutes - visiblePlannedMinutes, 0);
        const discGapMinutes = Math.max(visiblePlannedMinutes - visibleCompletedMinutes, 0);

        return {
          ...discipline,
          visibleCompletedMinutes,
          visiblePlannedMinutes,
          discPercentCapped,
          discOverMinutes,
          discGapMinutes
        };
      }),
    [disciplines, workFilter]
  );

  const emptyCount = disciplineRows.filter((item) => item.visiblePlannedMinutes === 0 && (item.extraMinutes ?? 0) === 0).length;
  const visibleDisciplines = hideEmpty ? disciplineRows.filter((item) => item.visiblePlannedMinutes > 0 || (item.extraMinutes ?? 0) > 0) : disciplineRows;
  const biggestGap = [...disciplineRows].sort((a, b) => b.discGapMinutes - a.discGapMinutes)[0];
  const focusDisciplineKey = biggestGap && biggestGap.discGapMinutes > 0 ? biggestGap.key : null;
  const completedDisciplineCount = disciplineRows.filter((item) => item.visiblePlannedMinutes > 0 && item.discGapMinutes === 0).length;
  const activeDisciplineCount = disciplineRows.filter((item) => item.visiblePlannedMinutes > 0 || (item.extraMinutes ?? 0) > 0).length;

  const chipLabel = remainingMinutes > 0 ? "Behind plan" : remainingMinutes === 0 ? "On target" : "Ahead of plan";

  return (
    <article className={`surface min-w-0 ${compact ? "p-3.5" : "p-6"} ${className ?? ""}`}>
      <div className="flex items-center justify-between">
        <h2 className={`${compact ? "text-sm" : "text-lg"} font-semibold`}>Week Progress</h2>
        {showStatusChip ? (
          <span className={`inline-flex h-fit items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${overMinutes > 0 ? "signal-chip signal-load" : "border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]"}`}>
            {overMinutes > 0 ? <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--signal-load))]" /> : null}
            <span>{chipLabel}</span>
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-0.5 text-xs">
            {(["all", "planned", "unscheduled"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setWorkFilter(option)}
                className={`rounded-full px-2.5 py-1 ${workFilter === option ? "bg-[hsl(var(--bg-card))] text-[hsl(var(--fg))]" : "text-muted"}`}
              >
                {option === "all" ? "All" : option === "planned" ? "Planned only" : "Unscheduled only"}
              </button>
            ))}
          </div>
          <p className="text-xs text-[hsl(var(--fg-muted))]">Extra work: {formatMinutes(extraTotalMinutes)}</p>
        </div>

        {!isExpanded ? (
          <div className="space-y-3 rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface-2)/0.35)] p-3">
            {biggestGap && biggestGap.discGapMinutes > 0 ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-[hsl(var(--border)/0.48)] bg-[hsl(var(--bg-card))] px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="h-6 w-1 rounded-full bg-[hsl(var(--accent-performance))]" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[hsl(var(--fg))]">Focus: {biggestGap.label}</p>
                    <p className="text-[11px] text-[hsl(var(--fg-muted))]">{Math.round(biggestGap.visibleCompletedMinutes)} / {Math.round(biggestGap.visiblePlannedMinutes)} min</p>
                  </div>
                </div>
                <span className="signal-load inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium">
                  Gap {formatMinutes(biggestGap.discGapMinutes)}
                </span>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-[hsl(var(--border)/0.55)] bg-[hsl(var(--bg-card)/0.45)] px-3 py-2">
                <p className="text-xs font-medium text-[hsl(var(--fg))]">No sessions yet</p>
                <Link href="/calendar" className="mt-1 inline-block text-xs text-[hsl(var(--fg-muted))] underline underline-offset-2 hover:text-[hsl(var(--fg))]">
                  Open calendar
                </Link>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-[hsl(var(--fg-muted))]">
              <span>Completed: {completedDisciplineCount}</span>
              <span className="inline-flex rounded-full border border-[hsl(var(--border))] px-2 py-0.5">Active disciplines: {activeDisciplineCount}</span>
            </div>

            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="text-xs text-[hsl(var(--fg-muted))] underline underline-offset-2 hover:text-[hsl(var(--fg))]"
              aria-expanded={false}
              aria-controls="week-progress-breakdown"
            >
              View full breakdown
            </button>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">By discipline</p>
              {emptyCount > 0 || !hideEmpty ? (
                <button
                  type="button"
                  onClick={() => setHideEmpty((current) => !current)}
                  className="text-xs text-[hsl(var(--fg-muted))] underline-offset-2 hover:text-[hsl(var(--fg))] hover:underline"
                  aria-pressed={!hideEmpty}
                >
                  {hideEmpty ? `Show empty (+${emptyCount})` : "Hide empty"}
                </button>
              ) : null}
            </div>

            <div id="week-progress-breakdown">
              {visibleDisciplines.length === 0 ? (
                <p className="text-xs text-[hsl(var(--fg-muted))]">No sessions match this filter yet. Uploaded unscheduled sessions still count as extra work.</p>
              ) : (
                <div className="space-y-3">
                  {visibleDisciplines.map((item) => {
                    const disciplineChipLabel = item.discGapMinutes > 0 ? `Gap ${formatMinutes(item.discGapMinutes)}` : item.discOverMinutes > 0 ? `+${formatMinutes(item.discOverMinutes)}` : null;
                    const overTailWidthPx = item.visiblePlannedMinutes > 0
                      ? clamp(Math.round((item.discOverMinutes / item.visiblePlannedMinutes) * 120), 6, 24)
                      : 0;
                    const barAriaLabel = item.discOverMinutes > 0
                      ? `${item.label} ${Math.round(item.visibleCompletedMinutes)} of ${Math.round(item.visiblePlannedMinutes)} minutes, over ${Math.round(item.discOverMinutes)} minutes`
                      : `${item.label} ${Math.round(item.visibleCompletedMinutes)} of ${Math.round(item.visiblePlannedMinutes)} minutes, gap ${Math.round(item.discGapMinutes)} minutes`;
                    const isFocusDiscipline = item.key === focusDisciplineKey;
                    const isCompletedDiscipline = item.visiblePlannedMinutes > 0 && item.discGapMinutes === 0 && item.discOverMinutes === 0;

                    return (
                      <div key={item.key} className="rounded-lg px-2 py-1 transition hover:bg-[hsl(var(--bg-card))]">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${isFocusDiscipline ? "bg-[hsl(var(--accent-performance))]" : "bg-[hsl(var(--fg-muted)/0.45)]"}`} aria-hidden />
                            <span className="font-medium text-[hsl(var(--fg))]">{item.label}</span>
                          </div>
                          <div className="ml-auto flex items-center justify-end gap-2">
                            <div className="w-[96px] text-right text-xs text-[hsl(var(--fg))] tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>
                              {Math.round(item.visibleCompletedMinutes)} / {Math.round(item.visiblePlannedMinutes)} min
                            </div>
                            {disciplineChipLabel ? (
                              <span className={`inline-flex h-5 items-center rounded-full border px-2.5 text-xs font-medium ${item.discGapMinutes > 0 ? "signal-load" : "signal-risk"}`}>
                                {disciplineChipLabel}
                              </span>
                            ) : isCompletedDiscipline ? (
                              <span className="inline-flex h-5 items-center gap-1 rounded-full border border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.08)] px-2 text-[11px] font-medium text-[hsl(var(--fg-muted))]">
                                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success)/0.62)]" />
                                Complete
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="progress-track relative mt-1 h-2 overflow-hidden rounded-full bg-[hsl(var(--surface-2))]" aria-label={barAriaLabel} role="img">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${item.discPercentCapped * 100}%`,
                              background: isFocusDiscipline ? "hsl(var(--accent-performance))" : "hsl(var(--fg-muted) / 0.42)"
                            }}
                          />
                          {item.discOverMinutes > 0 ? (
                            <div
                              className="absolute inset-y-0 right-0 rounded-r-full bg-[hsl(var(--warning))]"
                              style={{
                                width: `${overTailWidthPx}px`,
                                opacity: 0.72
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {compact ? (
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="mt-3 text-xs text-[hsl(var(--fg-muted))] underline underline-offset-2 hover:text-[hsl(var(--fg))]"
                aria-expanded
                aria-controls="week-progress-breakdown"
              >
                Collapse summary
              </button>
            ) : null}
          </>
        )}
      </div>

      <a href="#coach-focus" className="mt-4 inline-block text-xs text-[hsl(var(--fg-muted))] underline-offset-2 hover:text-[hsl(var(--fg))] hover:underline">
        {biggestGap && biggestGap.discGapMinutes > 0
          ? `Focus: ${biggestGap.label} +${formatMinutes(biggestGap.discGapMinutes)} (tap for why)`
          : "Focus: On track (tap for details)"}
      </a>
    </article>
  );
}
