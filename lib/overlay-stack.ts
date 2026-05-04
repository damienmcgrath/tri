/**
 * Shared module-level counter for "is any modal/drawer overlay open".
 *
 * Each overlay component (plan SessionDrawer Sheet, CoachPanel, etc.)
 * registers itself via `pushOverlay` / `popOverlay` from a useLayoutEffect.
 * Floating affordances like the CoachFAB subscribe via `useOverlayOpen` and
 * hide while count > 0.
 *
 * This replaces the old MutationObserver-on-body-style fallback. Driving
 * the visibility from real component state means the FAB hides before the
 * first browser paint even on deep links that mount a drawer with `open`
 * already true (`?session=<id>`), so there is no overlap flash.
 */

import { useSyncExternalStore } from "react";

let count = 0;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

export function pushOverlay() {
  count += 1;
  notify();
}

export function popOverlay() {
  count = Math.max(0, count - 1);
  notify();
}

function subscribe(onStoreChange: () => void) {
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

function getSnapshot() {
  return count;
}

function getServerSnapshot() {
  // Always 0 on the server — overlays are client-only.
  return 0;
}

/** Reactive count of currently-open overlays. */
export function useOverlayOpenCount(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Convenience boolean: true while any overlay is open. */
export function useIsOverlayOpen(): boolean {
  return useOverlayOpenCount() > 0;
}
