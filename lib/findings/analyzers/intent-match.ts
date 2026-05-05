// IntentMatchAnalyzer — Phase 1 parity wrapper.
// Re-runs diagnoseCompletedSession (a pure function) and translates the
// resulting intentMatchStatus + componentScores.intentMatch into a typed
// Finding. This guarantees parity with the existing diagnosis output.

import {
  diagnoseCompletedSession,
  type IntentMatchStatus,
  type SessionDiagnosis
} from "@/lib/coach/session-diagnosis";
import type { Analyzer, AnalyzerContext } from "../analyzer";
import type { Finding, FindingEvidence, FindingPolarity, FindingSeverity } from "../types";
import { asPhase1Context } from "./index";

const ID = "IntentMatch";
const VERSION = "1.0.0";

function polarityFor(status: IntentMatchStatus): { polarity: FindingPolarity; severity: FindingSeverity } {
  switch (status) {
    case "matched_intent":
      return { polarity: "positive", severity: 0 };
    case "partial_intent":
      return { polarity: "observation", severity: 1 };
    case "missed_intent":
      return { polarity: "concern", severity: 2 };
  }
}

function statusLabel(status: IntentMatchStatus): string {
  if (status === "matched_intent") return "matched";
  if (status === "partial_intent") return "partial";
  return "missed";
}

export const IntentMatchAnalyzer: Analyzer = {
  id: ID,
  version: VERSION,
  description: "Reports the diagnosed intent match status (matched / partial / missed).",

  applies_to(ctx: AnalyzerContext): boolean {
    const phase1 = asPhase1Context(ctx);
    return Boolean(phase1.diagnosisInput);
  },

  analyze(ctx: AnalyzerContext): Finding[] {
    const phase1 = asPhase1Context(ctx);
    const input = phase1.diagnosisInput;
    if (!input) return [];

    const diagnosis: SessionDiagnosis = diagnoseCompletedSession(input);
    if (diagnosis.evidenceCount === 0) return [];

    const { polarity, severity } = polarityFor(diagnosis.intentMatchStatus);
    const evidence: FindingEvidence[] = [
      { metric: "intent_match_status", value: statusLabel(diagnosis.intentMatchStatus) },
      { metric: "evidence_count", value: diagnosis.evidenceCount }
    ];

    if (typeof diagnosis.executionScore === "number") {
      evidence.push({ metric: "execution_score", value: diagnosis.executionScore });
    }
    if (diagnosis.componentScores) {
      evidence.push({
        metric: "intent_match_component_score",
        value: diagnosis.componentScores.intentMatch.score
      });
      if (diagnosis.componentScores.intentMatch.capped) {
        evidence.push({
          metric: "intent_match_capped",
          value: "true",
          reference: "score capped due to missing dominant intensity metric"
        });
      }
      evidence.push({
        metric: "data_completeness_pct",
        value: Number((diagnosis.componentScores.dataCompletenessPct * 100).toFixed(0)),
        unit: "%"
      });
    }
    for (const issue of diagnosis.detectedIssues) {
      evidence.push({ metric: "detected_issue", value: issue });
    }

    const headline = diagnosis.intentMatchStatus === "matched_intent"
      ? "Intent matched"
      : diagnosis.intentMatchStatus === "partial_intent"
        ? "Intent partially matched"
        : "Intent missed";

    const reasoning = `Diagnosed ${statusLabel(diagnosis.intentMatchStatus)} from ${diagnosis.evidenceCount} evidence item(s); confidence ${diagnosis.diagnosisConfidence}.`;

    return [{
      id: "session.intent_match",
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
