"use client";

import type { WeeklyIntensitySummary, ZoneKey } from "@/lib/training/intensity-profile";

type Props = {
  summary: WeeklyIntensitySummary;
};

const ZONE_COLOURS: Record<ZoneKey, string> = {
  z1: "hsl(210, 55%, 58%)",
  z2: "hsl(210, 50%, 52%)",
  z3: "hsl(40, 85%, 55%)",
  z4: "hsl(25, 90%, 55%)",
  z5: "hsl(5, 80%, 55%)",
  strength: "hsl(260, 40%, 55%)"
};

const ZONE_LABELS: Record<ZoneKey, string> = {
  z1: "Z1-2",
  z2: "Z2",
  z3: "Z3",
  z4: "Z4",
  z5: "Z5+",
  strength: "Str"
};

const DISPLAY_ZONES: ZoneKey[] = ["z1", "z2", "z3", "z4", "z5", "strength"];

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDelta(pct: number | null): string | null {
  if (pct === null) return null;
  if (pct === 0) return "same";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

// F23: classify the week's intensity shape so the distribution bar gets
// a verdict instead of just four percentages. Polarized = ≥65% easy
// (Z1-2) + ≥10% hard (Z4+Z5) with little Z3 glue. Pyramidal = lots of
// easy + significant Z3 with moderate Z4+. Threshold-heavy = Z3+Z4
// dominates. Everything else is "mixed".
function classifyDistribution(dist: Record<ZoneKey, number>): { label: string; tone: "success" | "warning" | "info" | "muted" } {
  const easy = (dist.z1 ?? 0) + (dist.z2 ?? 0);
  const tempo = dist.z3 ?? 0;
  const hard = (dist.z4 ?? 0) + (dist.z5 ?? 0);
  const threshold = (dist.z3 ?? 0) + (dist.z4 ?? 0);

  if (easy >= 0.65 && hard >= 0.1 && tempo < 0.2) {
    return { label: "Polarized", tone: "success" };
  }
  if (easy >= 0.5 && tempo >= 0.15 && hard >= 0.05 && tempo >= hard) {
    return { label: "Pyramidal", tone: "info" };
  }
  if (threshold >= 0.35 && easy < 0.55) {
    return { label: "Threshold-heavy", tone: "warning" };
  }
  if (easy >= 0.8) {
    return { label: "Aerobic-dominant", tone: "success" };
  }
  return { label: "Mixed", tone: "muted" };
}

const VERDICT_TONE_CLASS: Record<"success" | "warning" | "info" | "muted", string> = {
  success: "border-[rgba(52,211,153,0.3)] bg-[rgba(52,211,153,0.08)] text-success",
  warning: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-warning",
  info: "border-[rgba(96,165,250,0.3)] bg-[rgba(96,165,250,0.08)] text-[rgb(147,197,253)]",
  muted: "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] text-tertiary"
};

export function WeeklyIntensityHeader({ summary }: Props) {
  const zones = DISPLAY_ZONES
    .map((zone) => ({
      zone,
      fraction: summary.zoneDistribution[zone] ?? 0,
      colour: ZONE_COLOURS[zone],
      label: ZONE_LABELS[zone]
    }))
    .filter((z) => z.fraction > 0.02);

  const endurancePct = Math.round(
    ((summary.zoneDistribution.z1 ?? 0) + (summary.zoneDistribution.z2 ?? 0)) * 100
  );
  const hardPct = Math.round(
    ((summary.zoneDistribution.z4 ?? 0) + (summary.zoneDistribution.z5 ?? 0)) * 100
  );

  const verdict = classifyDistribution(summary.zoneDistribution);

  const hoursDelta = formatDelta(summary.hoursDeltaPct);

  return (
    <div className="space-y-2.5">
      {/* F23: distribution verdict — the pedagogically interesting number */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${VERDICT_TONE_CLASS[verdict.tone]}`}>
          {verdict.label} this week
        </span>
        <p className="text-[11px] text-tertiary">
          {endurancePct}% easy · {hardPct}% hard
        </p>
      </div>

      {/* F23: 20px stacked zone bar with inline labels on any segment
          wide enough to read. Anything <10% gets only its colour. */}
      <div className="flex h-5 overflow-hidden rounded-md">
        {zones.map((z) => {
          const pct = Math.round(z.fraction * 100);
          const showLabel = pct >= 10;
          return (
            <div
              key={z.zone}
              title={`${z.label}: ${pct}%`}
              className="flex items-center justify-center text-[10px] font-medium leading-none"
              style={{
                width: `${pct}%`,
                backgroundColor: z.colour,
                color: "rgba(0,0,0,0.78)"
              }}
            >
              {showLabel ? `${z.label} ${pct}%` : null}
            </div>
          );
        })}
      </div>

      {/* Totals — kept lean; stress moves into the Daily Load Shape
          subtitle where it belongs with the TSS per-day chart. */}
      {summary.totalPlannedHours > 0 || hoursDelta ? (
        <p className="text-[11px] text-tertiary">
          {formatHours(summary.totalPlannedHours)} planned
          {hoursDelta ? ` · ${hoursDelta} vs last week` : ""}
        </p>
      ) : null}
    </div>
  );
}
