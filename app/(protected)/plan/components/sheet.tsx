"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { popOverlay, pushOverlay } from "@/lib/overlay-stack";

type Side = "right" | "bottom";

type Props = {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  /**
   * Slide-in edge. Defaults to "right" (desktop drawer). On phones the caller
   * passes "bottom" to render a bottom sheet that covers the lower portion of
   * the screen and supports swipe-down-to-dismiss.
   */
  side?: Side;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SWIPE_DISMISS_PX = 80;

/**
 * Slide-in panel. Uses createPortal to escape stacking contexts. Closes on
 * backdrop click and Escape. Traps focus inside the panel while open.
 *
 * `side="bottom"` renders a bottom sheet with a drag handle and swipe-down
 * dismiss; otherwise renders a right-edge drawer.
 */
export function Sheet({ open, onClose, ariaLabel, children, side = "right" }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const swipeStartY = useRef<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  // Defer the portal until after hydration so SSR (which renders nothing) and
  // the client's first render agree, even when `open` is true on first paint
  // (e.g. ?session=<id> deep links).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Push to the overlay stack synchronously before the first paint so
  // floating affordances (e.g. CoachFAB) can hide before any flash. A
  // layout effect runs after render but before paint and re-renders any
  // subscriber via useSyncExternalStore.
  useLayoutEffect(() => {
    if (!open) return;
    pushOverlay();
    return () => {
      popOverlay();
    };
  }, [open]);

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

  // Reset any in-flight swipe offset when the sheet closes externally so a
  // re-open starts at the natural resting position.
  useEffect(() => {
    if (!open) {
      swipeStartY.current = null;
      setSwipeOffset(0);
    }
  }, [open]);

  if (!open) return null;
  if (!mounted || typeof document === "undefined") return null;

  const isBottom = side === "bottom";

  const panelClass = isBottom
    ? "absolute bottom-0 left-0 right-0 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-xl border-t border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] shadow-2xl"
    : "absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col overflow-hidden border-l border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] shadow-2xl";

  const panelStyle =
    isBottom && swipeOffset > 0
      ? { transform: `translateY(${swipeOffset}px)`, transition: "none" }
      : undefined;

  function handleHandlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!isBottom) return;
    if (event.pointerType !== "touch" && event.pointerType !== "mouse") return;
    swipeStartY.current = event.clientY;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  function handleHandlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (swipeStartY.current === null) return;
    const dy = event.clientY - swipeStartY.current;
    setSwipeOffset(dy > 0 ? dy : 0);
  }

  function handleHandlePointerEnd() {
    if (swipeStartY.current === null) return;
    const shouldDismiss = swipeOffset >= SWIPE_DISMISS_PX;
    swipeStartY.current = null;
    setSwipeOffset(0);
    if (shouldDismiss) onClose();
  }

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
        data-side={side}
        className={panelClass}
        style={panelStyle}
      >
        {isBottom ? (
          <div
            role="presentation"
            aria-label="Drag handle"
            onPointerDown={handleHandlePointerDown}
            onPointerMove={handleHandlePointerMove}
            onPointerUp={handleHandlePointerEnd}
            onPointerCancel={handleHandlePointerEnd}
            className="flex w-full shrink-0 cursor-grab items-center justify-center py-2 active:cursor-grabbing"
          >
            <span
              aria-hidden
              className="h-1 w-10 rounded-full bg-[rgba(255,255,255,0.25)]"
            />
          </div>
        ) : null}
        {children}
      </div>
    </div>,
    document.body
  );
}
