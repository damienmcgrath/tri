/**
 * Cross-discipline insight gate — the moat.
 *
 * The AI must only narrate a connection across legs when the data clearly
 * supports it. This module detects supported hypotheses deterministically
 * and hands the AI a `{detected, hypothesis, evidence}` packet so its job
 * is wording, not invention. When no hypothesis is detected the field is
 * `null` and the AI is instructed to set crossDisciplineInsight to null.
 *
 * Hypotheses (ordered by precedence):
 *   1. bike_fade → run_hr_drift   (bike second half drops AND run HR drifts)
 *   2. swim_overcook → bike_under (swim rating ≤ 2 AND bike under target)
 *   3. run_fade_at_constant_pace  (run pace held but HR rose >6bpm; pure fitness)
 *
 * If the athlete's own notes contradict the hypothesis (e.g. notes mention
 * stomach issues from km 30), we suppress the inference and return null —
 * the athlete's account always wins. This is enforced in the orchestrator,
 * not here, by passing in the matched-issue list.
 */

import type { LegPacing } from "@/lib/race-review";

export type CrossDisciplineHypothesis =
  | "bike_fade_to_run_hr_drift"
  | "swim_overcook_to_bike_under"
  | "run_fade_at_constant_pace";

export type CrossDisciplineSignal =
  | { detected: false }
  | {
      detected: true;
      hypothesis: CrossDisciplineHypothesis;
      evidence: string[];
    };

export type CrossDisciplineInput = {
  bikePacing: LegPacing | undefined;
  runPacing: LegPacing | undefined;
  /** Run HR drift first-half → second-half in bpm (positive = HR rose). */
  runHrDriftBpm: number | null;
  /** Athlete's 1–5 rating for the swim, if captured. */
  swimRating: number | null;
  /**
   * True when the athlete's notes mention a discrete event (illness, GI,
   * mechanical, crash). When true, all hypotheses are suppressed — the
   * athlete's account wins.
   */
  athleteAccountSuppresses: boolean;
};

export function detectCrossDisciplineSignal(input: CrossDisciplineInput): CrossDisciplineSignal {
  if (input.athleteAccountSuppresses) {
    return { detected: false };
  }

  const bike = input.bikePacing?.halvesAvailable ? input.bikePacing : null;
  const run = input.runPacing?.halvesAvailable ? input.runPacing : null;

  // Bike "drop" (positive = bad) — bike unit is watts so drop = -deltaPct.
  const bikeDropPct = bike ? -bike.deltaPct : null;
  // Run "drop" — run unit is sec/km so drop = +deltaPct (slower second half).
  const runDropPct = run ? run.deltaPct : null;
  const runHrDrift = input.runHrDriftBpm;

  // ─── 1. bike_fade → run_hr_drift ────────────────────────────────────────
  // Bike second half eased ≥3% AND run HR drifted ≥4bpm with run pace ≤2%
  // slowdown (i.e. the athlete held pace but it cost them more cardiac work).
  if (
    bikeDropPct !== null &&
    bikeDropPct >= 3 &&
    runHrDrift !== null &&
    runHrDrift >= 4 &&
    runDropPct !== null &&
    runDropPct <= 2
  ) {
    return {
      detected: true,
      hypothesis: "bike_fade_to_run_hr_drift",
      evidence: [
        `Bike power eased ${bikeDropPct.toFixed(1)}% in the second half (${bike!.firstHalf}W → ${bike!.lastHalf}W).`,
        `Run HR drifted +${runHrDrift} bpm at near-constant pace (${signed(runDropPct)}%).`
      ]
    };
  }

  // ─── 2. swim_overcook → bike_under ──────────────────────────────────────
  // Athlete rated swim ≤2 AND bike average came in materially under target —
  // checked via bike pacing showing first-half AT or BELOW target floor.
  // We use a simple proxy here: if bike pacing fades AND swim rating is low,
  // the swim cooking is a plausible cause, but only when no athlete-account
  // override applies (suppressed above).
  if (
    input.swimRating !== null &&
    input.swimRating <= 2 &&
    bikeDropPct !== null &&
    bikeDropPct >= 3
  ) {
    return {
      detected: true,
      hypothesis: "swim_overcook_to_bike_under",
      evidence: [
        `Swim rated ${input.swimRating}/5 by the athlete.`,
        `Bike power eased ${bikeDropPct.toFixed(1)}% across halves (${bike!.firstHalf}W → ${bike!.lastHalf}W).`
      ]
    };
  }

  // ─── 3. run_fade_at_constant_pace ───────────────────────────────────────
  // Run pace held within ±2% but HR rose ≥6 bpm — classic fitness/heat fade
  // with no upstream cause. Only fire when bike was clean (no fade), so we
  // don't compete with hypothesis 1.
  if (
    runDropPct !== null &&
    Math.abs(runDropPct) <= 2 &&
    runHrDrift !== null &&
    runHrDrift >= 6 &&
    (bikeDropPct === null || bikeDropPct < 3)
  ) {
    return {
      detected: true,
      hypothesis: "run_fade_at_constant_pace",
      evidence: [
        `Run pace held within ${Math.abs(runDropPct).toFixed(1)}% across halves.`,
        `Run HR drifted +${runHrDrift} bpm.`
      ]
    };
  }

  return { detected: false };
}

function signed(n: number): string {
  if (n === 0) return "0.0";
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

const ATHLETE_ACCOUNT_PATTERNS: RegExp[] = [
  /\billness\b/i,
  /\binjur(y|ed)\b/i,
  /\bcrash(ed)?\b/i,
  /\bstomach\b/i,
  /\b(GI|gut)\b/i,
  /\bcramp(ed|s|ing)?\b/i,
  /\bsick\b/i,
  /\bdropped\s+chain\b/i,
  /\bflat\s+tire\b|\bpuncture\b/i,
  /\bmechanical\b/i,
  /\bdrop(ped)?\b/i // generic dropped-an-event
];

const ATHLETE_ACCOUNT_ISSUE_TAGS = new Set([
  "illness",
  "mechanical",
  "navigation"
]);

export function athleteAccountSuppressesInsight(args: {
  notes: string | null;
  issuesFlagged: string[];
}): boolean {
  if (args.issuesFlagged.some((tag) => ATHLETE_ACCOUNT_ISSUE_TAGS.has(tag))) {
    return true;
  }
  if (args.notes && args.notes.trim().length > 0) {
    return ATHLETE_ACCOUNT_PATTERNS.some((rx) => rx.test(args.notes!));
  }
  return false;
}
