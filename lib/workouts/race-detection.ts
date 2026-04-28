import type { RaceSegmentRole } from "./activity-parser";

export type RaceCandidate = {
  id: string;
  sport: string;
  startUtc: string;
  durationSec: number;
};

type DisciplineRole = "swim" | "bike" | "run";

export type RaceDetectionResult =
  | {
      matched: true;
      orderedSegments: Array<{
        id: string;
        role: RaceSegmentRole;
        startUtc: string;
        durationSec: number;
        index: number;
      }>;
    }
  | {
      matched: false;
      reason: string;
    };

export type RaceDetectionOptions = {
  /** Maximum gap (seconds) between adjacent segments. Default 600 (10 min). */
  maxGapSec?: number;
  /** Maximum duration of an inferred transition. Default 600 (10 min). */
  maxTransitionDurationSec?: number;
  /** Optional planned-session duration in minutes — total within ±50% if provided. */
  plannedDurationMin?: number | null;
};

const DEFAULTS = {
  maxGapSec: 600,
  maxTransitionDurationSec: 600
} as const;

const TRANSITION_SPORT_TOKENS = ["transition", "other", "strength", "workout", "weight"];

function classifyDiscipline(sport: string): DisciplineRole | null {
  const s = sport.toLowerCase();
  if (s.includes("swim")) return "swim";
  if (s.includes("cycl") || s.includes("bike") || s.includes("ride")) return "bike";
  if (s.includes("run")) return "run";
  return null;
}

function looksLikeTransition(sport: string): boolean {
  const s = sport.toLowerCase();
  if (s === "transition") return true;
  return TRANSITION_SPORT_TOKENS.some((token) => s.includes(token));
}

function endMs(c: RaceCandidate): number {
  return new Date(c.startUtc).getTime() + Math.max(0, c.durationSec) * 1000;
}

export function detectRaceBundle(
  candidates: RaceCandidate[],
  options: RaceDetectionOptions = {}
): RaceDetectionResult {
  const opts = { ...DEFAULTS, ...options };

  if (candidates.length < 3) {
    return { matched: false, reason: "fewer_than_three_candidates" };
  }

  const sorted = [...candidates].sort(
    (a, b) => new Date(a.startUtc).getTime() - new Date(b.startUtc).getTime()
  );

  // Find first swim, the bike that follows it, and the run that follows the bike.
  const swimIdx = sorted.findIndex((c) => classifyDiscipline(c.sport) === "swim");
  if (swimIdx === -1) return { matched: false, reason: "no_swim" };

  const bikeIdx = sorted.findIndex(
    (c, i) => i > swimIdx && classifyDiscipline(c.sport) === "bike"
  );
  if (bikeIdx === -1) return { matched: false, reason: "no_bike_after_swim" };

  const runIdx = sorted.findIndex(
    (c, i) => i > bikeIdx && classifyDiscipline(c.sport) === "run"
  );
  if (runIdx === -1) return { matched: false, reason: "no_run_after_bike" };

  // Items between disciplines must be plausible transitions.
  const t1Slice = sorted.slice(swimIdx + 1, bikeIdx);
  const t2Slice = sorted.slice(bikeIdx + 1, runIdx);

  for (const t of [...t1Slice, ...t2Slice]) {
    if (!looksLikeTransition(t.sport)) {
      return { matched: false, reason: `unexpected_segment_${t.sport}` };
    }
    if (t.durationSec > opts.maxTransitionDurationSec) {
      return { matched: false, reason: "transition_too_long" };
    }
  }

  // Gap checks between adjacent included segments (swim → ...t1... → bike → ...t2... → run).
  const path = [sorted[swimIdx], ...t1Slice, sorted[bikeIdx], ...t2Slice, sorted[runIdx]];
  for (let i = 1; i < path.length; i += 1) {
    const gapSec = (new Date(path[i].startUtc).getTime() - endMs(path[i - 1])) / 1000;
    if (gapSec > opts.maxGapSec) {
      return { matched: false, reason: "gap_too_long" };
    }
  }

  // Optional: total duration within ±50% of planned.
  if (typeof opts.plannedDurationMin === "number" && opts.plannedDurationMin > 0) {
    const totalSec = path.reduce((sum, c) => sum + Math.max(0, c.durationSec), 0);
    const plannedSec = opts.plannedDurationMin * 60;
    const ratio = totalSec / plannedSec;
    if (ratio < 0.5 || ratio > 1.5) {
      return { matched: false, reason: "duration_out_of_range" };
    }
  }

  // Assign roles.
  const orderedSegments: Array<{ id: string; role: RaceSegmentRole; startUtc: string; durationSec: number; index: number }> = [];
  let nextIndex = 0;
  const push = (c: RaceCandidate, role: RaceSegmentRole) => {
    orderedSegments.push({ id: c.id, role, startUtc: c.startUtc, durationSec: c.durationSec, index: nextIndex });
    nextIndex += 1;
  };

  push(sorted[swimIdx], "swim");
  for (const t of t1Slice) push(t, "t1");
  push(sorted[bikeIdx], "bike");
  for (const t of t2Slice) push(t, "t2");
  push(sorted[runIdx], "run");

  return { matched: true, orderedSegments };
}
