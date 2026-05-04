"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays } from "@/lib/date-utils";

export type SessionPillContextMenuAction =
  | { type: "duplicate-next-day" }
  | { type: "move-to"; date: string; weekId: string }
  | { type: "toggle-key" }
  | { type: "convert-to-rest" }
  | { type: "delete" };

type WeekDay = {
  date: string;
  weekId: string;
  label: string;
  isCurrent: boolean;
};

type Props = {
  x: number;
  y: number;
  isKey: boolean;
  /** Days within the source week, used to populate the "Move to ▸" submenu. */
  weekDays: WeekDay[];
  onSelect: (action: SessionPillContextMenuAction) => void;
  onClose: () => void;
};

const MENU_WIDTH = 200;
const SUBMENU_WIDTH = 160;
const MENU_HEIGHT = 200;

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

export function formatMoveToLabel(date: string) {
  return dayFormatter.format(new Date(`${date}T00:00:00.000Z`));
}

export function buildWeekDays(weekStart: string, weekId: string, sourceDate: string): WeekDay[] {
  return Array.from({ length: 7 }, (_, idx) => {
    const date = addDays(weekStart, idx);
    return {
      date,
      weekId,
      label: formatMoveToLabel(date),
      isCurrent: date === sourceDate
    };
  });
}

function clampPosition(x: number, y: number, width: number) {
  if (typeof window === "undefined") return { left: x, top: y };
  const left = Math.min(Math.max(x, 4), window.innerWidth - width - 4);
  const top = Math.min(Math.max(y, 4), window.innerHeight - MENU_HEIGHT - 4);
  return { left, top };
}

export function SessionPillContextMenu({
  x,
  y,
  isKey,
  weekDays,
  onSelect,
  onClose
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  // When the parent menu is clamped near the right edge of the viewport, the
  // submenu's default `left-full` position pushes it off-screen. Flip it to
  // open leftwards (`right-full`) when there isn't room on the right.
  const [submenuFlipped, setSubmenuFlipped] = useState(false);

  const items = useMemo(() => {
    const list: Array<{
      key: string;
      label: string;
      onClick: () => void;
      isMoveTo?: boolean;
    }> = [
      {
        key: "duplicate",
        label: "Duplicate to next day",
        onClick: () => onSelect({ type: "duplicate-next-day" })
      },
      {
        key: "move",
        label: "Move to ▸",
        isMoveTo: true,
        onClick: () => setSubmenuOpen((value) => !value)
      },
      {
        key: "toggle-key",
        label: isKey ? "Unmark as Key" : "Mark as Key",
        onClick: () => onSelect({ type: "toggle-key" })
      },
      {
        key: "convert-rest",
        label: "Convert to Rest",
        onClick: () => onSelect({ type: "convert-to-rest" })
      },
      {
        key: "delete",
        label: "Delete",
        onClick: () => onSelect({ type: "delete" })
      }
    ];
    return list;
  }, [isKey, onSelect]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    function handlePointer(event: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (submenuOpen) {
          setSubmenuOpen(false);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose, submenuOpen]);

  const { left, top } = clampPosition(x, y, MENU_WIDTH);

  useEffect(() => {
    if (!submenuOpen) return;
    if (typeof window === "undefined") return;
    const rightEdge = left + MENU_WIDTH + SUBMENU_WIDTH + 8;
    setSubmenuFlipped(rightEdge > window.innerWidth - 4);
  }, [submenuOpen, left]);

  function focusItem(index: number) {
    const next = (index + items.length) % items.length;
    itemRefs.current[next]?.focus();
  }

  function handleItemKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === "ArrowRight" && items[index].isMoveTo) {
      event.preventDefault();
      setSubmenuOpen(true);
    } else if (event.key === "ArrowLeft" && submenuOpen) {
      event.preventDefault();
      setSubmenuOpen(false);
    }
  }

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Session actions"
      style={{ left, top, width: MENU_WIDTH }}
      className="fixed z-50 overflow-visible rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(20,20,20,0.98)] py-1 text-xs shadow-lg"
    >
      {items.map((item, index) => (
        <div key={item.key} className="relative">
          <button
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="menuitem"
            aria-haspopup={item.isMoveTo ? "menu" : undefined}
            aria-expanded={item.isMoveTo ? submenuOpen : undefined}
            onKeyDown={(event) => handleItemKey(event, index)}
            onClick={item.onClick}
            onMouseEnter={() => {
              if (item.isMoveTo) setSubmenuOpen(true);
              else if (submenuOpen) setSubmenuOpen(false);
            }}
            className="block w-full px-3 py-1.5 text-left text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-white focus:bg-[rgba(255,255,255,0.08)] focus:text-white focus:outline-none"
          >
            {item.label}
          </button>
          {item.isMoveTo && submenuOpen ? (
            <div
              role="menu"
              aria-label="Move to day"
              data-flipped={submenuFlipped ? "true" : "false"}
              style={{ width: SUBMENU_WIDTH }}
              className={`absolute top-0 overflow-hidden rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(20,20,20,0.98)] py-1 shadow-lg ${
                submenuFlipped ? "right-full mr-1" : "left-full ml-1"
              }`}
            >
              {weekDays.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  role="menuitem"
                  disabled={day.isCurrent}
                  onClick={() =>
                    onSelect({ type: "move-to", date: day.date, weekId: day.weekId })
                  }
                  className="block w-full px-3 py-1.5 text-left text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-white focus:bg-[rgba(255,255,255,0.08)] focus:text-white focus:outline-none disabled:cursor-not-allowed disabled:text-tertiary disabled:hover:bg-transparent"
                >
                  {day.label}
                  {day.isCurrent ? " (current)" : ""}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
