"use client";

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
  disciplines: Discipline[];
};

function toHoursAndMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours}h ${mins}m`;
}

function formatMinutes(minutes: number) {
  return `${Math.max(0, Math.round(minutes))}m`;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function WeekProgressCard({
  plannedTotalMinutes,
  completedTotalMinutes,
  disciplines
}: WeekProgressCardProps) {
  const [hideEmpty, setHideEmpty] = useState(true);

  const remainingMinutes = plannedTotalMinutes - completedTotalMinutes;
  const percentComplete = plannedTotalMinutes > 0 ? completedTotalMinutes / plannedTotalMinutes : 0;
  const percentCapped = Math.min(percentComplete, 1);
  const overMinutes = Math.max(completedTotalMinutes - plannedTotalMinutes, 0);
  const percentLabel = `${Math.round(percentCapped * 100)}%`;
  const hasNoPlannedSessions = plannedTotalMinutes === 0;

  const disciplineRows = useMemo(
    () =>
      disciplines.map((discipline) => {
        const discPercent = discipline.plannedMinutes > 0 ? discipline.completedMinutes / discipline.plannedMinutes : 0;
        const discPercentCapped = Math.min(discPercent, 1);
        const discOverMinutes = Math.max(discipline.completedMinutes - discipline.plannedMinutes, 0);
        const discGapMinutes = Math.max(discipline.plannedMinutes - discipline.completedMinutes, 0);

        return {
          ...discipline,
          discPercentCapped,
          discOverMinutes,
          discGapMinutes
        };
      }),
    [disciplines]
  );

  const emptyCount = disciplineRows.filter((item) => item.plannedMinutes === 0).length;
  const visibleDisciplines = hideEmpty ? disciplineRows.filter((item) => item.plannedMinutes > 0) : disciplineRows;
  const biggestGap = [...disciplineRows].sort((a, b) => b.discGapMinutes - a.discGapMinutes)[0];

  const chipLabel =
    remainingMinutes > 0 ? `${formatMinutes(remainingMinutes)} left` : remainingMinutes === 0 ? "On target" : `+${formatMinutes(Math.abs(remainingMinutes))} over`;

  return (
    <article className="surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Week Progress</h2>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-center">
        <div
          className="relative flex h-20 w-20 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"
          aria-label={`Overall progress ${Math.round(completedTotalMinutes)} of ${Math.round(plannedTotalMinutes)} minutes, ${Math.round(percentCapped * 100)}%`}
          role="img"
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(hsl(204 88% 62% / 0.62) ${percentCapped * 360}deg, hsl(var(--border) / 0.9) 0deg)`
            }}
          />
          <div className="relative flex h-[62px] w-[62px] flex-col items-center justify-center rounded-full bg-[hsl(var(--bg-elevated))] text-center">
            <span className="text-lg font-semibold leading-none">{percentLabel}</span>
          </div>
        </div>

        <div>
          <p className="text-3xl font-bold leading-tight text-[hsl(var(--fg))]">{hasNoPlannedSessions ? "No planned sessions" : toHoursAndMinutes(completedTotalMinutes)}</p>
          <p className="text-sm text-muted">{hasNoPlannedSessions ? "Schedule sessions to start tracking progress." : `of ${toHoursAndMinutes(plannedTotalMinutes)} planned`}</p>
        </div>

        <span className={`inline-flex h-fit items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${overMinutes > 0 ? "border-amber-400/40 bg-amber-500/10" : "border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"}`}>
          {overMinutes > 0 ? <span aria-hidden className="h-2 w-2 rounded-full bg-amber-300" /> : null}
          <span>{chipLabel}</span>
        </span>
      </div>


      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">By discipline</p>
          {emptyCount > 0 || !hideEmpty ? (
            <button
              type="button"
              onClick={() => setHideEmpty((current) => !current)}
              className="text-xs text-muted underline-offset-2 hover:text-[hsl(var(--fg))] hover:underline"
              aria-pressed={!hideEmpty}
            >
              {hideEmpty ? `Show empty (+${emptyCount})` : "Hide empty"}
            </button>
          ) : null}
        </div>

        {visibleDisciplines.length === 0 ? (
          <p className="text-xs text-muted">No planned minutes.</p>
        ) : (
          <div className="space-y-3">
            {visibleDisciplines.map((item) => {
              const chipLabel = item.discGapMinutes > 0 ? `Gap ${formatMinutes(item.discGapMinutes)}` : item.discOverMinutes > 0 ? `+${formatMinutes(item.discOverMinutes)}` : null;
              const overTailWidthPx = item.plannedMinutes > 0
                ? clamp(Math.round((item.discOverMinutes / item.plannedMinutes) * 120), 6, 24)
                : 0;
              const barAriaLabel = item.discOverMinutes > 0
                ? `${item.label} ${Math.round(item.completedMinutes)} of ${Math.round(item.plannedMinutes)} minutes, over ${Math.round(item.discOverMinutes)} minutes`
                : `${item.label} ${Math.round(item.completedMinutes)} of ${Math.round(item.plannedMinutes)} minutes, gap ${Math.round(item.discGapMinutes)} minutes`;

              return (
                <div key={item.key} className="rounded-lg px-2 py-1 transition hover:bg-[hsl(var(--bg-card))]">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                      <span className="font-medium text-[hsl(var(--fg))]">{item.label}</span>
                    </div>
                    <div className="ml-auto flex items-center justify-end gap-2">
                      <div className="w-[96px] text-right text-xs text-muted tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {Math.round(item.completedMinutes)} / {Math.round(item.plannedMinutes)} min
                      </div>
                      {chipLabel ? (
                        <span className="inline-flex h-5 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-2.5 text-xs font-medium text-muted">
                          {chipLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-[hsl(var(--bg-card))]" aria-label={barAriaLabel} role="img">
                    <div className="h-full rounded-full" style={{ width: `${item.discPercentCapped * 100}%`, backgroundColor: item.color }} />
                    {item.discOverMinutes > 0 ? (
                      <div
                        className="absolute inset-y-0 right-0 rounded-r-full"
                        style={{
                          width: `${overTailWidthPx}px`,
                          backgroundColor: item.color,
                          opacity: 0.6,
                          backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.22) 0px, rgba(255,255,255,0.22) 6px, rgba(255,255,255,0.05) 6px, rgba(255,255,255,0.05) 12px)"
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

      <a href="#coach-focus" className="mt-4 inline-block text-xs text-muted underline-offset-2 hover:text-[hsl(var(--fg))] hover:underline">
        {biggestGap && biggestGap.discGapMinutes > 0
          ? `Focus: ${biggestGap.label} +${formatMinutes(biggestGap.discGapMinutes)} (tap for why)`
          : "Focus: On track (tap for details)"}
      </a>
    </article>
  );
}
