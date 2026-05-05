// Findings pipeline type contracts.
// Spec: tri.ai Findings Pipeline Spec §1.2 / §1.4 (Phase 1).
// Every analyzer in lib/findings/analyzers/* produces values typed here.

export type FindingPolarity = "positive" | "observation" | "concern";

export type FindingCategory =
  | "durability"
  | "pacing"
  | "execution"
  | "fatigue"
  | "technique"
  | "preparation";

export type FindingSeverity = 0 | 1 | 2 | 3;

export type VisualType =
  | "block_structure"
  | "quadrant"
  | "drift_bars"
  | "time_series"
  | "speed_per_watt"
  | "cadence_distribution"
  | "mmp_curve"
  | "sparkline";

export interface FindingEvidence {
  metric: string;
  value: number | string;
  unit?: string;
  reference?: string;
}

export interface FindingPrescription {
  text: string;
  target_value?: number;
  target_metric?: string;
  confidence: "high" | "medium" | "low";
}

export interface Finding {
  id: string;
  analyzer_id: string;
  analyzer_version: string;
  category: FindingCategory;
  polarity: FindingPolarity;
  severity: FindingSeverity;
  headline: string;
  evidence: FindingEvidence[];
  reasoning: string;
  prescription?: FindingPrescription;
  visual?: VisualType;
  conditional_on?: string[];
  scope: "session" | "block" | "segment";
  scope_ref?: string;
}

// ResolvedIntent — Phase 2 owns the full schema. This is the minimal stub the
// Analyzer contract needs so Phase 1 can compile and ship independently.
export interface ResolvedIntent {
  source: "plan" | "athlete_described" | "inferred" | "open";
  type: string;
  structure:
    | "steady"
    | "progressive"
    | "intervals"
    | "over_under"
    | "race_simulation"
    | "open";
}

// SessionTimeseries — no equivalent shape exists in lib/workouts/ yet
// (lib/workouts/* operates on parsed activity rows, not aligned timeseries).
// Defined here as a minimal interface so analyzers have stable typing in
// Phase 1; Phase 2's BlockDetector work will replace it with the real
// per-second sample shape.
export interface SessionTimeseries {
  sport: "cycling" | "run" | "swim" | string;
  duration_sec: number;
  has_power?: boolean;
  has_cadence?: boolean;
  has_hr?: boolean;
  terrain_class?: "flat" | "rolling" | "hilly";
}

export interface AthletePhysModel {
  ftp?: number;
  css?: number;
  threshold_pace?: number;
  hr_max?: number;
  weight?: number;
}
