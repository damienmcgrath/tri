"use client";

import { useEffect, useRef } from "react";

export type CellContextMenuAction = "add" | "rest";

type Props = {
  x: number;
  y: number;
  onSelect: (action: CellContextMenuAction) => void;
  onClose: () => void;
};

const ITEMS: ReadonlyArray<{ action: CellContextMenuAction; label: string }> = [
  { action: "add", label: "Add session" },
  { action: "rest", label: "Mark as Rest day" }
];

const MENU_WIDTH = 180;
const MENU_HEIGHT = 80;

function clampPosition(x: number, y: number) {
  if (typeof window === "undefined") return { left: x, top: y };
  const left = Math.min(Math.max(x, 4), window.innerWidth - MENU_WIDTH - 4);
  const top = Math.min(Math.max(y, 4), window.innerHeight - MENU_HEIGHT - 4);
  return { left, top };
}

export function CellContextMenu({ x, y, onSelect, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const { left, top } = clampPosition(x, y);

  function focusItem(index: number) {
    const next = (index + ITEMS.length) % ITEMS.length;
    itemRefs.current[next]?.focus();
  }

  function handleItemKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index - 1);
    }
  }

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Empty cell actions"
      style={{ left, top, width: MENU_WIDTH }}
      className="fixed z-50 overflow-hidden rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(20,20,20,0.98)] py-1 text-xs shadow-lg"
    >
      {ITEMS.map((item, index) => (
        <button
          key={item.action}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          type="button"
          role="menuitem"
          onKeyDown={(event) => handleItemKey(event, index)}
          onClick={() => onSelect(item.action)}
          className="block w-full px-3 py-1.5 text-left text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-white focus:bg-[rgba(255,255,255,0.08)] focus:text-white focus:outline-none"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
