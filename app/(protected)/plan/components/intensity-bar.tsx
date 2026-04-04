"use client";

import type { ZoneDistribution, ZoneKey } from "@/lib/training/intensity-profile";

type Props = {
  zoneDistribution: ZoneDistribution;
  height?: number;
  className?: string;
  /** Optional actual zone distribution for comparison overlay */
  actualDistribution?: ZoneDistribution | null;
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
  z1: "Z1",
  z2: "Z2",
  z3: "Z3",
  z4: "Z4",
  z5: "Z5",
  strength: "Str"
};

const ZONE_ORDER: ZoneKey[] = ["z1", "z2", "z3", "z4", "z5", "strength"];

export function IntensityBar({ zoneDistribution, height = 6, className = "", actualDistribution }: Props) {
  const segments = ZONE_ORDER
    .map((zone) => ({
      zone,
      fraction: zoneDistribution[zone] ?? 0,
      colour: ZONE_COLOURS[zone]
    }))
    .filter((s) => s.fraction > 0.01);

  if (segments.length === 0) return null;

  return (
    <div className={className}>
      {/* Planned intensity bar */}
      <div className="flex overflow-hidden rounded-full" style={{ height: `${height}px` }}>
        {segments.map((s) => (
          <div
            key={s.zone}
            title={`${ZONE_LABELS[s.zone]}: ${Math.round(s.fraction * 100)}%`}
            style={{
              width: `${Math.round(s.fraction * 100)}%`,
              backgroundColor: s.colour,
              opacity: 0.85
            }}
          />
        ))}
      </div>

      {/* Actual overlay (if available) */}
      {actualDistribution ? (
        <div className="mt-0.5 flex overflow-hidden rounded-full" style={{ height: `${Math.max(3, height - 2)}px` }}>
          {ZONE_ORDER
            .map((zone) => ({
              zone,
              fraction: actualDistribution[zone] ?? 0,
              colour: ZONE_COLOURS[zone]
            }))
            .filter((s) => s.fraction > 0.01)
            .map((s) => (
              <div
                key={s.zone}
                title={`Actual ${ZONE_LABELS[s.zone]}: ${Math.round(s.fraction * 100)}%`}
                style={{
                  width: `${Math.round(s.fraction * 100)}%`,
                  backgroundColor: s.colour,
                  opacity: 0.5
                }}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}
