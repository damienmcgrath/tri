"use client";

type Props = {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "stable" | null;
  color?: "accent" | "success" | "warning" | "danger";
};

const TREND_ICONS: Record<string, string> = {
  up: "↑",
  down: "↓",
  stable: "→",
};

const COLOR_MAP: Record<string, string> = {
  accent: "border-accent/30 bg-accent/5",
  success: "border-success/30 bg-success/5",
  warning: "border-warning/30 bg-warning/5",
  danger: "border-danger/30 bg-danger/5",
};

export function MetricCardInline({ label, value, unit, trend, color = "accent" }: Props) {
  return (
    <div
      className={`my-1 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 ${COLOR_MAP[color] ?? COLOR_MAP.accent}`}
    >
      <span className="text-ui-label uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-body font-medium text-surface-foreground">
        {value}
        {unit && <span className="ml-0.5 text-ui-label font-normal text-muted-foreground">{unit}</span>}
      </span>
      {trend && (
        <span
          className={`text-ui-label ${
            trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-muted-foreground"
          }`}
        >
          {TREND_ICONS[trend]}
        </span>
      )}
    </div>
  );
}
