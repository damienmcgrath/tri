"use client";

/**
 * Horizontal season timeline showing training blocks as colored segments
 * with race markers as diamond badges.
 */

type Block = {
  id: string;
  name: string;
  blockType: string;
  startDate: string;
  endDate: string;
  targetRaceId: string | null;
};

type Race = {
  id: string;
  name: string;
  date: string;
  priority: "A" | "B" | "C";
};

type Props = {
  blocks: Block[];
  races: Race[];
  seasonStart: string;
  seasonEnd: string;
  todayIso: string;
};

const BLOCK_COLORS: Record<string, string> = {
  Base: "bg-blue-500/40",
  Build: "bg-amber-500/50",
  Peak: "bg-orange-500/50",
  Taper: "bg-emerald-400/40",
  Race: "bg-red-500/50",
  Recovery: "bg-neutral-500/30",
  Transition: "bg-neutral-400/20",
};

const PRIORITY_COLORS: Record<string, string> = {
  A: "border-red-400 text-red-400",
  B: "border-amber-400 text-amber-400",
  C: "border-neutral-400 text-neutral-400",
};

function toMs(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).getTime();
}

export function SeasonTimeline({ blocks, races, seasonStart, seasonEnd, todayIso }: Props) {
  const totalMs = toMs(seasonEnd) - toMs(seasonStart);
  if (totalMs <= 0) return null;

  const todayPct = Math.min(100, Math.max(0, ((toMs(todayIso) - toMs(seasonStart)) / totalMs) * 100));

  return (
    <div className="surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="label">Season Timeline</p>
        <p className="text-xs text-muted">
          {seasonStart} &mdash; {seasonEnd}
        </p>
      </div>

      {/* Block bar */}
      <div className="relative h-8 overflow-hidden rounded-md bg-[var(--color-surface-raised)]">
        {blocks.map((block) => {
          const leftPct = ((toMs(block.startDate) - toMs(seasonStart)) / totalMs) * 100;
          const widthPct = ((toMs(block.endDate) - toMs(block.startDate) + 86400000) / totalMs) * 100;

          return (
            <div
              key={block.id}
              className={`absolute inset-y-0 ${BLOCK_COLORS[block.blockType] ?? "bg-neutral-400/20"}`}
              style={{ left: `${Math.max(0, leftPct)}%`, width: `${Math.min(widthPct, 100 - leftPct)}%` }}
              title={`${block.name} (${block.startDate} – ${block.endDate})`}
            >
              <span className="absolute inset-0 flex items-center justify-center truncate px-1 text-[10px] font-medium text-white/80">
                {widthPct > 8 ? block.name : ""}
              </span>
            </div>
          );
        })}

        {/* Today marker */}
        <div
          className="absolute inset-y-0 w-px bg-white/60"
          style={{ left: `${todayPct}%` }}
          title="Today"
        />
      </div>

      {/* Race markers */}
      <div className="relative mt-2 h-6">
        {races.map((race) => {
          const leftPct = ((toMs(race.date) - toMs(seasonStart)) / totalMs) * 100;
          if (leftPct < 0 || leftPct > 100) return null;

          return (
            <div
              key={race.id}
              className="absolute -top-0.5 flex flex-col items-center"
              style={{ left: `${leftPct}%`, transform: "translateX(-50%)" }}
            >
              <span
                className={`inline-flex h-4 w-4 rotate-45 items-center justify-center border ${PRIORITY_COLORS[race.priority] ?? ""}`}
              >
                <span className="-rotate-45 text-[8px] font-bold">{race.priority}</span>
              </span>
              <span className="mt-0.5 whitespace-nowrap text-[9px] text-muted">{race.name}</span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted">
        {Object.entries(BLOCK_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
