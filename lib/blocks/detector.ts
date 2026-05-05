// Pure-function block detector — Findings Pipeline Spec §3.5 (Phase 2).
//
// Maps an `IntendedBlock[]` plan onto an actual `BlockDetectorTimeseries` by
// fuzzy-matching boundaries against the per-second power (or HR fallback)
// signal. No DB, no LLM, no async work — fully deterministic and testable
// against synthetic fixtures.

import type { IntendedBlock } from "@/lib/intent/types";
import type {
  AutoLap,
  BlockDetectorTimeseries,
  BlockMetrics,
  DetectedBlock,
  TimeseriesSample,
} from "./types";

const BOUNDARY_SEARCH_WINDOW_SEC = 120; // ±2 min per spec
const ROLLING_WINDOW_SEC = 30;
const LAP_SNAP_TOLERANCE_SEC = 30;

interface PerSecondGrid {
  totalDuration: number;
  power: Float64Array;
  hr: Float64Array;
  cadence: Float64Array;
  paceSecPerKm: Float64Array;
  distance: Float64Array;
  hasPower: Uint8Array;
  hasHr: Uint8Array;
  hasCadence: Uint8Array;
  hasPace: Uint8Array;
  hasDistance: Uint8Array;
  anyPower: boolean;
  anyHr: boolean;
}

/**
 * Detect actual block boundaries from intended structure + timeseries.
 *
 * Algorithm (spec §3.5, in order):
 *   1. Compute target start/end in seconds from cumulative intended durations.
 *   2. For each internal boundary, search ±2-min window for the cleanest power
 *      transition (largest |Δ| in 30s-rolling NP). Falls back to HR when no
 *      power data is present.
 *   3. If `target_watts` is set, validate the windowed NP against the tolerance
 *      and set `alignment_confidence` from the overlap.
 *   4. Snap boundaries to GPS auto-laps if within ±30s.
 *   5. Compute per-block metrics once boundaries settle.
 */
export function detectBlocks(
  intended: IntendedBlock[],
  timeseries: BlockDetectorTimeseries,
): DetectedBlock[] {
  if (intended.length === 0) return [];
  const totalDuration = Math.max(0, Math.floor(timeseries.duration_sec ?? 0));
  if (totalDuration === 0) return [];

  const sortedIntended = [...intended].sort((a, b) => a.index - b.index);
  const grid = buildPerSecondGrid(timeseries.samples ?? [], totalDuration);

  // Step 1 — cumulative target boundaries.
  const targets = buildTargetBoundaries(sortedIntended, totalDuration);

  // Step 2 — pick a signal and find the best transition near each internal
  // boundary. Prefer power; fall back to HR when power is absent.
  const usingHr = !grid.anyPower && grid.anyHr;
  const signal = usingHr
    ? compute30sRollingMean(grid.hr, grid.hasHr)
    : compute30sRollingNp(grid.power, grid.hasPower);

  const adjusted: number[] = [targets[0]];
  for (let i = 1; i < targets.length - 1; i++) {
    const targetSec = targets[i];
    const lastAdjusted = adjusted[adjusted.length - 1];
    const nextTarget = targets[i + 1];
    const lo = Math.max(lastAdjusted + 1, targetSec - BOUNDARY_SEARCH_WINDOW_SEC);
    const hi = Math.min(nextTarget - 1, targetSec + BOUNDARY_SEARCH_WINDOW_SEC);
    let detected = targetSec;
    if (signal && hi >= lo) {
      const found = findMaxTransition(signal, lo, hi, totalDuration);
      detected = found.t;
    }
    // Guarantee monotonicity even when the search window collapsed.
    detected = Math.max(lastAdjusted + 1, Math.min(detected, nextTarget - 1));
    adjusted.push(detected);
  }
  adjusted.push(targets[targets.length - 1]);

  // Step 4 — snap to GPS auto-laps if within ±30s. Only internal boundaries
  // are eligible, and we never break monotonicity.
  const lapBoundaries = collectLapBoundaries(timeseries.laps ?? []);
  const snappedTo = new Array<number | null>(adjusted.length).fill(null);
  for (let i = 1; i < adjusted.length - 1; i++) {
    const candidate = nearestLapBoundary(adjusted[i], lapBoundaries, LAP_SNAP_TOLERANCE_SEC);
    if (candidate === null) continue;
    if (candidate <= adjusted[i - 1] || candidate >= adjusted[i + 1]) continue;
    snappedTo[i] = candidate;
    adjusted[i] = candidate;
  }

  // Steps 3 + 5 — per-block metrics + alignment confidence.
  return sortedIntended.map((block, i) => {
    const startSec = adjusted[i];
    const endSec = adjusted[i + 1];
    const targetStart = targets[i];
    const targetEnd = targets[i + 1];
    const metrics = computeBlockMetrics(grid, startSec, endSec);
    const { confidence, notes } = computeAlignmentConfidence({
      block,
      targetStart,
      targetEnd,
      startSec,
      endSec,
      metrics,
      startSnapped: snappedTo[i] !== null,
      endSnapped: snappedTo[i + 1] !== null,
      anyPower: grid.anyPower,
      usingHr,
    });
    const detected: DetectedBlock = {
      intended: block,
      start_sec: startSec,
      end_sec: endSec,
      metrics,
      alignment_confidence: confidence,
    };
    if (notes.length > 0) detected.alignment_notes = notes;
    return detected;
  });
}

// ─── target boundary helpers ────────────────────────────────────────────────

function buildTargetBoundaries(blocks: IntendedBlock[], totalDuration: number): number[] {
  const boundaries: number[] = [0];
  let cumulative = 0;
  for (const b of blocks) {
    cumulative += Math.max(0, b.duration_min) * 60;
    boundaries.push(Math.min(totalDuration, Math.round(cumulative)));
  }
  // Ensure strict monotonicity. If two boundaries collide because the activity
  // is shorter than the plan, nudge later ones forward by 1s — the resulting
  // block still has duration ≥ 1 and downstream metrics will simply be empty.
  for (let i = 1; i < boundaries.length; i++) {
    if (boundaries[i] <= boundaries[i - 1]) {
      boundaries[i] = Math.min(totalDuration, boundaries[i - 1] + 1);
    }
  }
  return boundaries;
}

// ─── per-second grid + rolling signals ──────────────────────────────────────

function buildPerSecondGrid(samples: TimeseriesSample[], totalDuration: number): PerSecondGrid {
  const power = new Float64Array(totalDuration);
  const hr = new Float64Array(totalDuration);
  const cadence = new Float64Array(totalDuration);
  const paceSecPerKm = new Float64Array(totalDuration);
  const distance = new Float64Array(totalDuration);
  const hasPower = new Uint8Array(totalDuration);
  const hasHr = new Uint8Array(totalDuration);
  const hasCadence = new Uint8Array(totalDuration);
  const hasPace = new Uint8Array(totalDuration);
  const hasDistance = new Uint8Array(totalDuration);

  const sorted = [...samples].sort((a, b) => a.t_sec - b.t_sec);
  let cursor = -1;

  let anyPower = false;
  let anyHr = false;

  for (let t = 0; t < totalDuration; t++) {
    while (cursor + 1 < sorted.length && sorted[cursor + 1].t_sec <= t) cursor++;
    if (cursor < 0) continue;
    const s = sorted[cursor];
    if (typeof s.power === "number" && Number.isFinite(s.power)) {
      power[t] = s.power;
      hasPower[t] = 1;
      if (s.power > 0) anyPower = true;
    }
    if (typeof s.hr === "number" && Number.isFinite(s.hr)) {
      hr[t] = s.hr;
      hasHr[t] = 1;
      if (s.hr > 0) anyHr = true;
    }
    if (typeof s.cadence === "number" && Number.isFinite(s.cadence)) {
      cadence[t] = s.cadence;
      hasCadence[t] = 1;
    }
    if (typeof s.pace_sec_per_km === "number" && Number.isFinite(s.pace_sec_per_km) && s.pace_sec_per_km > 0) {
      paceSecPerKm[t] = s.pace_sec_per_km;
      hasPace[t] = 1;
    }
    if (typeof s.distance_m === "number" && Number.isFinite(s.distance_m)) {
      distance[t] = s.distance_m;
      hasDistance[t] = 1;
    }
  }

  return {
    totalDuration,
    power,
    hr,
    cadence,
    paceSecPerKm,
    distance,
    hasPower,
    hasHr,
    hasCadence,
    hasPace,
    hasDistance,
    anyPower,
    anyHr,
  };
}

function compute30sRollingNp(values: Float64Array, has: Uint8Array): Float64Array | null {
  const n = values.length;
  if (n === 0) return null;
  const result = new Float64Array(n);
  let any = false;
  let sum4 = 0;
  const queue: number[] = [];
  for (let t = 0; t < n; t++) {
    const v = has[t] ? values[t] : 0;
    if (has[t] && v > 0) any = true;
    queue.push(v);
    sum4 += Math.pow(v, 4);
    if (queue.length > ROLLING_WINDOW_SEC) {
      sum4 -= Math.pow(queue.shift()!, 4);
    }
    const mean4 = sum4 / queue.length;
    result[t] = Math.pow(Math.max(0, mean4), 0.25);
  }
  return any ? result : null;
}

function compute30sRollingMean(values: Float64Array, has: Uint8Array): Float64Array | null {
  const n = values.length;
  if (n === 0) return null;
  const result = new Float64Array(n);
  let any = false;
  let sum = 0;
  const queue: number[] = [];
  for (let t = 0; t < n; t++) {
    const v = has[t] ? values[t] : 0;
    if (has[t] && v > 0) any = true;
    queue.push(v);
    sum += v;
    if (queue.length > ROLLING_WINDOW_SEC) sum -= queue.shift()!;
    result[t] = sum / queue.length;
  }
  return any ? result : null;
}

function findMaxTransition(
  signal: Float64Array,
  lo: number,
  hi: number,
  totalDuration: number,
): { t: number; delta: number } {
  // The signal is the right-aligned 30s rolling average ending at index t.
  // signal[t]            ⇢ mean of [t-29 .. t]    (the "before" window)
  // signal[t+30]         ⇢ mean of [t+1 .. t+30]  (the "after" window)
  // |Δ| of these two values is the cleanest descriptor of a transition AT t.
  let bestT = lo;
  let bestDelta = -Infinity;
  for (let t = lo; t <= hi; t++) {
    const beforeIdx = Math.max(0, Math.min(totalDuration - 1, t));
    const afterIdx = Math.max(0, Math.min(totalDuration - 1, t + ROLLING_WINDOW_SEC));
    const delta = Math.abs(signal[afterIdx] - signal[beforeIdx]);
    if (delta > bestDelta) {
      bestDelta = delta;
      bestT = t;
    }
  }
  return { t: bestT, delta: bestDelta === -Infinity ? 0 : bestDelta };
}

// ─── GPS lap snap helpers ───────────────────────────────────────────────────

function collectLapBoundaries(laps: AutoLap[]): number[] {
  const set = new Set<number>();
  for (const lap of laps) {
    if (Number.isFinite(lap.start_sec)) set.add(Math.round(lap.start_sec));
    if (Number.isFinite(lap.end_sec)) set.add(Math.round(lap.end_sec));
  }
  return [...set].sort((a, b) => a - b);
}

function nearestLapBoundary(
  candidate: number,
  lapBoundaries: number[],
  toleranceSec: number,
): number | null {
  let best: number | null = null;
  let bestDist = toleranceSec + 1;
  for (const lap of lapBoundaries) {
    const dist = Math.abs(lap - candidate);
    if (dist <= toleranceSec && dist < bestDist) {
      bestDist = dist;
      best = lap;
    }
  }
  return best;
}

// ─── per-block metrics ──────────────────────────────────────────────────────

function computeBlockMetrics(grid: PerSecondGrid, startSec: number, endSec: number): BlockMetrics {
  const lo = Math.max(0, Math.floor(startSec));
  const hi = Math.min(grid.totalDuration, Math.floor(endSec));
  const duration = Math.max(0, endSec - startSec);

  const result: BlockMetrics = { duration_sec: duration };
  if (hi <= lo) return result;

  let powerSum = 0;
  let powerSamples = 0;
  let hrSum = 0;
  let hrSamples = 0;
  let hrMax = -Infinity;
  let cadenceSum = 0;
  let cadenceSamples = 0;
  let paceSum = 0;
  let paceSamples = 0;

  // 30s rolling NP within the slice.
  let rollingSum = 0;
  let rolling4Sum = 0;
  const rollingQueue: number[] = [];
  let rolling4Count = 0;

  for (let t = lo; t < hi; t++) {
    if (grid.hasPower[t]) {
      powerSum += grid.power[t];
      powerSamples++;
    }
    if (grid.hasHr[t]) {
      hrSum += grid.hr[t];
      if (grid.hr[t] > hrMax) hrMax = grid.hr[t];
      hrSamples++;
    }
    if (grid.hasCadence[t]) {
      cadenceSum += grid.cadence[t];
      cadenceSamples++;
    }
    if (grid.hasPace[t]) {
      paceSum += grid.paceSecPerKm[t];
      paceSamples++;
    }

    if (grid.anyPower) {
      const p = grid.hasPower[t] ? grid.power[t] : 0;
      rollingQueue.push(p);
      rollingSum += p;
      if (rollingQueue.length > ROLLING_WINDOW_SEC) rollingSum -= rollingQueue.shift()!;
      const rollingAvg = rollingSum / rollingQueue.length;
      rolling4Sum += Math.pow(rollingAvg, 4);
      rolling4Count++;
    }
  }

  if (powerSamples > 0) result.ap = Math.round(powerSum / powerSamples);
  if (rolling4Count > 0 && powerSamples > 0) {
    const np = Math.pow(Math.max(0, rolling4Sum / rolling4Count), 0.25);
    result.np = Math.round(np);
  }
  if (hrSamples > 0) {
    result.hr_avg = Math.round(hrSum / hrSamples);
    result.hr_max = Math.round(hrMax);
  }
  if (cadenceSamples > 0) result.cadence_avg = Math.round(cadenceSum / cadenceSamples);
  if (paceSamples > 0) result.pace_avg = formatPace(paceSum / paceSamples);

  // Distance is the cumulative delta across the slice; relies on samples having
  // a monotonically-increasing distance_m field. Fall back to undefined when
  // either endpoint is missing.
  if (grid.hasDistance[lo] && grid.hasDistance[Math.max(lo, hi - 1)]) {
    const startD = grid.distance[lo];
    const endD = grid.distance[Math.max(lo, hi - 1)];
    result.distance_m = Math.max(0, Math.round(endD - startD));
  }

  return result;
}

function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return "0:00";
  const total = Math.round(secPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// ─── alignment confidence ───────────────────────────────────────────────────

interface ConfidenceArgs {
  block: IntendedBlock;
  targetStart: number;
  targetEnd: number;
  startSec: number;
  endSec: number;
  metrics: BlockMetrics;
  startSnapped: boolean;
  endSnapped: boolean;
  anyPower: boolean;
  usingHr: boolean;
}

function computeAlignmentConfidence(args: ConfidenceArgs): { confidence: number; notes: string[] } {
  const notes: string[] = [];
  let confidence = 1.0;

  // Boundary drift — how far did the detected window slide from the plan?
  const drift = (Math.abs(args.startSec - args.targetStart) + Math.abs(args.endSec - args.targetEnd)) / 2;
  if (drift > 0) {
    const driftPenalty = Math.min(drift / BOUNDARY_SEARCH_WINDOW_SEC, 1) * 0.2;
    confidence -= driftPenalty;
    if (drift >= 5) notes.push(`boundary drift ${Math.round(drift)}s vs plan`);
  }
  if (args.startSnapped) notes.push("start snapped to GPS auto-lap");
  if (args.endSnapped) notes.push("end snapped to GPS auto-lap");

  // Intensity validation — spec step 3.
  const targetWatts = args.block.target_watts;
  const targetHr = args.block.target_hr;
  let validatedAgainstTarget = false;

  if (targetWatts && args.metrics.np !== undefined) {
    validatedAgainstTarget = true;
    const [min, max] = targetWatts;
    const np = args.metrics.np;
    const range = Math.max(1, max - min);
    if (np < min) {
      const dist = (min - np) / range;
      const penalty = Math.min(1, dist) * 0.6;
      confidence -= penalty;
      notes.push(`NP ${np}W under target ${min}–${max}W`);
    } else if (np > max) {
      const dist = (np - max) / range;
      const penalty = Math.min(1, dist) * 0.6;
      confidence -= penalty;
      notes.push(`NP ${np}W over target ${min}–${max}W`);
    }
  } else if (targetWatts && !args.anyPower) {
    confidence -= 0.3;
    notes.push("target_watts set but no power data");
  } else if (targetHr && args.metrics.hr_avg !== undefined) {
    validatedAgainstTarget = true;
    const [min, max] = targetHr;
    const hr = args.metrics.hr_avg;
    const range = Math.max(1, max - min);
    if (hr < min) {
      const dist = (min - hr) / range;
      const penalty = Math.min(1, dist) * 0.4;
      confidence -= penalty;
      notes.push(`HR ${hr} under target ${min}–${max}`);
    } else if (hr > max) {
      const dist = (hr - max) / range;
      const penalty = Math.min(1, dist) * 0.4;
      confidence -= penalty;
      notes.push(`HR ${hr} over target ${min}–${max}`);
    }
  }

  if (!validatedAgainstTarget && !targetWatts && !targetHr) {
    // No tolerance to validate against — cap at 0.85 so callers know this
    // block was anchored only by structure, not intensity.
    if (confidence > 0.85) confidence = 0.85;
    notes.push("no target intensity to validate");
  }

  if (args.usingHr) {
    confidence -= 0.1;
    notes.push("boundaries inferred from HR (no power data)");
  }

  return {
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(3)))),
    notes,
  };
}
