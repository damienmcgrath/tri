export type IntentDiscipline = "swim" | "bike" | "run" | "strength" | "other";

export const INTENT_CATEGORIES_BY_DISCIPLINE: Record<IntentDiscipline, readonly string[]> = {
  swim: ["Aerobic", "Technique", "Threshold", "Race-pace", "Recovery"],
  bike: ["Easy Z2", "Endurance", "Sweet spot", "Threshold", "VO2", "Race-pace", "Recovery"],
  run: ["Easy Z2", "Long endurance", "Tempo", "Threshold", "VO2", "Strides", "Race-pace", "Recovery"],
  strength: ["Heavy", "Plyometrics", "Mobility", "Core"],
  other: ["Brick", "Cross-training", "Mobility", "Recovery"]
} as const;

export const ALL_INTENT_CATEGORIES: readonly string[] = Array.from(
  new Set(Object.values(INTENT_CATEGORIES_BY_DISCIPLINE).flat())
);

export function getIntentCategoriesForDiscipline(discipline: string | null | undefined): readonly string[] {
  const key = (discipline ?? "").toLowerCase() as IntentDiscipline;
  return INTENT_CATEGORIES_BY_DISCIPLINE[key] ?? INTENT_CATEGORIES_BY_DISCIPLINE.other;
}

/**
 * Returns true if `value` is one of the curated options for the given
 * discipline. Free-form labels (anything else) are still allowed as a
 * fallback, but the drawer will surface them under "Other".
 */
export function isCuratedIntent(value: string | null | undefined, discipline: string | null | undefined): boolean {
  if (!value) return false;
  return getIntentCategoriesForDiscipline(discipline).includes(value);
}
