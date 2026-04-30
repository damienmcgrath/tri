/**
 * Lap-level anomaly detection for a race-leg segment.
 *
 * Surfaces 0–3 events that deserve a callout in the diagnostic view. Each
 * anomaly is grounded in the lap data — we never guess. The four kinds:
 *
 *   - hr_spike           — single lap HR ≥ avg + 2σ (HR shock).
 *   - power_dropout      — bike: zero/sub-50W lap surrounded by working
 *                          laps (mechanical / dropped chain / coast).
 *   - pace_break         — lap pace ≥15% slower than median (likely
 *                          nutrition stop, mechanical, walk break).
 *   - cadence_drop       — run: cadence drops >10 spm in second half
 *                          relative to first (form breakdown).
 *
 * Returns at most 3 anomalies, ordered by severity. `atSec` is the offset
 * from the start of the leg (cumulative duration up to the lap), so the UI
 * can render a position marker.
 */

import { getMetricsV2Laps, type ActivityLapMetrics } from "@/lib/workouts/metrics-v2";
import type { RaceSegmentData } from "@/lib/race-review";

export type AnomalyType = "hr_spike" | "power_dropout" | "pace_break" | "cadence_drop";

export type Anomaly = {
  type: AnomalyType;
  atSec: number;
  observation: string;
};

const MAX_ANOMALIES = 3;
const HR_SPIKE_SIGMA = 2;
const POWER_DROPOUT_THRESHOLD_W = 50;
const PACE_BREAK_PCT = 15;
const CADENCE_DROP_SPM = 10;

export function detectLegAnomalies(segment: RaceSegmentData): Anomaly[] {
  const laps = getMetricsV2Laps(segment.metricsV2);
  if (laps.length < 3) return [];

  const offsets = cumulativeOffsets(laps);
  const found: Anomaly[] = [];

  found.push(...detectHrSpike(laps, offsets));
  if (segment.role === "bike") {
    found.push(...detectPowerDropouts(laps, offsets));
  }
  found.push(...detectPaceBreaks(laps, offsets, segment.role));
  if (segment.role === "run") {
    const cadenceDrop = detectCadenceDrop(laps, offsets);
    if (cadenceDrop) found.push(cadenceDrop);
  }

  // Severity ordering: power_dropout > hr_spike > pace_break > cadence_drop.
  const order: Record<AnomalyType, number> = {
    power_dropout: 0,
    hr_spike: 1,
    pace_break: 2,
    cadence_drop: 3
  };
  found.sort((a, b) => order[a.type] - order[b.type]);
  return found.slice(0, MAX_ANOMALIES);
}

function cumulativeOffsets(laps: ActivityLapMetrics[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const lap of laps) {
    out.push(acc);
    acc += lap.durationSec ?? 0;
  }
  return out;
}

function detectHrSpike(laps: ActivityLapMetrics[], offsets: number[]): Anomaly[] {
  const hrs = laps.map((l) => l.avgHr).filter((h): h is number => typeof h === "number" && h > 0);
  if (hrs.length < 4) return [];
  const mean = hrs.reduce((a, b) => a + b, 0) / hrs.length;
  const variance = hrs.reduce((a, b) => a + (b - mean) ** 2, 0) / hrs.length;
  const stddev = Math.sqrt(variance);
  if (stddev < 3) return []; // HR was too steady for "spike" to be meaningful.

  const spikeThreshold = mean + HR_SPIKE_SIGMA * stddev;
  // Pick the single largest spike.
  let maxIdx = -1;
  let maxHr = 0;
  for (let i = 0; i < laps.length; i++) {
    const hr = laps[i].avgHr;
    if (typeof hr === "number" && hr > spikeThreshold && hr > maxHr) {
      maxIdx = i;
      maxHr = hr;
    }
  }
  if (maxIdx < 0) return [];
  return [
    {
      type: "hr_spike",
      atSec: offsets[maxIdx],
      observation: `HR spiked to ${maxHr} bpm (avg ${Math.round(mean)} bpm) around ${formatOffset(offsets[maxIdx])}.`
    }
  ];
}

function detectPowerDropouts(laps: ActivityLapMetrics[], offsets: number[]): Anomaly[] {
  // A dropout = lap power < threshold, with both neighbours producing
  // meaningful power. We only report one dropout, the longest-duration.
  let bestIdx = -1;
  let bestDur = 0;
  for (let i = 1; i < laps.length - 1; i++) {
    const cur = laps[i].avgPower;
    const prev = laps[i - 1].avgPower;
    const next = laps[i + 1].avgPower;
    if (
      typeof cur === "number" &&
      cur < POWER_DROPOUT_THRESHOLD_W &&
      typeof prev === "number" &&
      prev >= POWER_DROPOUT_THRESHOLD_W * 2 &&
      typeof next === "number" &&
      next >= POWER_DROPOUT_THRESHOLD_W * 2
    ) {
      const dur = laps[i].durationSec ?? 0;
      if (dur > bestDur) {
        bestDur = dur;
        bestIdx = i;
      }
    }
  }
  if (bestIdx < 0) return [];
  const lap = laps[bestIdx];
  return [
    {
      type: "power_dropout",
      atSec: offsets[bestIdx],
      observation: `Power dropped to ${Math.round(lap.avgPower ?? 0)}W for ${Math.round(lap.durationSec ?? 0)}s around ${formatOffset(offsets[bestIdx])} — possible coast or mechanical.`
    }
  ];
}

function detectPaceBreaks(laps: ActivityLapMetrics[], offsets: number[], role: RaceSegmentData["role"]): Anomaly[] {
  const pickPace = (lap: ActivityLapMetrics): number | null => {
    if (role === "run") return lap.avgPaceSecPerKm ?? null;
    if (role === "swim") return lap.avgPacePer100mSec ?? null;
    return null;
  };

  const paces = laps.map(pickPace).filter((p): p is number => typeof p === "number" && p > 0);
  if (paces.length < 4) return [];
  const sorted = [...paces].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return [];

  let maxIdx = -1;
  let maxBreakPct = 0;
  for (let i = 0; i < laps.length; i++) {
    const pace = pickPace(laps[i]);
    if (pace === null) continue;
    const breakPct = ((pace - median) / median) * 100;
    if (breakPct >= PACE_BREAK_PCT && breakPct > maxBreakPct) {
      maxIdx = i;
      maxBreakPct = breakPct;
    }
  }
  if (maxIdx < 0) return [];
  return [
    {
      type: "pace_break",
      atSec: offsets[maxIdx],
      observation: `Pace broke to ${formatPace(pickPace(laps[maxIdx])!, role)} around ${formatOffset(offsets[maxIdx])} (median ${formatPace(median, role)}, ${maxBreakPct.toFixed(0)}% slower) — likely a stop or walk break.`
    }
  ];
}

function detectCadenceDrop(laps: ActivityLapMetrics[], offsets: number[]): Anomaly | null {
  const cadences = laps.map((l) => l.avgCadence ?? null);
  if (cadences.filter((c) => typeof c === "number" && c > 0).length < 4) return null;

  const totalDur = laps.reduce((sum, l) => sum + (l.durationSec ?? 0), 0);
  if (totalDur <= 0) return null;
  const half = totalDur / 2;
  let acc = 0;
  let splitIdx = 0;
  for (let i = 0; i < laps.length; i++) {
    acc += laps[i].durationSec ?? 0;
    if (acc >= half) {
      splitIdx = i + 1;
      break;
    }
  }
  splitIdx = Math.max(1, Math.min(splitIdx, laps.length - 1));

  const avg = (chunk: ActivityLapMetrics[]): number | null => {
    let weighted = 0;
    let weight = 0;
    for (const lap of chunk) {
      const c = lap.avgCadence;
      const d = lap.durationSec ?? 0;
      if (typeof c === "number" && c > 0 && d > 0) {
        weighted += c * d;
        weight += d;
      }
    }
    return weight > 0 ? weighted / weight : null;
  };

  const first = avg(laps.slice(0, splitIdx));
  const last = avg(laps.slice(splitIdx));
  if (first === null || last === null) return null;

  const drop = first - last;
  if (drop < CADENCE_DROP_SPM) return null;

  return {
    type: "cadence_drop",
    atSec: offsets[splitIdx] ?? Math.floor(totalDur / 2),
    observation: `Cadence dropped from ${Math.round(first)} → ${Math.round(last)} spm in the second half — form breakdown signal.`
  };
}

function formatOffset(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(sec: number, role: RaceSegmentData["role"]): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  const suffix = role === "swim" ? " /100m" : " /km";
  return `${m}:${String(s).padStart(2, "0")}${suffix}`;
}
