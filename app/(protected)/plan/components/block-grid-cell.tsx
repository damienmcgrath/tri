"use client";

import { useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SessionPill, type SessionPillSession } from "./session-pill";
import { makeDroppableId } from "./use-block-grid-dnd";

type EmptyAffordance = {
  weekId: string;
  date: string;
  onClick: (weekId: string, date: string) => void;
  onContextMenu: (weekId: string, date: string, x: number, y: number) => void;
};

type DroppableConfig = {
  weekId: string;
  date: string;
  blockId: string;
};

type Props = {
  sessions: SessionPillSession[];
  isToday?: boolean;
  adaptationsBySession?: Record<string, boolean>;
  onSelectSession?: (sessionId: string) => void;
  onSessionContextMenu?: (sessionId: string, x: number, y: number) => void;
  emptyAffordance?: EmptyAffordance;
  /**
   * When provided, the cell registers a drop target via @dnd-kit. The pill
   * draggable inside this cell is configured with the same week/date so
   * onDragEnd in the parent can short-circuit drops onto the source cell.
   */
  droppable?: DroppableConfig;
};

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

export function BlockGridCell({
  sessions,
  isToday,
  adaptationsBySession,
  onSelectSession,
  onSessionContextMenu,
  emptyAffordance,
  droppable
}: Props) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: droppable ? makeDroppableId(droppable.weekId, droppable.date) : "__noop__",
    data: droppable ?? undefined,
    disabled: !droppable
  });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  const isEmpty = sessions.length === 0;
  const showAffordance = isEmpty && Boolean(emptyAffordance);

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOrigin.current = null;
  }

  function handleClick() {
    if (!showAffordance) return;
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    emptyAffordance!.onClick(emptyAffordance!.weekId, emptyAffordance!.date);
  }

  function handleContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
    if (!showAffordance) return;
    event.preventDefault();
    emptyAffordance!.onContextMenu(
      emptyAffordance!.weekId,
      emptyAffordance!.date,
      event.clientX,
      event.clientY
    );
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!showAffordance) return;
    // Reset any stale suppression from a previous long-press before starting
    // a fresh gesture. Some mobile browsers won't emit a click after the
    // context-menu gesture, so the next tap must start cleanly.
    longPressFired.current = false;
    if (event.pointerType !== "touch") return;
    longPressOrigin.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      emptyAffordance!.onContextMenu(
        emptyAffordance!.weekId,
        emptyAffordance!.date,
        event.clientX,
        event.clientY
      );
      longPressTimer.current = null;
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!longPressOrigin.current) return;
    const dx = event.clientX - longPressOrigin.current.x;
    const dy = event.clientY - longPressOrigin.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) clearLongPress();
  }

  return (
    <div
      ref={setDropRef}
      data-over={droppable && isOver ? "true" : undefined}
      className={`relative flex min-h-[52px] flex-col gap-1 border-l border-[rgba(255,255,255,0.04)] px-1.5 py-1 ${
        isToday ? "bg-[rgba(190,255,0,0.04)]" : ""
      } ${
        droppable && isOver
          ? "ring-1 ring-inset ring-[rgba(190,255,0,0.55)] bg-[rgba(190,255,0,0.06)]"
          : ""
      }`}
    >
      {isToday ? (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-[rgba(190,255,0,0.85)]"
        />
      ) : null}
      {sessions.map((session) => (
        <SessionPill
          key={session.id}
          session={session}
          hasAdaptation={adaptationsBySession?.[session.id] === true}
          onSelect={onSelectSession}
          onContextMenu={onSessionContextMenu}
          draggable={
            droppable
              ? {
                  blockId: droppable.blockId,
                  sourceWeekId: droppable.weekId,
                  sourceDate: droppable.date
                }
              : undefined
          }
        />
      ))}
      {showAffordance ? (
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
          className="group absolute inset-0 flex items-center justify-center rounded-sm border border-dashed border-transparent text-[10px] font-medium uppercase tracking-wide text-transparent hover:border-[rgba(255,255,255,0.25)] hover:text-tertiary focus-visible:border-[rgba(255,255,255,0.25)] focus-visible:text-tertiary focus-visible:outline-none"
        >
          + Add
        </button>
      ) : null}
    </div>
  );
}
