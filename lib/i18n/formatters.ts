/**
 * Locale-aware formatting utilities for tri.ai.
 *
 * Every number, date, distance, pace, and duration rendered in the UI
 * should go through these helpers so that the output is correct for the
 * athlete's locale and unit preferences.
 */

export type UnitSystem = "metric" | "imperial";

export interface FormatOptions {
  locale: string; // BCP-47 tag, e.g. "en-GB", "de-DE", "fr-FR"
  units: UnitSystem;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

const KM_PER_MILE = 1.60934;

function bcp47(locale: string): string {
  // Map short codes to full BCP-47 if needed
  const map: Record<string, string> = { en: "en-GB", de: "de-DE", fr: "fr-FR" };
  return map[locale] ?? locale;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// ─── Numbers ───────���────────────────────────────────────────────────────────

/**
 * Format a number with locale-aware separators.
 * E.g. 1234.5 → "1,234.5" (en) / "1.234,5" (de) / "1\u202f234,5" (fr)
 */
export function formatNumber(n: number, opts: FormatOptions, decimals?: number): string {
  return new Intl.NumberFormat(bcp47(opts.locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals ?? 2,
  }).format(n);
}

// ─── Distance ────────���─────────────────────────────��────────────────────────

/**
 * Format a distance given in metres.
 *
 * - Distances < 1500m → show in metres (e.g. "400m", "1,500m")
 * - Distances ≥ 1500m → show in km or miles depending on unit system
 */
export function formatDistance(meters: number, opts: FormatOptions): string {
  if (opts.units === "imperial") {
    const miles = meters / 1000 / KM_PER_MILE;
    if (miles < 0.5) {
      const yards = Math.round(meters * 1.09361);
      return `${formatNumber(yards, opts, 0)}\u202fyd`;
    }
    return `${formatNumber(miles, opts, miles < 10 ? 2 : 1)}\u202fmi`;
  }

  // Metric
  if (meters < 1500) {
    return `${formatNumber(Math.round(meters), opts, 0)}\u202fm`;
  }
  const km = meters / 1000;
  return `${formatNumber(km, opts, km < 10 ? 2 : 1)}\u202fkm`;
}

// ─── Pace ──────────��────────────────────────────────────────────────────────

/**
 * Format a pace given as seconds per kilometre.
 * Returns "M:SS/km" or "M:SS/mi" depending on unit system.
 */
export function formatPace(secondsPerKm: number, opts: FormatOptions): string {
  let totalSeconds = secondsPerKm;
  let unit = "/km";

  if (opts.units === "imperial") {
    totalSeconds = secondsPerKm * KM_PER_MILE;
    unit = "/mi";
  }

  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  return `${mins}:${pad2(secs)}${unit}`;
}

// ─── Duration ─────────────────────────────────────���─────────────────────────

/**
 * Format a duration in minutes to a human-readable string.
 *
 * E.g. 95 → "1h 35min" (en) / "1 Std. 35 Min." (de) / "1h 35min" (fr)
 */
export function formatDuration(minutes: number, opts: FormatOptions): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);

  const lang = opts.locale.slice(0, 2);

  if (lang === "de") {
    if (h === 0) return `${m} Min.`;
    if (m === 0) return `${h} Std.`;
    return `${h} Std. ${m} Min.`;
  }

  // English and French use the same compact format
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

// ─── Date ���──────────────────────────────────���───────────────────────────────

/**
 * Format a Date or ISO date string to a locale-aware date.
 *
 * E.g. "4 April 2026" (en-GB) / "4. April 2026" (de-DE) / "4 avril 2026" (fr-FR)
 */
export function formatDate(
  date: Date | string,
  opts: FormatOptions,
  style: "long" | "medium" | "short" = "long"
): string {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00.000Z`) : date;

  const styleMap: Record<string, Intl.DateTimeFormatOptions> = {
    long: { day: "numeric", month: "long", year: "numeric" },
    medium: { day: "numeric", month: "short", year: "numeric" },
    short: { day: "numeric", month: "numeric", year: "2-digit" },
  };

  return new Intl.DateTimeFormat(bcp47(opts.locale), {
    ...styleMap[style],
    timeZone: "UTC",
  }).format(d);
}

/**
 * Format a Date to a locale-aware weekday name.
 */
export function formatWeekday(
  date: Date | string,
  opts: FormatOptions,
  style: "long" | "short" = "long"
): string {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00.000Z`) : date;
  return new Intl.DateTimeFormat(bcp47(opts.locale), {
    weekday: style,
    timeZone: "UTC",
  }).format(d);
}

// ─── Temperature ──────���─────────────────────────────────────────────────────

/**
 * Format a temperature given in Celsius.
 */
export function formatTemperature(celsius: number, opts: FormatOptions): string {
  if (opts.units === "imperial") {
    const f = Math.round(celsius * 1.8 + 32);
    return `${f}\u00b0F`;
  }
  return `${Math.round(celsius)}\u00b0C`;
}
