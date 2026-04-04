/**
 * i18n configuration for tri.ai.
 *
 * Supported locales, default locale, and detection helpers.
 * Uses next-intl for App Router integration.
 */

export const defaultLocale = "en" as const;

export const supportedLocales = ["en", "de", "fr"] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (supportedLocales as readonly string[]).includes(value);
}

/**
 * Resolve the effective locale from a profile value or fallback.
 */
export function resolveLocale(profileLocale?: string | null): SupportedLocale {
  if (profileLocale && isSupportedLocale(profileLocale)) {
    return profileLocale;
  }
  return defaultLocale;
}

/**
 * Map locale codes to their display labels (in their own language).
 */
export const localeLabels: Record<SupportedLocale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Fran\u00e7ais",
};
