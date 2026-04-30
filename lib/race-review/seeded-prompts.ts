/**
 * Deterministic seeded prompts for the race-coach interrogation surface.
 *
 * The prompts are NOT AI-generated. They are matched against a small,
 * audited library based on the race's actual findings. Every rule is
 * gated on data already in the race object so the audit lint is trivial:
 * a "Was my taper right?" prompt only appears when taper compliance was
 * actually below threshold OR pre-race TSB state was sub-optimal.
 *
 * Output is capped at 5 prompts, sorted by priority.
 */

import type { RaceBundleSummary } from "@/lib/race/bundle-helpers";

// ─── Types ────────────────────────────────────────────────────────────────

export type PriorRaceLite = {
  bundleId: string;
  name: string | null;
  date: string;
  distanceType: string | null;
};

export type NextRaceLite = {
  raceProfileId: string;
  name: string;
  date: string;
  distanceType: string | null;
  daysUntil: number;
};

export type SeededPromptsInput = {
  summary: RaceBundleSummary;
  priorRaces: PriorRaceLite[];
  nextRace: NextRaceLite | null;
};

export type SeededPrompt = {
  prompt: string;
  /** Higher → shown first. Tied prompts keep insertion order. */
  priority: number;
  /** Tag describing which rule fired. Used by the audit lint. */
  reason:
    | "bike_fade"
    | "swim_fade"
    | "run_fade"
    | "taper_off"
    | "fatigued_at_start"
    | "cross_discipline_insight"
    | "prior_race_compare"
    | "next_race_implication"
    | "subjective_issue"
    | "fallback_overall"
    | "fallback_lessons";
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const TAPER_COMPLIANCE_THRESHOLD = 0.8;
const NEXT_RACE_HORIZON_DAYS = 16 * 7; // 112 days

const FADED_LIKE: ReadonlySet<string> = new Set(["faded", "cooked"]);
const SUBOPTIMAL_TSB: ReadonlySet<string> = new Set(["fatigued", "overreaching"]);

function isFadedStatus(status: unknown): boolean {
  return typeof status === "string" && FADED_LIKE.has(status);
}

function safeGetLegStatus(value: unknown, role: "swim" | "bike" | "run"): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const entry = v[role];
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    // The deterministic shape from lib/race-review/leg-status.ts uses
    // `label`. Some older payloads use `status`. Accept both.
    if (typeof obj.label === "string") return obj.label;
    if (typeof obj.status === "string") return obj.status;
  }
  if (typeof entry === "string") return entry;
  return null;
}

function formatRaceShortLabel(race: PriorRaceLite): string {
  const date = new Date(`${race.date}T00:00:00.000Z`);
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  if (race.name) return `${race.name} (${monthLabel})`;
  return `your ${race.distanceType ?? "last"} race (${monthLabel})`;
}

// ─── Generator ────────────────────────────────────────────────────────────

export function generateRaceSeededPrompts(input: SeededPromptsInput): SeededPrompt[] {
  const { summary, priorRaces, nextRace } = input;
  const { bundle, review } = summary;

  const prompts: SeededPrompt[] = [];

  // Rule 1 — bike fade (highest signal, often the root cause)
  if (review && isFadedStatus(safeGetLegStatus(review.leg_status, "bike"))) {
    prompts.push({
      prompt: "Why did the bike fade?",
      priority: 100,
      reason: "bike_fade"
    });
  } else if (review && isFadedStatus(safeGetLegStatus(review.leg_status, "run"))) {
    prompts.push({
      prompt: "Why did the run fade?",
      priority: 95,
      reason: "run_fade"
    });
  } else if (review && isFadedStatus(safeGetLegStatus(review.leg_status, "swim"))) {
    prompts.push({
      prompt: "Why did the swim fade?",
      priority: 90,
      reason: "swim_fade"
    });
  }

  // Rule 2 — taper / pre-race state
  const taperOff = bundle.taper_compliance_score != null && bundle.taper_compliance_score < TAPER_COMPLIANCE_THRESHOLD;
  const fatiguedStart = bundle.pre_race_tsb_state ? SUBOPTIMAL_TSB.has(bundle.pre_race_tsb_state) : false;
  if (taperOff || fatiguedStart) {
    prompts.push({
      prompt: "Was my taper right?",
      priority: 80,
      reason: taperOff ? "taper_off" : "fatigued_at_start"
    });
  }

  // Rule 3 — cross-discipline insight present (run-off-bike pattern)
  const cross = review?.cross_discipline_insight;
  if (typeof cross === "string" && cross.length > 0) {
    const lower = cross.toLowerCase();
    if (lower.includes("bike") && (lower.includes("run") || lower.includes("legs"))) {
      prompts.push({
        prompt: "What would my run have been if I'd held more in reserve on the bike?",
        priority: 75,
        reason: "cross_discipline_insight"
      });
    } else {
      prompts.push({
        prompt: "Talk me through the cross-discipline pattern.",
        priority: 70,
        reason: "cross_discipline_insight"
      });
    }
  }

  // Rule 4 — prior race (same distance only)
  const thisDistance = summary.raceProfile?.distance_type ?? null;
  const matchingPrior = thisDistance
    ? priorRaces.find((r) => r.distanceType === thisDistance)
    : priorRaces[0] ?? null;
  if (matchingPrior) {
    prompts.push({
      prompt: `How does this compare to ${formatRaceShortLabel(matchingPrior)}?`,
      priority: 65,
      reason: "prior_race_compare"
    });
  }

  // Rule 5 — next race within horizon
  if (nextRace && nextRace.daysUntil > 0 && nextRace.daysUntil <= NEXT_RACE_HORIZON_DAYS) {
    prompts.push({
      prompt: `What should I change in training before ${nextRace.name}?`,
      priority: 60,
      reason: "next_race_implication"
    });
  }

  // Rule 6 — subjective issue flagged
  const issues = bundle.issues_flagged ?? [];
  if (issues.length > 0) {
    const issue = issues[0];
    prompts.push({
      prompt: `What does the data say about my ${issue} issue?`,
      priority: 55,
      reason: "subjective_issue"
    });
  }

  // Fallbacks — keep at least 2 prompts even when the race was clean
  if (prompts.length < 2) {
    prompts.push({
      prompt: "Walk me through the race overall.",
      priority: 30,
      reason: "fallback_overall"
    });
  }
  if (prompts.length < 3 && summary.lessons && summary.lessons.trainingImplications.length > 0) {
    prompts.push({
      prompt: "What are the most important training implications from this race?",
      priority: 25,
      reason: "fallback_lessons"
    });
  }

  prompts.sort((a, b) => b.priority - a.priority);
  return prompts.slice(0, 5);
}
