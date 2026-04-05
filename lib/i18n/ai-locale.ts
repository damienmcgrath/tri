/**
 * Build locale-aware instructions for AI prompt assembly.
 *
 * These instructions are appended to system prompts so that the AI
 * responds in the correct language and formats numbers/dates/distances
 * according to the athlete's preferences.
 */

export interface PromptLocaleConfig {
  language: string; // "en", "de", "fr"
  units: "metric" | "imperial";
  dateFormat: string; // e.g. "D MMMM YYYY" or "DD.MM.YYYY"
  paceFormat: "min_per_km" | "min_per_mile";
  formalityLevel: "informal" | "standard" | "formal";
}

const localeConfigs: Record<string, Omit<PromptLocaleConfig, "units">> = {
  en: {
    language: "en",
    dateFormat: "D MMMM YYYY",
    paceFormat: "min_per_km",
    formalityLevel: "informal",
  },
  de: {
    language: "de",
    dateFormat: "D. MMMM YYYY",
    paceFormat: "min_per_km",
    formalityLevel: "standard",
  },
  fr: {
    language: "fr",
    dateFormat: "D MMMM YYYY",
    paceFormat: "min_per_km",
    formalityLevel: "standard",
  },
};

/**
 * Build a PromptLocaleConfig from a locale code and unit preference.
 */
export function buildPromptLocaleConfig(
  locale: string,
  units: "metric" | "imperial"
): PromptLocaleConfig {
  const lang = locale.slice(0, 2);
  const base = localeConfigs[lang] ?? localeConfigs.en!;
  return {
    ...base,
    units,
    paceFormat: units === "imperial" ? "min_per_mile" : "min_per_km",
  };
}

/**
 * Generate the prompt instruction block for locale-aware AI output.
 *
 * Append this to any system prompt that generates athlete-facing text.
 */
export function getLocalePromptInstructions(config: PromptLocaleConfig): string {
  const languageMap: Record<string, string> = {
    en: "English",
    de: "German",
    fr: "French",
  };

  const distanceUnit = config.units === "imperial" ? "miles" : "kilometres";
  const paceUnit = config.paceFormat === "min_per_mile" ? "min/mile" : "min/km";
  const tempUnit = config.units === "imperial" ? "Fahrenheit" : "Celsius";

  const parts = [
    `Respond in ${languageMap[config.language] ?? "English"}.`,
    `Use ${distanceUnit} for distances and ${paceUnit} for pace.`,
    `Use ${tempUnit} for temperature.`,
    `Format dates as ${config.dateFormat}.`,
  ];

  if (config.formalityLevel === "formal") {
    parts.push("Use formal address (Sie in German, vous in French).");
  }

  return parts.join(" ");
}
