/**
 * Pure formatting + string-sanitisation helpers used by `lib/session-review.ts`
 * to build review view-models. Split out from the main module to keep the
 * view-model builder focused on assembly logic.
 */

export type Tone = "success" | "warning" | "risk" | "muted";

export function getString(
  result: Record<string, unknown> | null | undefined,
  keys: string[],
  fallback = ""
): string {
  if (!result) return fallback;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return fallback;
}

export function getNumber(
  result: Record<string, unknown> | null | undefined,
  keys: string[]
): number | null {
  if (!result) return null;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function pct(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Format interval completion ratio as a human-readable string. */
export function formatIntervalCompletion(value: number): string {
  const pctVal = Math.round(value * 100);
  if (pctVal >= 100) return "All completed";
  return `${pctVal}%`;
}

/** Sanitize raw camelCase field names that may appear in AI-generated text. */
export function sanitizeFieldNames(text: string): string {
  let result = text;
  // intervalCompletionPct or intervalCompletion with comparison operators and values
  // Match both "intervalCompletionPct" and "intervalCompletion" (with or without Pct suffix)
  // ≥ 1.0 → "all planned intervals completed"
  result = result.replace(/\bintervalCompletion(?:Pct)?\s*[≥>=]+\s*1(?:\.0)?\b/gi, "all planned intervals completed");
  // Comparator + value → operator-aware phrasing
  result = result.replace(/\bintervalCompletion(?:Pct)?\s*([≥≤]|>=|<=|>|<)\s*([\d.]+)/gi, (_m, op, v) => {
    const pctVal = Math.round(parseFloat(v) * 100);
    if (pctVal >= 100) return "all planned intervals completed";
    const isLessThan = /[<≤]/.test(op);
    const isStrict = op === "<" || op === ">";
    if (isLessThan) {
      return isStrict
        ? `less than ${pctVal}% of planned intervals completed`
        : `at most ${pctVal}% of planned intervals completed`;
    }
    return isStrict
      ? `more than ${pctVal}% of planned intervals completed`
      : `at least ${pctVal}% of planned intervals completed`;
  });
  // = or : with value
  result = result.replace(/\bintervalCompletion(?:Pct)?\s*[=:]\s*([\d.]+)/gi, (_m, v) => {
    const pctVal = Math.round(parseFloat(v) * 100);
    return pctVal >= 100 ? "all planned intervals completed" : `${pctVal}% of planned intervals completed`;
  });
  // Bare field name without value
  result = result.replace(/\bintervalCompletion(?:Pct)?\b/gi, "interval completion");
  result = result.replace(/\btimeAboveTargetPct\b/gi, "time above target");
  result = result.replace(/\bavgPower\b/gi, "avg power");
  result = result.replace(/\bavgHr\b/gi, "avg heart rate");
  result = result.replace(/\bnormalizedPower\b/gi, "normalized power");
  result = result.replace(/\bvariabilityIndex\b/gi, "variability index");
  result = result.replace(/\btrainingStressScore\b/gi, "training stress score");
  result = result.replace(/\btotalWorkKj\b/gi, "total work");
  // Expand "NP" abbreviation — match when used as a standalone term (not inside a word)
  // but only in metric contexts (followed by space + word/number, or at end after possessive)
  result = result.replace(/\bNP\b(?=\s+(?:remains|target|within|of|from|rose|is|was|at|near|≈|~|\d))/g, "normalized power");
  result = result.replace(/today's NP\b/g, "today's normalized power");
  result = result.replace(/\bVI\b(?=\s+(?:of|was|is|at|\d))/g, "variability index");
  return result;
}

export function durationLabel(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  const wholeMinutes = Math.round(minutes);
  const h = Math.floor(wholeMinutes / 60);
  const m = wholeMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function toneToTextClass(tone: Tone): string {
  if (tone === "success") return "text-[hsl(var(--success))]";
  if (tone === "warning") return "text-[hsl(var(--warning))]";
  if (tone === "risk") return "text-[hsl(var(--signal-risk))]";
  return "text-muted";
}

export function toneToBadgeClass(tone: Tone): string {
  if (tone === "success") return "border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]";
  if (tone === "warning") return "border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]";
  if (tone === "risk") return "border-[hsl(var(--signal-risk)/0.35)] bg-[hsl(var(--signal-risk)/0.12)] text-[hsl(var(--signal-risk))]";
  return "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] text-muted";
}

/** Format pace expressed as seconds per 100 metres. */
export function formatPacePer100m(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}/100m`;
}
