// Resolved intent type contracts.
// Spec: tri.ai Findings Pipeline Spec §3.2 (Phase 2).
// Every Phase 2 consumer (intent parser, block detector, analyzers, prompt
// composer) imports `ResolvedIntent` and `IntendedBlock` from this module.

export type SessionIntentType =
  | "endurance"
  | "tempo"
  | "threshold"
  | "vo2"
  | "race_prep"
  | "recovery"
  | "open"
  | "race_simulation";

export type SessionStructure =
  | "steady"
  | "progressive"
  | "intervals"
  | "over_under"
  | "race_simulation"
  | "open";

export type IntentSource = "plan" | "athlete_described" | "inferred" | "open";

export type IntendedBlockType = "warmup" | "work" | "easy" | "cooldown" | "tail";

export interface IntendedBlock {
  index: number;
  duration_min: number;
  type: IntendedBlockType;
  target_watts?: [number, number];
  target_hr?: [number, number];
  target_pace?: [string, string];
  target_rpe?: number;
  description?: string;
}

export interface ResolvedIntent {
  source: IntentSource;
  type: SessionIntentType;
  structure: SessionStructure;
  blocks?: IntendedBlock[];
  athlete_notes?: string;
  resolved_at: string;
  parser_version?: string;
}
