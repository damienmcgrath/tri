// NormalizedPowerAnalyzer — Phase 1 parity wrapper.
// Reads the normalized_power and (when present) variability_index that the
// existing path stores into execution_result. Cycling-only.

import type { Analyzer, AnalyzerContext } from "../analyzer";
import type { Finding, FindingEvidence } from "../types";
import { asPhase1Context, isCyclingSport } from "./index";

const ID = "NormalizedPower";
const VERSION = "1.0.0";

export const NormalizedPowerAnalyzer: Analyzer = {
  id: ID,
  version: VERSION,
  description: "Reports normalized power (and VI when available) for cycling sessions.",

  applies_to(ctx: AnalyzerContext): boolean {
    if (!isCyclingSport(ctx.timeseries.sport)) return false;
    const phase1 = asPhase1Context(ctx);
    const np = phase1.diagnosisInput?.actual.metrics?.normalized_power;
    return typeof np === "number" && Number.isFinite(np) && np > 0;
  },

  analyze(ctx: AnalyzerContext): Finding[] {
    const phase1 = asPhase1Context(ctx);
    const metrics = phase1.diagnosisInput?.actual.metrics ?? {};
    const np = metrics.normalized_power;
    if (typeof np !== "number" || !Number.isFinite(np) || np <= 0) return [];

    const vi = typeof metrics.variability_index === "number" ? metrics.variability_index : null;
    const avgPower = typeof metrics.avg_power === "number" ? metrics.avg_power : null;

    const evidence: FindingEvidence[] = [
      { metric: "normalized_power", value: Math.round(np), unit: "W" }
    ];
    if (avgPower !== null) {
      evidence.push({ metric: "avg_power", value: Math.round(avgPower), unit: "W" });
    }
    if (vi !== null) {
      evidence.push({ metric: "variability_index", value: Number(vi.toFixed(2)) });
    }

    const reasoning = vi !== null
      ? `Normalized power ${Math.round(np)}W with variability index ${vi.toFixed(2)} reflects the metabolic cost of the ride.`
      : `Normalized power ${Math.round(np)}W reflects the effective metabolic cost of the ride.`;

    return [{
      id: "session.normalized_power",
      analyzer_id: ID,
      analyzer_version: VERSION,
      category: "execution",
      polarity: "observation",
      severity: 0,
      headline: `Normalized power ${Math.round(np)}W`,
      evidence,
      reasoning,
      scope: "session"
    }];
  }
};
