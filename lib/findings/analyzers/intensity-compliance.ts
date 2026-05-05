// IntensityComplianceAnalyzer — Phase 1 parity wrapper.
// Reports adherence to the planned intensity zone — average HR / power / pace
// vs the planned target band, plus the existing time_above_target_pct signal.

import type {
  CompletedSessionDiagnosisInput,
  PlannedTargetBand
} from "@/lib/coach/session-diagnosis";
import type { Analyzer, AnalyzerContext } from "../analyzer";
import type { Finding, FindingEvidence, FindingPolarity, FindingSeverity } from "../types";
import { asPhase1Context } from "./index";

const ID = "IntensityCompliance";
const VERSION = "1.0.0";

function classifyValue(value: number, band: { min?: number; max?: number }): "below" | "in_band" | "above" {
  if (typeof band.min === "number" && value < band.min) return "below";
  if (typeof band.max === "number" && value > band.max) return "above";
  return "in_band";
}

function severityForCompliance(args: {
  inBand: boolean;
  timeAboveTargetPct: number | null;
}): { polarity: FindingPolarity; severity: FindingSeverity } {
  if (args.inBand && (args.timeAboveTargetPct === null || args.timeAboveTargetPct < 0.05)) {
    return { polarity: "positive", severity: 0 };
  }
  if (args.timeAboveTargetPct !== null && args.timeAboveTargetPct >= 0.25) {
    return { polarity: "concern", severity: 2 };
  }
  if (!args.inBand) {
    return { polarity: "concern", severity: 1 };
  }
  return { polarity: "observation", severity: 1 };
}

function getMetric(actual: CompletedSessionDiagnosisInput, key: string): number | null {
  const v = actual.metrics?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export const IntensityComplianceAnalyzer: Analyzer = {
  id: ID,
  version: VERSION,
  description: "Reports adherence to the planned intensity zone (HR / power / pace).",

  applies_to(ctx: AnalyzerContext): boolean {
    const phase1 = asPhase1Context(ctx);
    const planned = phase1.diagnosisInput?.planned;
    if (!planned?.targetBands) return false;
    const bands = planned.targetBands;
    return Boolean(bands.hr || bands.power || bands.pace || bands.pace100m);
  },

  analyze(ctx: AnalyzerContext): Finding[] {
    const phase1 = asPhase1Context(ctx);
    const planned = phase1.diagnosisInput?.planned;
    const actual = phase1.diagnosisInput?.actual;
    if (!planned?.targetBands || !actual) return [];

    const bands: PlannedTargetBand = planned.targetBands;
    const evidence: FindingEvidence[] = [];

    const avgHr = actual.avgHr ?? getMetric(actual, "avg_hr");
    const avgPower = actual.avgIntervalPower ?? actual.avgPower ?? getMetric(actual, "avg_power");
    const avgPaceSPerKm = actual.avgPaceSPerKm ?? getMetric(actual, "avg_pace_s_per_km");
    const avgPace100mSec = getMetric(actual, "avg_pace_per_100m_sec");
    const timeAboveTargetPct = typeof actual.timeAboveTargetPct === "number" ? actual.timeAboveTargetPct : null;

    let inBand = true;

    if (bands.hr && typeof avgHr === "number") {
      const cls = classifyValue(avgHr, bands.hr);
      evidence.push({ metric: "avg_hr", value: Math.round(avgHr), unit: "bpm" });
      if (typeof bands.hr.min === "number") evidence.push({ metric: "hr_target_min", value: bands.hr.min, unit: "bpm" });
      if (typeof bands.hr.max === "number") evidence.push({ metric: "hr_target_max", value: bands.hr.max, unit: "bpm" });
      evidence.push({ metric: "hr_band_position", value: cls });
      if (cls !== "in_band") inBand = false;
    }

    if (bands.power && typeof avgPower === "number") {
      const cls = classifyValue(avgPower, bands.power);
      evidence.push({ metric: "avg_power", value: Math.round(avgPower), unit: "W" });
      if (typeof bands.power.min === "number") evidence.push({ metric: "power_target_min", value: bands.power.min, unit: "W" });
      if (typeof bands.power.max === "number") evidence.push({ metric: "power_target_max", value: bands.power.max, unit: "W" });
      evidence.push({ metric: "power_band_position", value: cls });
      if (cls !== "in_band") inBand = false;
    }

    if (bands.pace && typeof avgPaceSPerKm === "number") {
      const cls = classifyValue(avgPaceSPerKm, bands.pace);
      evidence.push({ metric: "avg_pace_s_per_km", value: Math.round(avgPaceSPerKm), unit: "s/km" });
      if (typeof bands.pace.min === "number") evidence.push({ metric: "pace_target_min", value: bands.pace.min, unit: "s/km" });
      if (typeof bands.pace.max === "number") evidence.push({ metric: "pace_target_max", value: bands.pace.max, unit: "s/km" });
      evidence.push({ metric: "pace_band_position", value: cls });
      if (cls !== "in_band") inBand = false;
    }

    if (bands.pace100m && typeof avgPace100mSec === "number") {
      const cls = classifyValue(avgPace100mSec, bands.pace100m);
      evidence.push({ metric: "avg_pace_per_100m_sec", value: Math.round(avgPace100mSec), unit: "s/100m" });
      evidence.push({ metric: "pace100m_band_position", value: cls });
      if (cls !== "in_band") inBand = false;
    }

    if (timeAboveTargetPct !== null) {
      evidence.push({
        metric: "time_above_target_pct",
        value: Number((timeAboveTargetPct * 100).toFixed(0)),
        unit: "%"
      });
    }

    if (evidence.length === 0) return [];

    const { polarity, severity } = severityForCompliance({ inBand, timeAboveTargetPct });

    const headline = inBand && (timeAboveTargetPct === null || timeAboveTargetPct < 0.05)
      ? "Intensity stayed in band"
      : timeAboveTargetPct !== null && timeAboveTargetPct >= 0.05
        ? `Drifted above target ${Math.round(timeAboveTargetPct * 100)}% of the time`
        : "Intensity drifted from target band";

    const reasoning = inBand
      ? "Average effort sat within the planned target band."
      : `Average effort drifted outside the planned band${timeAboveTargetPct !== null ? `; ${Math.round(timeAboveTargetPct * 100)}% above target` : ""}.`;

    return [{
      id: "session.intensity_compliance",
      analyzer_id: ID,
      analyzer_version: VERSION,
      category: "execution",
      polarity,
      severity,
      headline,
      evidence,
      reasoning: reasoning.length > 240 ? reasoning.slice(0, 237) + "..." : reasoning,
      scope: "session"
    }];
  }
};
