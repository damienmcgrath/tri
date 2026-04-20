/**
 * Variance corpus for the weekly-debrief two-pass generator.
 *
 * Prior weekly debriefs are summarised into a compact list of phrasings the
 * athlete has already seen — the executive summary lead, the non-obvious
 * insight, the coach-share headline, and the deterministic takeaway title.
 * The analytic and narrative passes consume this list and are instructed not
 * to reuse the same framings, addressing the "only two coach_headline
 * variants across all weeks" templated-feel problem flagged in the AI content
 * review.
 */

export type WeeklyDebriefPriorHeadline = {
  weekStart: string;
  coachHeadline: string | null;
  executiveSummary: string | null;
  nonObviousInsight: string | null;
  takeawayTitle: string | null;
};

type PriorWeeklyDebriefRow = {
  week_start: string;
  narrative?: unknown;
  coach_share?: unknown;
  facts?: unknown;
};

function readString(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object") return null;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Convert prior weekly_debriefs rows into a variance corpus for the next
 * generation. Ordered most-recent-first so the model weights the freshest
 * phrasings highest.
 */
export function extractPriorHeadlines(rows: PriorWeeklyDebriefRow[]): WeeklyDebriefPriorHeadline[] {
  return rows
    .filter((row) => typeof row.week_start === "string" && row.week_start.length > 0)
    .map((row) => ({
      weekStart: row.week_start,
      coachHeadline: readString(row.coach_share, "headline"),
      executiveSummary: readString(row.narrative, "executiveSummary"),
      nonObviousInsight: readString(row.narrative, "nonObviousInsight"),
      takeawayTitle: readString(row.facts, "primaryTakeawayTitle")
    }))
    .filter((entry) =>
      entry.coachHeadline != null ||
      entry.executiveSummary != null ||
      entry.nonObviousInsight != null ||
      entry.takeawayTitle != null
    );
}
