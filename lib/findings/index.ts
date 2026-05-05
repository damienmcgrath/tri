// Findings pipeline — public barrel.

export type {
  AthletePhysModel,
  Finding,
  FindingCategory,
  FindingEvidence,
  FindingPolarity,
  FindingPrescription,
  FindingSeverity,
  ResolvedIntent,
  SessionTimeseries,
  VisualType
} from "./types";

export type { Analyzer, AnalyzerContext } from "./analyzer";
export { AnalyzerRegistry } from "./analyzer";

export { analyzerRegistry, phase1Analyzers } from "./registry";

export {
  CompletionAnalyzer,
  DecouplingAnalyzer,
  IntensityComplianceAnalyzer,
  IntentMatchAnalyzer,
  NormalizedPowerAnalyzer,
  PacingConsistencyAnalyzer,
  TSSAnalyzer,
  asPhase1Context,
  isCyclingSport,
  isRunSport
} from "./analyzers";

export type { Phase1AnalyzerContext } from "./analyzers";
