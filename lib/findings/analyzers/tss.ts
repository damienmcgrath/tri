// TSSAnalyzer — Phase 1 parity wrapper.
// Reports training stress score (or aerobic training effect when TSS is
// unavailable on swim/run telemetry). Mapped to the durability category per
// the composer prompt's "Load Contribution" section.

import type { Analyzer, AnalyzerContext } from "../analyzer";
import type { Finding, FindingEvidence, FindingPolarity, FindingSeverity } from "../types";
import { asPhase1Context } from "./index";

const ID = "TSS";
const VERSION = "1.0.0";

function severityForTss(tss: number): { polarity: FindingPolarity; severity: FindingSeverity } {
  if (tss >= 200) return { polarity: "concern", severity: 2 };
  if (tss >= 120) return { polarity: "observation", severity: 1 };
  return { polarity: "observation", severity: 0 };
}

export const TSSAnalyzer: Analyzer = {
  id: ID,
  version: VERSION,
  description: "Reports training stress score for load accounting.",

  applies_to(ctx: AnalyzerContext): boolean {
    const phase1 = asPhase1Context(ctx);
    const tss = phase1.diagnosisInput?.actual.metrics?.training_stress_score;
    return typeof tss === "number" && Number.isFinite(tss) && tss > 0;
  },

  analyze(ctx: AnalyzerContext): Finding[] {
    const phase1 = asPhase1Context(ctx);
    const metrics = phase1.diagnosisInput?.actual.metrics ?? {};
    const tss = metrics.training_stress_score;
    if (typeof tss !== "number" || !Number.isFinite(tss) || tss <= 0) return [];

    const evidence: FindingEvidence[] = [
      { metric: "training_stress_score", value: Math.round(tss), unit: "TSS" }
    ];
    const intensityFactor = typeof metrics.intensity_factor === "number" ? metrics.intensity_factor : null;
    if (intensityFactor !== null) {
      evidence.push({ metric: "intensity_factor", value: Number(intensityFactor.toFixed(2)) });
    }
    const totalWorkKj = typeof metrics.total_work_kj === "number" ? metrics.total_work_kj : null;
    if (totalWorkKj !== null) {
      evidence.push({ metric: "total_work_kj", value: Math.round(totalWorkKj), unit: "kJ" });
    }

    const { polarity, severity } = severityForTss(tss);
    const headline = `TSS ${Math.round(tss)}`;
    const reasoning = `Training stress score ${Math.round(tss)} captures this session's contribution to weekly load.`;

    return [{
      id: "session.tss",
      analyzer_id: ID,
      analyzer_version: VERSION,
      category: "durability",
      polarity,
      severity,
      headline,
      evidence,
      reasoning,
      scope: "session"
    }];
  }
};
