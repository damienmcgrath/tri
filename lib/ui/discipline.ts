export type DisciplineTexture = "solid" | "dashed" | "dot-grid";
export type DisciplineShape = "circle" | "square" | "triangle" | "diamond" | "hex";

const disciplineConfig = {
  swim: { label: "Swim", className: "discipline-swim", icon: "◉", shape: "circle", texture: "dot-grid" },
  bike: { label: "Bike", className: "discipline-bike", icon: "▦", shape: "square", texture: "solid" },
  run: { label: "Run", className: "discipline-run", icon: "▲", shape: "triangle", texture: "dashed" },
  strength: { label: "Strength", className: "discipline-strength", icon: "◆", shape: "diamond", texture: "dot-grid" },
  other: { label: "Other", className: "discipline-other", icon: "⬢", shape: "hex", texture: "solid" }
} as const;

export type DisciplineMeta = (typeof disciplineConfig)[keyof typeof disciplineConfig] & {
  textureClassName: string;
};

export function getDisciplineMeta(rawSport: string | null | undefined): DisciplineMeta {
  const normalized = (rawSport ?? "other").toLowerCase();
  const base = normalized in disciplineConfig ? disciplineConfig[normalized as keyof typeof disciplineConfig] : disciplineConfig.other;

  return {
    ...base,
    textureClassName: `discipline-texture-${base.texture}`
  };
}
