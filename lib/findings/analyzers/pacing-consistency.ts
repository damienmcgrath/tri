// PacingConsistencyAnalyzer — Phase 1 parity wrapper.
// Reports the same VI / HR drift / pace fade signals the existing
// computePacingExecutionScore path inspects, packaged as a Finding.

import type { Analyzer, AnalyzerContext } from "../analyzer";
import type { Finding, FindingEvidence, FindingPolarity, FindingSeverity } from "../types";
import { asPhase1Context } from "./index";

const ID = "PacingConsistency";
const VERSION = "1.0.0";

type PacingFlag = {
  metric: string;
  value: number | string;
  unit?: string;
  weight: 0 | 1 | 2;
  note: string;
};

export const PacingConsistencyAnalyzer: Analyzer = {
  id: ID,
  version: VERSION,
  description: "Reports pacing consistency: variability index, HR drift, pace fade.",

  applies_to(ctx: AnalyzerContext): boolean {
    const phase1 = asPhase1Context(ctx);
    const actual = phase1.diagnosisInput?.actual;
    if (!actual) return false;
    if (typeof actual.variabilityIndex === "number") return true;
    const splits = actual.splitMetrics;
    if (splits?.firstHalfAvgHr && splits?.lastHalfAvgHr) return true;
    if (splits?.firstHalfPaceSPerKm && splits?.lastHalfPaceSPerKm) return true;
    if (splits?.firstHalfAvgPower && splits?.lastHalfAvgPower) return true;
    return false;
  },

  analyze(ctx: AnalyzerContext): Finding[] {
    const phase1 = asPhase1Context(ctx);
    const actual = phase1.diagnosisInput?.actual;
    if (!actual) return [];

    const evidence: FindingEvidence[] = [];
    const flags: PacingFlag[] = [];

    if (typeof actual.variabilityIndex === "number") {
      const vi = actual.variabilityIndex;
      evidence.push({
        metric: "variability_index",
        value: Number(vi.toFixed(2)),
        reference: "≤1.05 steady | 1.05-1.12 mixed | >1.12 surgy"
      });
      if (vi > 1.20) flags.push({ metric: "variability_index", value: Number(vi.toFixed(2)), weight: 2, note: "high variability" });
      else if (vi > 1.12) flags.push({ metric: "variability_index", value: Number(vi.toFixed(2)), weight: 1, note: "moderate variability" });
    }

    const splits = actual.splitMetrics;

    if (splits?.firstHalfAvgHr && splits?.lastHalfAvgHr) {
      const drift = splits.lastHalfAvgHr / splits.firstHalfAvgHr;
      const driftPct = (drift - 1) * 100;
      evidence.push({ metric: "first_half_hr", value: Math.round(splits.firstHalfAvgHr), unit: "bpm" });
      evidence.push({ metric: "last_half_hr", value: Math.round(splits.lastHalfAvgHr), unit: "bpm" });
      evidence.push({ metric: "hr_drift_pct", value: Number(driftPct.toFixed(1)), unit: "%" });
      if (drift > 1.08) flags.push({ metric: "hr_drift_pct", value: Number(driftPct.toFixed(1)), weight: 2, note: "significant HR drift" });
      else if (drift > 1.05) flags.push({ metric: "hr_drift_pct", value: Number(driftPct.toFixed(1)), weight: 1, note: "moderate HR drift" });
    }

    if (splits?.firstHalfPaceSPerKm && splits?.lastHalfPaceSPerKm) {
      const fade = splits.lastHalfPaceSPerKm / splits.firstHalfPaceSPerKm;
      const fadePct = (fade - 1) * 100;
      evidence.push({ metric: "first_half_pace_s_per_km", value: Math.round(splits.firstHalfPaceSPerKm), unit: "s/km" });
      evidence.push({ metric: "last_half_pace_s_per_km", value: Math.round(splits.lastHalfPaceSPerKm), unit: "s/km" });
      evidence.push({ metric: "pace_fade_pct", value: Number(fadePct.toFixed(1)), unit: "%" });
      if (fade > 1.15) flags.push({ metric: "pace_fade_pct", value: Number(fadePct.toFixed(1)), weight: 2, note: "significant pace fade" });
      else if (fade > 1.08) flags.push({ metric: "pace_fade_pct", value: Number(fadePct.toFixed(1)), weight: 1, note: "moderate pace fade" });
    }

    if (splits?.firstHalfAvgPower && splits?.lastHalfAvgPower) {
      const powerDrift = splits.lastHalfAvgPower / splits.firstHalfAvgPower;
      const powerDriftPct = (powerDrift - 1) * 100;
      evidence.push({ metric: "first_half_power", value: Math.round(splits.firstHalfAvgPower), unit: "W" });
      evidence.push({ metric: "last_half_power", value: Math.round(splits.lastHalfAvgPower), unit: "W" });
      evidence.push({ metric: "power_drift_pct", value: Number(powerDriftPct.toFixed(1)), unit: "%" });
    }

    if (evidence.length === 0) return [];

    const totalWeight = flags.reduce((sum, f) => sum + f.weight, 0);
    let polarity: FindingPolarity;
    let severity: FindingSeverity;
    if (totalWeight === 0) {
      polarity = "positive";
      severity = 0;
    } else if (totalWeight === 1) {
      polarity = "observation";
      severity = 1;
    } else if (totalWeight <= 3) {
      polarity = "concern";
      severity = 2;
    } else {
      polarity = "concern";
      severity = 3;
    }

    const headline = flags.length === 0
      ? "Pacing stayed controlled"
      : `Pacing issues: ${flags.map((f) => f.note).join(", ")}`;

    const reasoning = flags.length === 0
      ? "Variability and split halves stayed within steady-state thresholds."
      : `Detected ${flags.length} pacing flag(s): ${flags.map((f) => f.note).join(", ")}.`;

    return [{
      id: "session.pacing_consistency",
      analyzer_id: ID,
      analyzer_version: VERSION,
      category: "pacing",
      polarity,
      severity,
      headline,
      evidence,
      reasoning: reasoning.length > 240 ? reasoning.slice(0, 237) + "..." : reasoning,
      scope: "session"
    }];
  }
};
