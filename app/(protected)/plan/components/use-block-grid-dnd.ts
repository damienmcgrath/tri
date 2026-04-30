"use client";

import { useSensor, useSensors, PointerSensor } from "@dnd-kit/core";

export const DRAG_ACTIVATION_DISTANCE_PX = 8;

export const DROPPABLE_ID_SEPARATOR = "::";

export function makeDroppableId(weekId: string, date: string) {
  return `${weekId}${DROPPABLE_ID_SEPARATOR}${date}`;
}

export function parseDroppableId(id: string): { weekId: string; date: string } | null {
  const idx = id.indexOf(DROPPABLE_ID_SEPARATOR);
  if (idx < 0) return null;
  return { weekId: id.slice(0, idx), date: id.slice(idx + DROPPABLE_ID_SEPARATOR.length) };
}

/**
 * Pointer sensor with an 8px activation distance. The threshold is required
 * (not optional) so that a click on a SessionPill still opens the drawer —
 * @dnd-kit only treats the gesture as a drag once the pointer has moved past
 * the threshold.
 */
export function useBlockGridDndSensors() {
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX }
  });
  return useSensors(pointerSensor);
}
