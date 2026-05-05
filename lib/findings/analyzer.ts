// Analyzer contract + registry.
// Spec: tri.ai Findings Pipeline Spec §1.4 (Phase 1).
// Analyzers are pure functions. No DB, no LLM. Testable against synthetic ctx.

import type {
  AthletePhysModel,
  Finding,
  ResolvedIntent,
  SessionTimeseries
} from "./types";

export interface AnalyzerContext {
  session_id: string;
  intent: ResolvedIntent;
  timeseries: SessionTimeseries;
  physModel: AthletePhysModel;
  prior_findings?: Finding[];
}

export interface Analyzer {
  id: string;
  version: string;
  description: string;
  applies_to(ctx: AnalyzerContext): boolean;
  analyze(ctx: AnalyzerContext): Finding[];
}

export class AnalyzerRegistry {
  private analyzers: Analyzer[] = [];

  register(a: Analyzer): void {
    this.analyzers.push(a);
  }

  run(ctx: AnalyzerContext): Finding[] {
    return this.analyzers
      .filter((a) => a.applies_to(ctx))
      .flatMap((a) => {
        try {
          return a.analyze(ctx);
        } catch (e) {
          // Never let one analyzer break the pipeline.
          console.error(`[${a.id}] analyzer failed:`, e);
          return [];
        }
      });
  }
}
