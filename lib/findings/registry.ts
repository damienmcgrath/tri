// Findings registry — singleton with all Phase 1 analyzers registered.
// Spec: tri.ai Findings Pipeline Spec §1.4 / §2.3.

import { AnalyzerRegistry } from "./analyzer";
import {
  CompletionAnalyzer,
  DecouplingAnalyzer,
  IntensityComplianceAnalyzer,
  IntentMatchAnalyzer,
  NormalizedPowerAnalyzer,
  PacingConsistencyAnalyzer,
  TSSAnalyzer
} from "./analyzers";

function buildRegistry(): AnalyzerRegistry {
  const registry = new AnalyzerRegistry();
  registry.register(NormalizedPowerAnalyzer);
  registry.register(TSSAnalyzer);
  registry.register(DecouplingAnalyzer);
  registry.register(CompletionAnalyzer);
  registry.register(IntentMatchAnalyzer);
  registry.register(IntensityComplianceAnalyzer);
  registry.register(PacingConsistencyAnalyzer);
  return registry;
}

export const analyzerRegistry: AnalyzerRegistry = buildRegistry();

export const phase1Analyzers = [
  NormalizedPowerAnalyzer,
  TSSAnalyzer,
  DecouplingAnalyzer,
  CompletionAnalyzer,
  IntentMatchAnalyzer,
  IntensityComplianceAnalyzer,
  PacingConsistencyAnalyzer
];
