import type { WeekPreview } from "@/lib/training/week-preview";

const dayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

type Props = {
  preview: WeekPreview;
};

const SPORT_COLORS: Record<string, string> = {
  swim: "var(--color-swim)",
  bike: "var(--color-bike)",
  run: "var(--color-run)",
  strength: "var(--color-strength)"
};

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function WeekAheadCard({ preview }: Props) {
  const totalMinutes = preview.totalPlannedMinutes;
  const sportEntries = Object.entries(preview.sportDistribution).filter(([, mins]) => mins > 0);

  // Build per-day totals for the load shape (Mon–Sun)
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(preview.weekStart, i);
    const label = dayFormatter.format(new Date(`${iso}T00:00:00.000Z`));
    const sessions = preview.allSessions.filter((s) => s.date === iso);
    const totalMin = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
    return { iso, label, sessions, totalMin };
  });
  const maxDayMin = Math.max(...weekDays.map((d) => d.totalMin), 1);
  const hasAnyLoad = weekDays.some((d) => d.totalMin > 0);

  return (
    <article className="surface p-5">
      <p className="label">Week ahead</p>
      <p className="mt-1 text-xs text-tertiary">
        {preview.macroContext.currentBlock} phase · Week {preview.macroContext.currentPlanWeek} of {preview.macroContext.totalPlanWeeks}
      </p>

      {preview.aiNarrative ? (
        <p className="mt-3 text-sm text-white">{preview.aiNarrative}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-tertiary">Total volume</p>
          <p className="mt-1 text-lg font-semibold">{totalMinutes} min</p>
        </div>
        {preview.keySessionCount > 0 ? (
          <div>
            <p className="text-[10px] uppercase tracking-[0.08em] text-tertiary">Key sessions</p>
            <p className="mt-1 text-lg font-semibold">{preview.keySessionCount}</p>
          </div>
        ) : null}
      </div>

      {/* Daily load shape */}
      {hasAnyLoad ? (
        <div className="mt-4">
          <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-tertiary">Daily load</p>
          <div className="flex items-end gap-1">
            {weekDays.map((day) => (
              <div key={day.iso} className="flex flex-1 flex-col items-center gap-0.5">
                <div className="flex h-8 w-full flex-col-reverse overflow-hidden rounded-sm sm:h-10">
                  {(["swim", "bike", "run", "strength", "other"] as const).map((sport) => {
                    const mins = day.sessions.filter((s) => s.sport === sport).reduce((sum, s) => sum + s.durationMinutes, 0);
                    if (!mins) return null;
                    const heightPct = (mins / maxDayMin) * 100;
                    return (
                      <div
                        key={sport}
                        title={`${sport} · ${mins} min`}
                        style={{ height: `${heightPct}%`, backgroundColor: SPORT_COLORS[sport] ?? "rgba(255,255,255,0.25)" }}
                      />
                    );
                  })}
                </div>
                <p className="text-[10px] text-tertiary">{day.label.slice(0, 2)}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Sport distribution legend */}
      {sportEntries.length > 0 ? (
        <div className="mt-4">
          <div className="flex h-1.5 overflow-hidden rounded-full">
            {sportEntries.map(([sport, mins]) => (
              <div
                key={sport}
                title={`${sport} · ${mins} min`}
                style={{
                  width: `${Math.round((mins / totalMinutes) * 100)}%`,
                  backgroundColor: SPORT_COLORS[sport] ?? "#888"
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {sportEntries.map(([sport, mins]) => (
              <span key={sport} className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SPORT_COLORS[sport] ?? "#888" }} />
                {sport} {mins} min
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* All sessions list */}
      {preview.allSessions.length > 0 ? (
        <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
          <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-tertiary">Sessions</p>
          <div className="space-y-1.5">
            {preview.allSessions.map((session, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: SPORT_COLORS[session.sport] ?? "rgba(255,255,255,0.35)" }}
                />
                <span className="flex-1 text-white">
                  {session.type}
                  {session.isKey ? <span className="ml-1.5 text-[10px] text-[hsl(var(--warning))]">Key</span> : null}
                </span>
                <span className="text-tertiary">
                  {dateFormatter.format(new Date(`${session.date}T00:00:00.000Z`))}
                  {session.durationMinutes ? ` · ${session.durationMinutes} min` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {preview.carryForwardNote ? (
        <div className="mt-4 rounded-lg border border-[rgba(255,180,60,0.2)] bg-[rgba(255,180,60,0.06)] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--warning))]">From last week</p>
          <p className="mt-1 text-xs text-muted">{preview.carryForwardNote}</p>
        </div>
      ) : null}
    </article>
  );
}
