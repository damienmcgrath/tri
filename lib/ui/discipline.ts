const disciplineConfig = {
  swim: { label: "Swim", className: "discipline-swim" },
  bike: { label: "Bike", className: "discipline-bike" },
  run: { label: "Run", className: "discipline-run" },
  strength: { label: "Strength", className: "discipline-strength" },
  other: { label: "Other", className: "discipline-other" }
} as const;

export function getDisciplineMeta(rawSport: string | null | undefined) {
  const normalized = (rawSport ?? "other").toLowerCase();
  if (normalized in disciplineConfig) {
    return disciplineConfig[normalized as keyof typeof disciplineConfig];
  }

  return disciplineConfig.other;
}
