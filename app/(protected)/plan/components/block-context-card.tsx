/**
 * Block context card: shows the current training block details.
 *
 * E.g. "Build Phase 2 — Week 3 of 4 — 14 weeks to IRONMAN Hamburg"
 */

type Props = {
  blockType: string;
  blockWeek: number;
  blockTotalWeeks: number;
  raceName: string | null;
  daysToRace: number | null;
  notes: string | null;
};

const BLOCK_ACCENT: Record<string, string> = {
  Base: "border-l-blue-500",
  Build: "border-l-amber-500",
  Peak: "border-l-orange-500",
  Taper: "border-l-emerald-400",
  Race: "border-l-red-500",
  Recovery: "border-l-neutral-500",
  Transition: "border-l-neutral-400",
};

export function BlockContextCard({ blockType, blockWeek, blockTotalWeeks, raceName, daysToRace, notes }: Props) {
  const weeksToRace = daysToRace !== null ? Math.ceil(daysToRace / 7) : null;

  return (
    <div className={`surface border-l-2 p-4 ${BLOCK_ACCENT[blockType] ?? "border-l-neutral-500"}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold">{blockType} Phase</span>
        <span className="text-xs text-muted">
          Week {blockWeek} of {blockTotalWeeks}
        </span>
        {raceName && weeksToRace !== null && weeksToRace > 0 && (
          <span className="text-xs text-muted">
            &mdash; {weeksToRace} {weeksToRace === 1 ? "week" : "weeks"} to {raceName}
          </span>
        )}
      </div>
      {notes && <p className="mt-1 text-xs text-muted">{notes}</p>}
    </div>
  );
}
