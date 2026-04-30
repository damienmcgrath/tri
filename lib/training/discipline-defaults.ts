export type Discipline = "swim" | "bike" | "run" | "strength" | "other";

const DISCIPLINES: ReadonlyArray<Discipline> = ["swim", "bike", "run", "strength", "other"];

function normaliseDiscipline(value: string | null | undefined): Discipline | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return (DISCIPLINES as readonly string[]).includes(lower) ? (lower as Discipline) : null;
}

/**
 * Compute UTC weekday index for an ISO date (YYYY-MM-DD), 0=Mon..6=Sun.
 */
export function weekdayIndexFromIso(iso: string): number {
  const date = new Date(`${iso}T00:00:00.000Z`);
  // getUTCDay returns 0=Sun..6=Sat; remap to 0=Mon..6=Sun.
  return (date.getUTCDay() + 6) % 7;
}

type SessionLike = {
  date?: string | null;
  sport?: string | null;
};

/**
 * Pick a default discipline for a newly created session in `cellDate`.
 *
 * Order:
 *  1. The most common discipline observed for that weekday across
 *     `weekSessions` in the current block. Ties broken by the canonical
 *     order swim < bike < run < strength < other.
 *  2. The user's last-edited discipline, if provided.
 *  3. "run" as the final fallback.
 */
export function inferDefaultDiscipline(args: {
  cellDate: string;
  weekSessions: ReadonlyArray<SessionLike>;
  lastEditedDiscipline: string | null;
}): Discipline {
  const { cellDate, weekSessions, lastEditedDiscipline } = args;
  const targetWeekday = weekdayIndexFromIso(cellDate);

  const counts = new Map<Discipline, number>();
  for (const session of weekSessions) {
    const sport = normaliseDiscipline(session.sport ?? null);
    if (!sport) continue;
    if (!session.date) continue;
    if (weekdayIndexFromIso(session.date) !== targetWeekday) continue;
    counts.set(sport, (counts.get(sport) ?? 0) + 1);
  }

  if (counts.size > 0) {
    let best: Discipline | null = null;
    let bestCount = 0;
    for (const candidate of DISCIPLINES) {
      const count = counts.get(candidate) ?? 0;
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    }
    if (best) return best;
  }

  const lastEdited = normaliseDiscipline(lastEditedDiscipline);
  if (lastEdited) return lastEdited;

  return "run";
}
