// Phase 1 analyzers — barrel exports plus the shared context wrapper.
// Spec: tri.ai Findings Pipeline Spec §1.4 / §2.3.
//
// The base AnalyzerContext from ./analyzer carries only minimal Phase 1 stubs
// (sport, duration_sec, has_*). Reusing the existing metric path requires the
// pre-built SessionDiagnosisInput, so we extend the base context with an
// optional `diagnosisInput` field. Phase 1 callers attach it; Phase 2 will
// replace this with real per-second timeseries.

import type { SessionDiagnosisInput } from "@/lib/coach/session-diagnosis";
import type { DetectedBlock } from "@/lib/blocks/types";
import type { AnalyzerContext } from "../analyzer";

export interface Phase1AnalyzerContext extends AnalyzerContext {
  diagnosisInput?: SessionDiagnosisInput;
  /**
   * Detected execution blocks from the Phase 2 block detector.
   * Populated only when a ResolvedIntent with non-empty `blocks` and a
   * non-`steady` structure has been resolved against the session.
   */
  detectedBlocks?: DetectedBlock[];
}

export function asPhase1Context(ctx: AnalyzerContext): Phase1AnalyzerContext {
  return ctx as Phase1AnalyzerContext;
}

export function isCyclingSport(sport: string): boolean {
  return sport === "bike" || sport === "cycling";
}

export function isRunSport(sport: string): boolean {
  return sport === "run" || sport === "running";
}

export { NormalizedPowerAnalyzer } from "./normalized-power";
export { TSSAnalyzer } from "./tss";
export { DecouplingAnalyzer } from "./decoupling";
export { CompletionAnalyzer } from "./completion";
export { IntentMatchAnalyzer } from "./intent-match";
export { IntensityComplianceAnalyzer } from "./intensity-compliance";
export { PacingConsistencyAnalyzer } from "./pacing-consistency";
