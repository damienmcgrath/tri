/**
 * Unified pacing arc series builder.
 *
 * Builds the data backing the single chart that spans the full race timeline:
 *   - HR continuous across all legs
 *   - Power overlaid on the bike segment
 *   - Pace overlaid on the run segment
 *   - Vertical guides at sport transitions
 *   - Optional threshold-HR reference line (athlete's own value, when known)
 *
 * Resolution is lap-level — the source data we have. For Strava-stitched
 * bundles where T1/T2 are inferred from gaps, we mark `inferredGaps = true`
 * so the renderer shows them as visible discontinuities (honesty over
 * aesthetics).
 *
 * The output is persisted in `race_reviews.pacing_arc_data` so the chart
 * loads in the same fetch as the narrative and renders consistently with
 * the data the AI was given.
 */

import { getMetricsV2Laps } from "@/lib/workouts/metrics-v2";
import type { RaceSegmentData, RaceSegmentRole } from "@/lib/race-review";

export type PacingArcPoint = {
  /** Cumulative seconds from race start. */
  tSec: number;
  role: RaceSegmentRole;
  hr: number | null;
  power: number | null;
  /** Run pace as sec/km, swim pace as sec/100m. Null elsewhere. */
  paceSec: number | null;
};

export type PacingArcTransition = {
  role: "t1" | "t2";
  startSec: number;
  endSec: number;
  inferred: boolean;
};

export type PacingArcData = {
  totalDurationSec: number;
  points: PacingArcPoint[];
  transitions: PacingArcTransition[];
  legBoundaries: Array<{ role: RaceSegmentRole; startSec: number; endSec: number }>;
  inferredGaps: boolean;
  /** Threshold HR in bpm. Null when the athlete hasn't set one. */
  thresholdHrBpm: number | null;
};

export type BuildPacingArcArgs = {
  segments: RaceSegmentData[];
  /** Source flag — `strava_reconstructed` may have inferred transitions. */
  inferredTransitions: boolean;
  thresholdHrBpm: number | null;
};

export function buildPacingArcData(args: BuildPacingArcArgs): PacingArcData {
  const { segments, inferredTransitions, thresholdHrBpm } = args;

  const sorted = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex);

  const points: PacingArcPoint[] = [];
  const transitions: PacingArcTransition[] = [];
  const legBoundaries: PacingArcData["legBoundaries"] = [];

  let cursorSec = 0;

  for (const segment of sorted) {
    const startSec = cursorSec;
    const endSec = cursorSec + segment.durationSec;

    if (segment.role === "t1" || segment.role === "t2") {
      transitions.push({
        role: segment.role,
        startSec,
        endSec,
        inferred: inferredTransitions
      });
      cursorSec = endSec;
      continue;
    }

    legBoundaries.push({ role: segment.role, startSec, endSec });

    // Build per-lap points using metrics_v2.laps when present. Each lap gets
    // a single point at its midpoint to keep the series compact.
    const laps = getMetricsV2Laps(segment.metricsV2);
    if (laps.length > 0) {
      let lapCursor = 0;
      for (const lap of laps) {
        const lapDur = Number(lap.durationSec ?? 0);
        if (lapDur <= 0) continue;
        const midSec = startSec + lapCursor + lapDur / 2;
        points.push({
          tSec: round1(midSec),
          role: segment.role,
          hr: nonNeg(lap.avgHr),
          power: segment.role === "bike" ? nonNeg(lap.avgPower) : null,
          paceSec:
            segment.role === "run"
              ? nonNeg(lap.avgPaceSecPerKm ?? null)
              : segment.role === "swim"
                ? nonNeg(lap.avgPacePer100mSec ?? null)
                : null
        });
        lapCursor += lapDur;
      }
    } else {
      // Fallback: a single segment-level point at the midpoint so the
      // continuous-HR line still threads through the leg.
      points.push({
        tSec: round1(startSec + segment.durationSec / 2),
        role: segment.role,
        hr: nonNeg(segment.avgHr),
        power: segment.role === "bike" ? nonNeg(segment.avgPower) : null,
        paceSec: null
      });
    }

    cursorSec = endSec;
  }

  // Sort points by time so renderers can iterate without resorting.
  points.sort((a, b) => a.tSec - b.tSec);

  return {
    totalDurationSec: cursorSec,
    points,
    transitions,
    legBoundaries,
    inferredGaps: inferredTransitions && transitions.length > 0,
    thresholdHrBpm
  };
}

function nonNeg(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
