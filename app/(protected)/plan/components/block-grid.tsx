"use client";

import { useMemo } from "react";
import { addDays } from "@/lib/date-utils";
import { BlockGridCell } from "./block-grid-cell";
import { WeeklyTotalCell } from "./weekly-total-cell";
import type { SessionPillSession } from "./session-pill";

type Week = {
  id: string;
  week_index: number;
  week_start_date: string;
  block_id: string | null;
};

type Props = {
  weeks: Week[];
  sessions: SessionPillSession[] & Array<SessionPillSession & { week_id: string; date: string; day_order?: number | null }>;
  todayIso: string;
  adaptationsBySession: Record<string, boolean>;
  completedByWeek?: Record<string, Array<{ duration_minutes: number }>>;
};

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const weekRangeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

function formatRange(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${weekRangeFormatter.format(start)} – ${weekRangeFormatter.format(end)}`;
}

function isCurrentWeek(weekStart: string, todayIso: string) {
  const end = addDays(weekStart, 6);
  return weekStart <= todayIso && todayIso <= end;
}

export function BlockGrid({ weeks, sessions, todayIso, adaptationsBySession, completedByWeek }: Props) {
  const sortedWeeks = useMemo(
    () => [...weeks].sort((a, b) => a.week_index - b.week_index),
    [weeks]
  );

  const sessionsByWeekAndDay = useMemo(() => {
    const map = new Map<string, Map<string, SessionPillSession[]>>();
    for (const session of sessions) {
      const weekId = (session as { week_id?: string }).week_id ?? "";
      const date = (session as { date?: string }).date ?? "";
      if (!weekId || !date) continue;
      if (!map.has(weekId)) map.set(weekId, new Map());
      const weekMap = map.get(weekId)!;
      if (!weekMap.has(date)) weekMap.set(date, []);
      weekMap.get(date)!.push(session);
    }
    return map;
  }, [sessions]);

  if (sortedWeeks.length === 0) {
    return (
      <div className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-6 text-center text-sm text-tertiary">
        No weeks in this block yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[860px] text-xs"
        style={{ gridTemplateColumns: "100px repeat(7, minmax(96px, 1fr)) 130px" }}
        role="grid"
      >
        <div className="border-b border-[rgba(255,255,255,0.1)] px-2 py-2 text-[10px] uppercase tracking-wide text-tertiary">
          Week
        </div>
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day}
            className="border-b border-[rgba(255,255,255,0.1)] px-2 py-2 text-[10px] uppercase tracking-wide text-tertiary"
          >
            {day}
          </div>
        ))}
        <div className="border-b border-[rgba(255,255,255,0.1)] px-2 py-2 text-right text-[10px] uppercase tracking-wide text-tertiary">
          Total
        </div>

        {sortedWeeks.map((week) => {
          const isCurrent = isCurrentWeek(week.week_start_date, todayIso);
          const isPast = !isCurrent && addDays(week.week_start_date, 6) < todayIso;
          const dayCellsClass = isPast ? "opacity-60" : "";
          const weekSessions = sessionsByWeekAndDay.get(week.id) ?? new Map<string, SessionPillSession[]>();
          const allWeekSessions: SessionPillSession[] = [];
          for (const list of weekSessions.values()) allWeekSessions.push(...list);

          return (
            <div
              key={week.id}
              role="row"
              className={`contents ${
                isCurrent ? "[&>*]:border-y-[1px] [&>*]:border-y-[rgba(190,255,0,0.25)]" : ""
              }`}
            >
              <div className="flex flex-col justify-center border-b border-[rgba(255,255,255,0.06)] px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-white">Wk {week.week_index}</span>
                  {isCurrent ? (
                    <span className="font-mono text-[9px] uppercase tracking-wide text-[rgba(190,255,0,0.85)]">
                      ★ NOW
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] text-tertiary">{formatRange(week.week_start_date)}</span>
              </div>

              {Array.from({ length: 7 }).map((_, dayIdx) => {
                const dayIso = addDays(week.week_start_date, dayIdx);
                const cellSessions = weekSessions.get(dayIso) ?? [];
                const isToday = dayIso === todayIso;
                return (
                  <div
                    key={`${week.id}-${dayIdx}`}
                    className={`border-b border-[rgba(255,255,255,0.06)] ${dayCellsClass}`}
                  >
                    <BlockGridCell
                      sessions={cellSessions}
                      isToday={isToday}
                      adaptationsBySession={adaptationsBySession}
                    />
                  </div>
                );
              })}

              <div className="border-b border-[rgba(255,255,255,0.06)]">
                <WeeklyTotalCell
                  sessions={allWeekSessions}
                  weekStartDate={week.week_start_date}
                  completedSessions={completedByWeek?.[week.id]}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
