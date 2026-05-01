"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays } from "@/lib/date-utils";
import { SessionPill, type SessionPillSession } from "./session-pill";
import { WeeklyTotalCell } from "./weekly-total-cell";

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
  /**
   * When a deep link or in-app navigation opens a session drawer
   * (`?session=<id>`), the phone view anchors on the week that contains
   * that session so the pill stays visible behind the bottom sheet.
   * Without this, every load defaults to the current week even when the
   * deep-linked session lives in another week of the same block.
   */
  openSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onSessionContextMenu?: (sessionId: string, x: number, y: number) => void;
  onEmptyCellClick?: (weekId: string, date: string) => void;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const dayDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

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

/**
 * Phone-only single-week vertical view of the active block. Renders one row
 * per day with stacked SessionPills, plus prev/next week navigation within
 * the current block and the weekly total at the bottom.
 *
 * Used at viewports ≤640px; the desktop grid in BlockGrid handles ≥641px.
 */
export function PhoneWeekView({
  weeks,
  sessions,
  todayIso,
  adaptationsBySession,
  completedByWeek,
  openSessionId,
  onSelectSession,
  onSessionContextMenu,
  onEmptyCellClick
}: Props) {
  const sortedWeeks = useMemo(
    () => [...weeks].sort((a, b) => a.week_index - b.week_index),
    [weeks]
  );

  // Resolve the week of the currently open (deep-linked) session, if any.
  // This is the highest-priority anchor so /plan?session=<id> scrolls the
  // phone view to the correct week instead of defaulting to "today".
  const openSessionWeekIndex = useMemo(() => {
    if (!openSessionId) return -1;
    const target = (sessions as Array<{ id: string; week_id?: string }>).find(
      (s) => s.id === openSessionId
    );
    if (!target?.week_id) return -1;
    return sortedWeeks.findIndex((w) => w.id === target.week_id);
  }, [openSessionId, sessions, sortedWeeks]);

  // Default to the open session's week, then the current week, then the first
  // week. The state is purely phone-local — desktop keeps all weeks visible.
  const defaultIndex = useMemo(() => {
    if (openSessionWeekIndex >= 0) return openSessionWeekIndex;
    const idx = sortedWeeks.findIndex((w) => isCurrentWeek(w.week_start_date, todayIso));
    return idx >= 0 ? idx : 0;
  }, [openSessionWeekIndex, sortedWeeks, todayIso]);

  const [activeIndex, setActiveIndex] = useState(defaultIndex);

  // Keep activeIndex in range when the underlying weeks list changes (e.g. the
  // user switches blocks) and re-anchor on the default whenever the
  // deep-linked session id changes (so navigating to a session in another week
  // of the same block snaps the phone view to the right week).
  useEffect(() => {
    if (openSessionWeekIndex >= 0 && openSessionWeekIndex !== activeIndex) {
      setActiveIndex(openSessionWeekIndex);
      return;
    }
    if (activeIndex < 0 || activeIndex >= sortedWeeks.length) {
      setActiveIndex(defaultIndex);
    }
  }, [sortedWeeks.length, activeIndex, defaultIndex, openSessionWeekIndex]);

  if (sortedWeeks.length === 0) {
    return (
      <div className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-6 text-center text-sm text-tertiary">
        No weeks in this block yet.
      </div>
    );
  }

  const week = sortedWeeks[Math.min(Math.max(activeIndex, 0), sortedWeeks.length - 1)];
  const isCurrent = isCurrentWeek(week.week_start_date, todayIso);

  const sessionsByDay = new Map<string, SessionPillSession[]>();
  for (const session of sessions) {
    const weekId = (session as { week_id?: string }).week_id;
    const date = (session as { date?: string }).date;
    if (weekId !== week.id || !date) continue;
    if (!sessionsByDay.has(date)) sessionsByDay.set(date, []);
    sessionsByDay.get(date)!.push(session);
  }
  for (const list of sessionsByDay.values()) {
    list.sort((a, b) => {
      const aOrder = (a as { day_order?: number | null }).day_order;
      const bOrder = (b as { day_order?: number | null }).day_order;
      const aHas = typeof aOrder === "number";
      const bHas = typeof bOrder === "number";
      if (aHas && bHas) return (aOrder as number) - (bOrder as number);
      if (aHas) return -1;
      if (bHas) return 1;
      return 0;
    });
  }
  const allWeekSessions = [...sessionsByDay.values()].flat();

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < sortedWeeks.length - 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
        <button
          type="button"
          onClick={() => canPrev && setActiveIndex(activeIndex - 1)}
          disabled={!canPrev}
          aria-label="Previous week"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(255,255,255,0.08)] text-tertiary disabled:opacity-30"
        >
          ‹
        </button>
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold text-white">Wk {week.week_index}</span>
            {isCurrent ? (
              <span className="font-mono text-[9px] uppercase tracking-wide text-[rgba(190,255,0,0.85)]">★ NOW</span>
            ) : null}
          </div>
          <span className="text-[10px] text-tertiary">{formatRange(week.week_start_date)}</span>
        </div>
        <button
          type="button"
          onClick={() => canNext && setActiveIndex(activeIndex + 1)}
          disabled={!canNext}
          aria-label="Next week"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(255,255,255,0.08)] text-tertiary disabled:opacity-30"
        >
          ›
        </button>
      </div>

      <ul className="flex flex-col gap-1.5">
        {Array.from({ length: 7 }).map((_, dayIdx) => {
          const dayIso = addDays(week.week_start_date, dayIdx);
          const dayDate = new Date(`${dayIso}T00:00:00.000Z`);
          const cellSessions = sessionsByDay.get(dayIso) ?? [];
          const isToday = dayIso === todayIso;

          return (
            <li
              key={dayIso}
              className={`rounded-md border px-3 py-2 ${
                isToday
                  ? "border-[rgba(190,255,0,0.35)] bg-[rgba(190,255,0,0.04)]"
                  : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]"
              }`}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-white">
                  {DAY_LABELS[dayIdx]}
                </span>
                <span className="text-[10px] text-tertiary">{dayDateFormatter.format(dayDate)}</span>
              </div>
              {cellSessions.length === 0 ? (
                onEmptyCellClick ? (
                  <button
                    type="button"
                    onClick={() => onEmptyCellClick(week.id, dayIso)}
                    className="w-full rounded-md border border-dashed border-[rgba(255,255,255,0.1)] px-2 py-2 text-left text-[11px] uppercase tracking-wide text-tertiary"
                  >
                    + Add session
                  </button>
                ) : (
                  <p className="text-[11px] text-tertiary">Rest day</p>
                )
              ) : (
                <div className="flex flex-col gap-1">
                  {cellSessions.map((session) => (
                    <SessionPill
                      key={session.id}
                      session={session}
                      hasAdaptation={adaptationsBySession[session.id] === true}
                      onSelect={onSelectSession}
                      onContextMenu={onSessionContextMenu}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <WeeklyTotalCell
        sessions={allWeekSessions}
        weekStartDate={week.week_start_date}
        completedSessions={completedByWeek?.[week.id]}
      />
    </div>
  );
}
