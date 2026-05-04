/** Safely cast to a Record if the value is a non-array object, otherwise null. */
export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Return a trimmed non-empty string, or null. */
export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Filter an array to only non-empty trimmed strings. */
export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter((item): item is string => item !== null)
    : [];
}

/** Truncate a string to `max` characters, appending an ellipsis if needed. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
