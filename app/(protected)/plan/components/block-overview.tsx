"use client";

import type { WeeklyIntensitySummary, ZoneKey } from "@/lib/training/intensity-profile";

type Props = {
  weeks: Array<{
    weekIndex: number;
    weekStartDate: string;
    focus: string;
    summary: WeeklyIntensitySummary | null;
  }>;
  currentWeekStart?: string;
};

const ZONE_COLOURS: Record<ZoneKey, string> = {
  z1: "hsl(210, 55%, 58%)",
  z2: "hsl(210, 50%, 52%)",
  z3: "hsl(40, 85%, 55%)",
  z4: "hsl(25, 90%, 55%)",
  z5: "hsl(5, 80%, 55%)",
  strength: "hsl(260, 40%, 55%)"
};

const ZONE_ORDER: ZoneKey[] = ["z1", "z2", "z3", "z4", "z5", "strength"];

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

const weekDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

export function BlockOverview({ weeks, currentWeekStart }: Props) {
  if (weeks.length === 0) return null;

  const maxStress = Math.max(...weeks.map((w) => w.summary?.totalStressScore ?? 0), 1);

  return (
    <article className="surface p-5">
      <p className="label">Block overview</p>
      <p className="mt-1 text-xs text-tertiary">{weeks.length} weeks</p>

      <div className="mt-4 space-y-1.5">
        {weeks.map((week) => {
          const isCurrent = week.weekStartDate === currentWeekStart;
          const summary = week.summary;
          const stressHeight = summary
            ? Math.max(4, (summary.totalStressScore / maxStress) * 100)
            : 0;

          return (
            <div
              key={week.weekIndex}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                isCurrent
                  ? "border border-[rgba(190,255,0,0.2)] bg-[rgba(190,255,0,0.04)]"
                  : "border border-transparent"
              }`}
            >
              {/* Week label */}
              <div className="w-16 shrink-0">
                <p className="text-xs font-medium text-white">Wk {week.weekIndex}</p>
                <p className="text-[10px] text-tertiary">
                  {weekDateFormatter.format(new Date(`${week.weekStartDate}T00:00:00.000Z`))}
                </p>
              </div>

              {/* Intensity bar */}
              <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.04)]">
                {summary
                  ? ZONE_ORDER
                      .map((zone) => ({
                        zone,
                        fraction: summary.zoneDistribution[zone] ?? 0,
                        colour: ZONE_COLOURS[zone]
                      }))
                      .filter((s) => s.fraction > 0.01)
                      .map((s) => (
                        <div
                          key={s.zone}
                          style={{
                            width: `${Math.round(s.fraction * 100)}%`,
                            backgroundColor: s.colour,
                            opacity: 0.8
                          }}
                        />
                      ))
                  : null}
              </div>

              {/* Meta */}
              <div className="w-20 shrink-0 text-right">
                {summary ? (
                  <>
                    <p className="text-xs font-medium text-white">{formatHours(summary.totalPlannedHours)}</p>
                    <p className="text-[10px] text-tertiary">{summary.sessionCount} sessions</p>
                  </>
                ) : (
                  <p className="text-[10px] text-tertiary">No data</p>
                )}
              </div>

              {/* Focus badge */}
              <span className="w-16 shrink-0 text-right text-[10px] text-tertiary">
                {week.focus}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
