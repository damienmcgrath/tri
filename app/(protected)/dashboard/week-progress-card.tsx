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
  weekStartDate: string;
  weekEndDate: string;
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

function formatWeekRange(startIso: string, endIso: string) {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${formatter.format(new Date(`${startIso}T00:00:00.000Z`))}–${formatter.format(new Date(`${endIso}T00:00:00.000Z`))}`;
}

export function WeekProgressCard({
  weekStartDate,
  weekEndDate,
  plannedTotalMinutes,
  completedTotalMinutes,
  disciplines
}: WeekProgressCardProps) {
  const [showAll, setShowAll] = useState(false);

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

  const visibleDisciplines = showAll ? disciplineRows : disciplineRows.filter((item) => item.plannedMinutes > 0);
  const biggestGap = [...disciplineRows].sort((a, b) => b.discGapMinutes - a.discGapMinutes)[0];
  const biggestOver = [...disciplineRows].sort((a, b) => b.discOverMinutes - a.discOverMinutes)[0];

  const chipLabel =
    remainingMinutes > 0 ? `${formatMinutes(remainingMinutes)} left` : remainingMinutes === 0 ? "On target" : `+${formatMinutes(Math.abs(remainingMinutes))} over`;

  return (
    <article className="surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Week Progress</h2>
        <p className="text-xs text-muted">{formatWeekRange(weekStartDate, weekEndDate)}</p>
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
              background: `conic-gradient(hsl(var(--accent) / 0.45) ${percentCapped * 360}deg, hsl(var(--border)) 0deg)`
            }}
          />
          <div className="relative flex h-[68px] w-[68px] flex-col items-center justify-center rounded-full bg-[hsl(var(--bg-elevated))] text-center">
            <span className="text-xl font-semibold leading-none">{percentLabel}</span>
            <span className="mt-1 text-[10px] text-muted">complete</span>
          </div>
        </div>

        <div>
          <p className="text-4xl font-bold leading-tight text-[hsl(var(--fg))]">{hasNoPlannedSessions ? "No planned sessions" : toHoursAndMinutes(completedTotalMinutes)}</p>
          <p className="text-sm text-muted">{hasNoPlannedSessions ? "Schedule sessions to start tracking progress." : `of ${toHoursAndMinutes(plannedTotalMinutes)} planned`}</p>
        </div>

        <span className={`inline-flex h-fit items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${overMinutes > 0 ? "border-amber-400/40 bg-amber-500/10" : "border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"}`}>
          {overMinutes > 0 ? <span aria-hidden className="h-2 w-2 rounded-full bg-amber-300" /> : null}
          <span>{chipLabel}</span>
        </span>
      </div>

      <p className="mt-3 text-xs text-muted">{Math.round(completedTotalMinutes)} / {Math.round(plannedTotalMinutes)} min overall</p>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">By discipline</p>
          <button type="button" onClick={() => setShowAll((current) => !current)} className="text-xs text-muted underline-offset-2 hover:text-[hsl(var(--fg))] hover:underline">
            {showAll ? "Hide 0-min" : `Show all (${disciplineRows.length})`}
          </button>
        </div>

        {visibleDisciplines.length === 0 ? (
          <p className="text-xs text-muted">No planned minutes.</p>
        ) : (
          <div className="space-y-3">
            {visibleDisciplines.map((item) => {
              const helper = item.discGapMinutes > 0 ? `Gap: ${formatMinutes(item.discGapMinutes)}` : item.discOverMinutes > 0 ? `Over: +${formatMinutes(item.discOverMinutes)}` : "On target";

              return (
                <div key={item.key} className="rounded-lg px-2 py-1 transition hover:bg-[hsl(var(--bg-card))]">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                      <span className="font-medium">{item.label}</span>
                    </div>
                    <span className="text-xs text-muted">{Math.round(item.completedMinutes)} / {Math.round(item.plannedMinutes)} min</span>
                  </div>
                  <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-[hsl(var(--bg-card))]" aria-label={`${item.label} ${Math.round(item.completedMinutes)} of ${Math.round(item.plannedMinutes)} minutes, ${Math.round(item.discPercentCapped * 100)}%`} role="img">
                    <div className="h-full rounded-full" style={{ width: `${item.discPercentCapped * 100}%`, backgroundColor: item.color }} />
                    {item.discOverMinutes > 0 ? <div className="absolute right-0 top-0 h-full w-3 bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,hsla(0,0%,100%,0.3)_2px,hsla(0,0%,100%,0.3)_4px)]" /> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">{helper}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted">
        {biggestGap && biggestGap.discGapMinutes > 0 ? `Biggest gap: ${biggestGap.label} (${formatMinutes(biggestGap.discGapMinutes)})` : "Biggest gap: none"}
        {" • "}
        {biggestOver && biggestOver.discOverMinutes > 0 ? `Over: ${biggestOver.label} (+${formatMinutes(biggestOver.discOverMinutes)})` : "Over: none"}
      </p>
    </article>
  );
}
