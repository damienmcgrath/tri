import type { WeekPreview } from "@/lib/training/week-preview";

const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

type Props = {
  preview: WeekPreview;
};

export function WeekAheadCard({ preview }: Props) {
  const sportColors: Record<string, string> = {
    swim: "#63b3ed",
    bike: "#34d399",
    run: "#ff5a28",
    strength: "#a78bfa"
  };

  const totalMinutes = preview.totalPlannedMinutes;
  const sportEntries = Object.entries(preview.sportDistribution).filter(([, mins]) => mins > 0);

  return (
    <article className="surface p-5">
      <p className="label">Week ahead</p>
      <p className="mt-1 text-xs text-tertiary">
        {preview.macroContext.currentBlock} phase · Week {preview.macroContext.currentPlanWeek} of {preview.macroContext.totalPlanWeeks}
      </p>

      {preview.aiNarrative ? (
        <p className="mt-3 text-sm text-[hsl(var(--text-primary))]">{preview.aiNarrative}</p>
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

      {sportEntries.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-tertiary">Volume by discipline</p>
          <div className="flex h-2 overflow-hidden rounded-full">
            {sportEntries.map(([sport, mins]) => (
              <div
                key={sport}
                style={{
                  width: `${Math.round((mins / totalMinutes) * 100)}%`,
                  backgroundColor: sportColors[sport] ?? "#888"
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {sportEntries.map(([sport, mins]) => (
              <span key={sport} className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sportColors[sport] ?? "#888" }} />
                {sport} {mins} min
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {preview.keySessions.length > 0 ? (
        <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
          <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-tertiary">Key sessions</p>
          <div className="space-y-1.5">
            {preview.keySessions.map((session, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-[hsl(var(--text-primary))]">{session.type}</span>
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
