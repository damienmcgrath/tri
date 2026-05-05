// CompletionAnalyzer — Phase 1 parity wrapper.
// Reports completion against the planned target — interval count and/or
// duration. Mirrors the completion component scoring in
// lib/coach/session-diagnosis-scoring.ts but emits as a typed Finding.

import type { Analyzer, AnalyzerContext } from "../analyzer";
import type { Finding, FindingEvidence, FindingPolarity, FindingSeverity } from "../types";
import { asPhase1Context } from "./index";

const ID = "Completion";
const VERSION = "1.0.0";

function ratio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (typeof numerator !== "number" || typeof denominator !== "number") return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function gradeForCompletion(pct: number): { polarity: FindingPolarity; severity: FindingSeverity } {
  if (pct >= 0.95) return { polarity: "positive", severity: 0 };
  if (pct >= 0.80) return { polarity: "observation", severity: 1 };
  if (pct >= 0.50) return { polarity: "concern", severity: 2 };
  return { polarity: "concern", severity: 3 };
}

export const CompletionAnalyzer: Analyzer = {
  id: ID,
  version: VERSION,
  description: "Reports duration and interval completion against the planned target.",

  applies_to(ctx: AnalyzerContext): boolean {
    const phase1 = asPhase1Context(ctx);
    const planned = phase1.diagnosisInput?.planned;
    const actual = phase1.diagnosisInput?.actual;
    if (!planned || !actual) return false;
    const hasDurationTarget = typeof planned.plannedDurationSec === "number" && planned.plannedDurationSec > 0;
    const hasIntervalTarget = typeof planned.plannedIntervals === "number" && planned.plannedIntervals > 0;
    return hasDurationTarget || hasIntervalTarget;
  },

  analyze(ctx: AnalyzerContext): Finding[] {
    const phase1 = asPhase1Context(ctx);
    const planned = phase1.diagnosisInput?.planned;
    const actual = phase1.diagnosisInput?.actual;
    if (!planned || !actual) return [];

    const intervalCompletion = actual.intervalCompletionPct ?? ratio(actual.completedIntervals, planned.plannedIntervals);
    const durationCompletion = ratio(actual.durationSec, planned.plannedDurationSec ?? null);

    if (intervalCompletion === null && durationCompletion === null) return [];

    const evidence: FindingEvidence[] = [];
    let combinedPct = 0;
    let parts = 0;

    if (typeof intervalCompletion === "number") {
      const pct = Math.round(intervalCompletion * 100);
      evidence.push({ metric: "interval_completion_pct", value: pct, unit: "%" });
      if (typeof actual.completedIntervals === "number") {
        evidence.push({ metric: "completed_intervals", value: actual.completedIntervals });
      }
      if (typeof planned.plannedIntervals === "number") {
        evidence.push({ metric: "planned_intervals", value: planned.plannedIntervals });
      }
      combinedPct += Math.min(1, intervalCompletion);
      parts += 1;
    }

    if (typeof durationCompletion === "number") {
      const pct = Math.round(durationCompletion * 100);
      evidence.push({ metric: "duration_completion_pct", value: pct, unit: "%" });
      if (typeof actual.durationSec === "number") {
        evidence.push({ metric: "actual_duration_sec", value: actual.durationSec, unit: "s" });
      }
      if (typeof planned.plannedDurationSec === "number") {
        evidence.push({ metric: "planned_duration_sec", value: planned.plannedDurationSec, unit: "s" });
      }
      combinedPct += Math.min(1, durationCompletion);
      parts += 1;
    }

    const meanPct = parts > 0 ? combinedPct / parts : 0;
    const { polarity, severity } = gradeForCompletion(meanPct);

    const headlineParts: string[] = [];
    if (typeof intervalCompletion === "number") headlineParts.push(`${Math.round(intervalCompletion * 100)}% intervals`);
    if (typeof durationCompletion === "number") headlineParts.push(`${Math.round(durationCompletion * 100)}% duration`);
    const headline = `Completion: ${headlineParts.join(", ")}`;

    const reasoning = polarity === "positive"
      ? `Session completed at or above the planned scope.`
      : `Session ran short of the planned scope on ${headlineParts.join(" and ")}.`;

    return [{
      id: "session.completion",
      analyzer_id: ID,
      analyzer_version: VERSION,
      category: "execution",
      polarity,
      severity,
      headline,
      evidence,
      reasoning,
      scope: "session"
    }];
  }
};
