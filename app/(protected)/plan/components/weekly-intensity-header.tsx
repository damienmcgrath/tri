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

export function WeeklyIntensityHeader({ summary }: Props) {
  const zones = DISPLAY_ZONES
    .map((zone) => ({
      zone,
      fraction: summary.zoneDistribution[zone] ?? 0,
      colour: ZONE_COLOURS[zone],
      label: ZONE_LABELS[zone]
    }))
    .filter((z) => z.fraction > 0.02);

  // Merge z1 and z2 for display
  const endurancePct = Math.round(
    ((summary.zoneDistribution.z1 ?? 0) + (summary.zoneDistribution.z2 ?? 0)) * 100
  );
  const tempoPct = Math.round((summary.zoneDistribution.z3 ?? 0) * 100);
  const thresholdPct = Math.round((summary.zoneDistribution.z4 ?? 0) * 100);
  const vo2Pct = Math.round((summary.zoneDistribution.z5 ?? 0) * 100);

  const hoursDelta = formatDelta(summary.hoursDeltaPct);
  const stressDelta = formatDelta(summary.stressDeltaPct);

  return (
    <div className="space-y-2">
      {/* Stacked zone bar */}
      <div className="flex h-2 overflow-hidden rounded-full">
        {zones.map((z) => (
          <div
            key={z.zone}
            title={`${z.label}: ${Math.round(z.fraction * 100)}%`}
            style={{
              width: `${Math.round(z.fraction * 100)}%`,
              backgroundColor: z.colour
            }}
          />
        ))}
      </div>

      {/* Zone breakdown text */}
      <div className="flex flex-wrap gap-3 text-[10px] text-tertiary">
        {endurancePct > 0 ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ZONE_COLOURS.z2 }} />
            Z1-2: {endurancePct}%
          </span>
        ) : null}
        {tempoPct > 0 ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ZONE_COLOURS.z3 }} />
            Z3: {tempoPct}%
          </span>
        ) : null}
        {thresholdPct > 0 ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ZONE_COLOURS.z4 }} />
            Z4: {thresholdPct}%
          </span>
        ) : null}
        {vo2Pct > 0 ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ZONE_COLOURS.z5 }} />
            Z5: {vo2Pct}%
          </span>
        ) : null}
      </div>

      {/* Totals */}
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        <span>
          {formatHours(summary.totalPlannedHours)}
          {hoursDelta ? (
            <span className={`ml-1 ${(summary.hoursDeltaPct ?? 0) > 0 ? "text-tertiary" : "text-tertiary"}`}>
              ({hoursDelta} vs last week)
            </span>
          ) : null}
        </span>
        {summary.totalStressScore ? (
          <span>
            Stress: {summary.totalStressScore}
            {stressDelta ? <span className="ml-1 text-tertiary">({stressDelta})</span> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
