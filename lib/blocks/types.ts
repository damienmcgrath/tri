// Block detector type contracts.
// Spec: tri.ai Findings Pipeline Spec §3.5 (Phase 2).
//
// The base `SessionTimeseries` in @/lib/findings/types is intentionally
// minimal (sport + duration + has_* flags). The block detector needs the
// per-second sample stream that Phase 1 didn't model — we extend the base
// shape here rather than mutating the Phase 1 contract, so analyzers
// already typed against `SessionTimeseries` keep compiling.

import type { SessionTimeseries as BaseSessionTimeseries } from "@/lib/findings/types";
import type { IntendedBlock } from "@/lib/intent/types";

export interface TimeseriesSample {
  /** Seconds elapsed since the start of the session. Must be monotonically increasing. */
  t_sec: number;
  power?: number;
  hr?: number;
  cadence?: number;
  /** Pace in seconds per kilometre. */
  pace_sec_per_km?: number;
  /** Cumulative distance in metres at this sample. */
  distance_m?: number;
}

export interface AutoLap {
  start_sec: number;
  end_sec: number;
}

export interface BlockDetectorTimeseries extends BaseSessionTimeseries {
  samples: TimeseriesSample[];
  /** GPS / device auto-laps. Boundaries are snapped to these when within ±30s. */
  laps?: AutoLap[];
}

export interface BlockMetrics {
  /** 30-second rolling normalized power, in watts. */
  np?: number;
  /** Average power, in watts. */
  ap?: number;
  hr_avg?: number;
  hr_max?: number;
  cadence_avg?: number;
  /** Pace formatted as `m:ss` per kilometre. */
  pace_avg?: string;
  duration_sec: number;
  distance_m?: number;
}

export interface DetectedBlock {
  intended: IntendedBlock;
  start_sec: number;
  end_sec: number;
  metrics: BlockMetrics;
  /** Confidence the detected window matches the intended block. 0–1. */
  alignment_confidence: number;
  /** Free-text notes describing why confidence was reduced (or boosted). */
  alignment_notes?: string[];
}
