"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  sessions: Array<SessionPillSession & { week_id: string; date: string; day_order?: number | null }>;
  todayIso: string;
  adaptationsBySession: Record<string, boolean>;
  completedByWeek?: Record<string, Array<{ duration_minutes: number }>>;
  onSelectSession?: (sessionId: string) => void;
  onSessionContextMenu?: (sessionId: string, x: number, y: number) => void;
  onEmptyCellClick?: (weekId: string, date: string) => void;
  onEmptyCellContextMenu?: (weekId: string, date: string, x: number, y: number) => void;
};

const LONG_PRESS_MS = 500;
const LONG_PRESS_TOLERANCE_PX = 8;

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const longDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

function formatRange(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${longDateFormatter.format(start)} – ${longDateFormatter.format(end)}`;
}

function isCurrentWeek(weekStart: string, todayIso: string) {
  const end = addDays(weekStart, 6);
  return weekStart <= todayIso && todayIso <= end;
}

function findCurrentWeekIndex(weeks: Week[], todayIso: string) {
  const idx = weeks.findIndex((week) => isCurrentWeek(week.week_start_date, todayIso));
  if (idx >= 0) return idx;
  return 0;
}

export function MobilePlanView({
  weeks,
  sessions,
  todayIso,
  adaptationsBySession,
  completedByWeek,
  onSelectSession,
  onSessionContextMenu,
  onEmptyCellClick,
  onEmptyCellContextMenu
}: Props) {
  const sortedWeeks = useMemo(
    () => [...weeks].sort((a, b) => a.week_index - b.week_index),
    [weeks]
  );

  const [activeIdx, setActiveIdx] = useState(() => findCurrentWeekIndex(sortedWeeks, todayIso));

  // Re-center on the current week when the underlying block changes (different
  // weeks array). Keeps phone navigation in sync with the active block.
  useEffect(() => {
    setActiveIdx(findCurrentWeekIndex(sortedWeeks, todayIso));
  }, [sortedWeeks, todayIso]);

  if (sortedWeeks.length === 0) {
    return (
      <div className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-6 text-center text-sm text-tertiary">
        No weeks in this block yet.
      </div>
    );
  }

  const safeIdx = Math.min(Math.max(activeIdx, 0), sortedWeeks.length - 1);
  const week = sortedWeeks[safeIdx];
  const weekSessions = sessions.filter((s) => s.week_id === week.id);
  const sessionsByDay = new Map<string, SessionPillSession[]>();
  for (const session of weekSessions) {
    const list = sessionsByDay.get(session.date) ?? [];
    list.push(session);
    sessionsByDay.set(session.date, list);
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

  const isCurrent = isCurrentWeek(week.week_start_date, todayIso);
  const canGoPrev = safeIdx > 0;
  const canGoNext = safeIdx < sortedWeeks.length - 1;

  return (
    <div className="flex flex-col gap-3">
      <nav
        aria-label="Week navigation"
        className="flex items-center justify-between gap-2 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-2 py-2"
      >
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => canGoPrev && setActiveIdx(safeIdx - 1)}
          disabled={!canGoPrev}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-sm text-[rgba(255,255,255,0.7)] disabled:opacity-30"
        >
          ‹
        </button>
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-white">
              Wk {week.week_index} of {sortedWeeks.length}
            </span>
            {isCurrent ? (
              <span className="font-mono text-[9px] uppercase tracking-wide text-[rgba(190,255,0,0.85)]">
                ★ NOW
              </span>
            ) : null}
          </div>
          <span className="text-[10px] text-tertiary">{formatRange(week.week_start_date)}</span>
        </div>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => canGoNext && setActiveIdx(safeIdx + 1)}
          disabled={!canGoNext}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-sm text-[rgba(255,255,255,0.7)] disabled:opacity-30"
        >
          ›
        </button>
      </nav>

      <ul className="flex flex-col divide-y divide-[rgba(255,255,255,0.06)] rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]">
        {DAYS_OF_WEEK.map((label, dayIdx) => {
          const dayIso = addDays(week.week_start_date, dayIdx);
          const dayPills = sessionsByDay.get(dayIso) ?? [];
          const isToday = dayIso === todayIso;
          return (
            <li
              key={dayIso}
              className={`flex gap-3 px-3 py-2 ${
                isToday ? "bg-[rgba(190,255,0,0.04)]" : ""
              }`}
            >
              <div className="w-12 shrink-0">
                <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary">
                  {label}
                </div>
                <div
                  className={`font-mono text-[11px] tabular-nums ${
                    isToday ? "text-[rgba(190,255,0,0.85)]" : "text-[rgba(255,255,255,0.55)]"
                  }`}
                >
                  {dayIso.slice(8, 10)}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                {dayPills.length > 0 ? (
                  dayPills.map((session) => (
                    <SessionPill
                      key={session.id}
                      session={session}
                      hasAdaptation={adaptationsBySession[session.id] === true}
                      onSelect={onSelectSession}
                      onContextMenu={onSessionContextMenu}
                    />
                  ))
                ) : onEmptyCellClick ? (
                  <EmptyDayAddButton
                    weekId={week.id}
                    date={dayIso}
                    onClick={onEmptyCellClick}
                    onContextMenu={onEmptyCellContextMenu}
                  />
                ) : (
                  <div className="text-[10px] text-tertiary">—</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]">
        <div className="border-b border-[rgba(255,255,255,0.06)] px-3 py-1.5 text-[10px] uppercase tracking-wide text-tertiary">
          Week total
        </div>
        <WeeklyTotalCell
          sessions={weekSessions}
          weekStartDate={week.week_start_date}
          completedSessions={completedByWeek?.[week.id]}
        />
      </div>
    </div>
  );
}

function EmptyDayAddButton({
  weekId,
  date,
  onClick,
  onContextMenu
}: {
  weekId: string;
  date: string;
  onClick: (weekId: string, date: string) => void;
  onContextMenu?: (weekId: string, date: string, x: number, y: number) => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOrigin.current = null;
  }

  function handleClick() {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onClick(weekId, date);
  }

  function handleContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
    if (!onContextMenu) return;
    event.preventDefault();
    onContextMenu(weekId, date, event.clientX, event.clientY);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    longPressFired.current = false;
    if (event.pointerType !== "touch" || !onContextMenu) return;
    longPressOrigin.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onContextMenu(weekId, date, event.clientX, event.clientY);
      longPressTimer.current = null;
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!longPressOrigin.current) return;
    const dx = event.clientX - longPressOrigin.current.x;
    const dy = event.clientY - longPressOrigin.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_TOLERANCE_PX) clearLongPress();
  }

  return (
    <button
      type="button"
      aria-label="Add session"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
      className="rounded-sm border border-dashed border-[rgba(255,255,255,0.12)] py-1.5 text-[10px] uppercase tracking-wide text-tertiary"
    >
      + Add
    </button>
  );
}
