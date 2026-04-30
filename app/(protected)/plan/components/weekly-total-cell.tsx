"use client";

import { computeSessionIntensityProfile, computeWeeklyIntensitySummary } from "@/lib/training/intensity-profile";
import type { SessionPillSession } from "./session-pill";

type CompletedSession = {
  duration_minutes: number;
};

type Props = {
  sessions: SessionPillSession[];
  weekStartDate: string;
  completedSessions?: CompletedSession[];
};

function formatHours(hours: number) {
  if (hours <= 0) return "0h";
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  if (whole === 0) return `${minutes}m`;
  return minutes > 0 ? `${whole}h${minutes}m` : `${whole}h`;
}

export function WeeklyTotalCell({ sessions, weekStartDate, completedSessions }: Props) {
  const profiles = sessions.map((session) =>
    computeSessionIntensityProfile({
      id: session.id,
      sport: session.sport,
      type: session.type ?? "",
      target: session.target,
      notes: session.notes,
      durationMinutes: session.duration_minutes,
      intentCategory: session.intent_category ?? null
    })
  );
  const summary = computeWeeklyIntensitySummary(
    profiles.map((profile) => ({ ...profile, visualWeight: 0 })),
    weekStartDate
  );

  const plannedMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
  const actualMinutes = (completedSessions ?? []).reduce(
    (sum, s) => sum + (s.duration_minutes ?? 0),
    0
  );
  const deltaMinutes = actualMinutes - plannedMinutes;
  const hasActual = (completedSessions?.length ?? 0) > 0;

  // Intensity 3-segment: low (z1+z2), mid (z3), high (z4+z5)
  const dist = summary.zoneDistribution;
  const intensityLow = (dist.z1 ?? 0) + (dist.z2 ?? 0);
  const intensityMid = dist.z3 ?? 0;
  const intensityHigh = (dist.z4 ?? 0) + (dist.z5 ?? 0);
  const intensityTotal = intensityLow + intensityMid + intensityHigh || 1;

  // Discipline 3-segment: swim, bike, run (strength rolled into "other" not shown)
  const disc = summary.disciplineHours;
  const swim = disc.swim ?? 0;
  const bike = disc.bike ?? 0;
  const run = disc.run ?? 0;
  const disciplineTotal = swim + bike + run || 1;

  return (
    <div className="flex flex-col gap-1 border-l border-[rgba(255,255,255,0.06)] px-2 py-1.5">
      <p className="text-xs font-semibold tabular-nums text-white">
        {formatHours(summary.totalPlannedHours)}
      </p>
      {hasActual ? (
        <p
          className={`text-[10px] tabular-nums ${
            deltaMinutes >= 0 ? "text-[rgba(140,255,170,0.85)]" : "text-[rgba(255,150,150,0.85)]"
          }`}
        >
          {formatHours(actualMinutes / 60)} ({deltaMinutes >= 0 ? "+" : ""}
          {deltaMinutes}m)
        </p>
      ) : (
        <p className="text-[10px] text-tertiary">—</p>
      )}
      <div className="mt-0.5 flex h-[3px] w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.05)]">
        <div
          style={{
            width: `${(intensityLow / intensityTotal) * 100}%`,
            backgroundColor: "hsl(140, 55%, 55%)"
          }}
          title={`Low intensity ${Math.round((intensityLow / intensityTotal) * 100)}%`}
        />
        <div
          style={{
            width: `${(intensityMid / intensityTotal) * 100}%`,
            backgroundColor: "hsl(48, 90%, 58%)"
          }}
          title={`Mid intensity ${Math.round((intensityMid / intensityTotal) * 100)}%`}
        />
        <div
          style={{
            width: `${(intensityHigh / intensityTotal) * 100}%`,
            backgroundColor: "hsl(15, 85%, 58%)"
          }}
          title={`High intensity ${Math.round((intensityHigh / intensityTotal) * 100)}%`}
        />
      </div>
      <div className="flex h-[3px] w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.05)]">
        <div
          style={{
            width: `${(swim / disciplineTotal) * 100}%`,
            backgroundColor: "var(--color-swim)"
          }}
          title={`Swim ${swim.toFixed(1)}h`}
        />
        <div
          style={{
            width: `${(bike / disciplineTotal) * 100}%`,
            backgroundColor: "var(--color-bike)"
          }}
          title={`Bike ${bike.toFixed(1)}h`}
        />
        <div
          style={{
            width: `${(run / disciplineTotal) * 100}%`,
            backgroundColor: "var(--color-run)"
          }}
          title={`Run ${run.toFixed(1)}h`}
        />
      </div>
    </div>
  );
}
