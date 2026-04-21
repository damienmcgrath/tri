"use client";

import { usePathname } from "next/navigation";
import { useCoachPanel } from "./coach-panel-context";

// Small, always-visible. Kept in its own module so the wrapper can hydrate it
// eagerly while the heavier CoachPanel stays lazy.
export function CoachFAB() {
  const { open, isOpen } = useCoachPanel();
  const pathname = usePathname();

  if (isOpen) return null;
  if (pathname?.startsWith("/coach")) return null;

  return (
    <button
      type="button"
      onClick={() => open()}
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-black shadow-lg transition hover:scale-105 hover:shadow-xl lg:bottom-6 lg:right-6"
      aria-label="Open coach"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
