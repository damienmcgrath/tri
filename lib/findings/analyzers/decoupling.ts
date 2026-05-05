// DecouplingAnalyzer — Phase 1 parity wrapper.
// Wraps computeAerobicDecoupling from lib/analytics/session-signals so the
// Findings pipeline emits the same percent + severity that the existing
// extendedSignals.aerobicDecoupling path surfaces today.

import { computeAerobicDecoupling } from "@/lib/analytics/session-signals";
import type { Analyzer, AnalyzerContext } from "../analyzer";
import type { Finding, FindingEvidence, FindingPolarity, FindingSeverity } from "../types";
import { asPhase1Context, isCyclingSport, isRunSport } from "./index";

const ID = "Decoupling";
const VERSION = "1.0.0";

function polarityFor(severity: "stable" | "mild_drift" | "significant_drift" | "poor_durability"): {
  polarity: FindingPolarity;
  severityLevel: FindingSeverity;
} {
  switch (severity) {
    case "stable":
      return { polarity: "positive", severityLevel: 0 };
    case "mild_drift":
      return { polarity: "observation", severityLevel: 1 };
    case "significant_drift":
      return { polarity: "concern", severityLevel: 2 };
    case "poor_durability":
      return { polarity: "concern", severityLevel: 3 };
  }
}

export const DecouplingAnalyzer: Analyzer = {
  id: ID,
  version: VERSION,
  description: "Aerobic decoupling between session halves (cardiac drift vs output).",

  applies_to(ctx: AnalyzerContext): boolean {
    const sport = ctx.timeseries.sport;
    if (!isCyclingSport(sport) && !isRunSport(sport)) return false;
    const phase1 = asPhase1Context(ctx);
    const splits = phase1.diagnosisInput?.actual.splitMetrics;
    if (!splits) return false;
    if (!splits.firstHalfAvgHr || !splits.lastHalfAvgHr) return false;
    if (isCyclingSport(sport)) {
      return Boolean(splits.firstHalfAvgPower && splits.lastHalfAvgPower);
    }
    return Boolean(splits.firstHalfPaceSPerKm && splits.lastHalfPaceSPerKm);
  },

  analyze(ctx: AnalyzerContext): Finding[] {
    const phase1 = asPhase1Context(ctx);
    const splits = phase1.diagnosisInput?.actual.splitMetrics;
    if (!splits) return [];

    const sportNorm = isCyclingSport(ctx.timeseries.sport) ? "bike" : "run";
    const decoupling = computeAerobicDecoupling({
      sport: sportNorm,
      firstHalfAvgHr: splits.firstHalfAvgHr,
      lastHalfAvgHr: splits.lastHalfAvgHr,
      firstHalfAvgPower: splits.firstHalfAvgPower,
      lastHalfAvgPower: splits.lastHalfAvgPower,
      firstHalfPaceSPerKm: splits.firstHalfPaceSPerKm,
      lastHalfPaceSPerKm: splits.lastHalfPaceSPerKm
    });

    if (!decoupling) return [];

    const { polarity, severityLevel } = polarityFor(decoupling.severity);
    const evidence: FindingEvidence[] = [
      {
        metric: "aerobic_decoupling.percent",
        value: decoupling.percent,
        unit: "%",
        reference: "stable <3% | mild 3-5% | significant 5-10% | poor ≥10%"
      },
      { metric: "aerobic_decoupling.severity", value: decoupling.severity },
      { metric: "first_half_hr", value: Math.round(decoupling.firstHalf.hr), unit: "bpm" },
      { metric: "last_half_hr", value: Math.round(decoupling.secondHalf.hr), unit: "bpm" },
      {
        metric: decoupling.basis === "power" ? "first_half_power" : "first_half_pace",
        value: Math.round(decoupling.firstHalf.output * 10) / 10,
        unit: decoupling.basis === "power" ? "W" : "s/km"
      },
      {
        metric: decoupling.basis === "power" ? "last_half_power" : "last_half_pace",
        value: Math.round(decoupling.secondHalf.output * 10) / 10,
        unit: decoupling.basis === "power" ? "W" : "s/km"
      }
    ];

    const headline = decoupling.severity === "stable"
      ? `Stable cardiac drift (${decoupling.percent.toFixed(1)}%)`
      : `${decoupling.severity.replace(/_/g, " ")} of ${decoupling.percent.toFixed(1)}%`;

    const reasoning = `HR-per-${decoupling.basis} drifted ${decoupling.percent.toFixed(1)}% from the first half to the second; classified ${decoupling.severity}.`;

    return [{
      id: "session.decoupling",
      analyzer_id: ID,
      analyzer_version: VERSION,
      category: "durability",
      polarity,
      severity: severityLevel,
      headline,
      evidence,
      reasoning,
      visual: "drift_bars",
      scope: "session"
    }];
  }
};
