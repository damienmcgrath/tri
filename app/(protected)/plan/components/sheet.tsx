"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SWIPE_DISMISS_PX = 80;
const SWIPE_HORIZONTAL_TOLERANCE_PX = 40;

/**
 * Right-edge slide-in panel. Uses createPortal to escape stacking contexts.
 * Closes on backdrop click and Escape. Traps focus inside the panel while open.
 */
export function Sheet({ open, onClose, ariaLabel, children }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  // Defer the portal until after hydration so SSR (which renders nothing) and
  // the client's first render agree, even when `open` is true on first paint
  // (e.g. ?session=<id> deep links).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    previousActiveRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      focusables?.[0]?.focus();
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      previousActiveRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border-x border-t border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:max-w-[440px] sm:rounded-none sm:border-x-0 sm:border-l sm:border-t-0"
      >
        <div
          aria-hidden
          className="flex cursor-grab justify-center pt-2 sm:hidden"
          onTouchStart={(e) => {
            swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }}
          onTouchMove={(e) => {
            if (!swipeStartRef.current) return;
            const dx = e.touches[0].clientX - swipeStartRef.current.x;
            const dy = e.touches[0].clientY - swipeStartRef.current.y;
            if (Math.abs(dx) > SWIPE_HORIZONTAL_TOLERANCE_PX) {
              swipeStartRef.current = null;
            } else if (dy > SWIPE_DISMISS_PX) {
              swipeStartRef.current = null;
              onClose();
            }
          }}
          onTouchEnd={() => {
            swipeStartRef.current = null;
          }}
        >
          <span className="h-1 w-10 rounded-full bg-[rgba(255,255,255,0.2)]" />
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
