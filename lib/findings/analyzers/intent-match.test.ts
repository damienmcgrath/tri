import { IntentMatchAnalyzer } from "./intent-match";
import type { Phase1AnalyzerContext } from "./index";
import type { SessionDiagnosisInput } from "@/lib/coach/session-diagnosis";

function makeCtx(input: SessionDiagnosisInput, sport: string = "bike"): Phase1AnalyzerContext {
  return {
    session_id: "s1",
    intent: { source: "open", type: "endurance", structure: "open", resolved_at: "2026-05-05T00:00:00.000Z" },
    timeseries: { sport, duration_sec: input.actual.durationSec ?? 3600 },
    physModel: {},
    diagnosisInput: input
  };
}

describe("IntentMatchAnalyzer", () => {
  it("emits a positive matched-intent finding for a clean easy endurance ride (happy path)", () => {
    const ctx = makeCtx({
      planned: {
        sport: "bike",
        plannedDurationSec: 3600,
        intentCategory: "easy_endurance",
        targetBands: { hr: { min: 130, max: 145 } }
      },
      actual: {
        durationSec: 3540,
        avgHr: 138,
        avgPower: 180,
        timeAboveTargetPct: 0.02,
        metrics: { avg_hr: 138, avg_power: 180 }
      }
    });
    expect(IntentMatchAnalyzer.applies_to(ctx)).toBe(true);
    const findings = IntentMatchAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("session.intent_match");
    expect(f.category).toBe("execution");
    expect(["positive", "observation"]).toContain(f.polarity);
    expect(f.evidence.find((e) => e.metric === "intent_match_status")).toBeDefined();
    expect(f.evidence.find((e) => e.metric === "evidence_count")).toBeDefined();
    expect(f.reasoning.length).toBeLessThanOrEqual(240);
  });

  it("does not apply when diagnosisInput is missing (applies_to filter)", () => {
    const ctx: Phase1AnalyzerContext = {
      session_id: "s1",
      intent: { source: "open", type: "endurance", structure: "open", resolved_at: "2026-05-05T00:00:00.000Z" },
      timeseries: { sport: "bike", duration_sec: 3600 },
      physModel: {}
    };
    expect(IntentMatchAnalyzer.applies_to(ctx)).toBe(false);
  });

  it("returns [] when evidenceCount is zero (missing-data fallback)", () => {
    const ctx = makeCtx({
      planned: { sport: "bike", intentCategory: "easy_endurance" },
      actual: { metrics: {} }
    });
    const findings = IntentMatchAnalyzer.analyze(ctx);
    expect(findings).toEqual([]);
  });

  it("flags concern polarity for missed_intent (e.g. recovery ride done way too hard)", () => {
    const ctx = makeCtx({
      planned: {
        sport: "bike",
        plannedDurationSec: 1800,
        intentCategory: "recovery",
        targetBands: { hr: { min: 100, max: 120 } }
      },
      actual: {
        durationSec: 1800,
        avgHr: 160, // way above ceiling
        timeAboveTargetPct: 0.85,
        metrics: { avg_hr: 160 }
      }
    });
    const findings = IntentMatchAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    expect(["concern", "observation"]).toContain(findings[0].polarity);
  });

  it("includes detected_issue evidence entries when issues are present", () => {
    const ctx = makeCtx({
      planned: {
        sport: "bike",
        plannedDurationSec: 3600,
        intentCategory: "easy_endurance",
        targetBands: { hr: { min: 130, max: 145 } }
      },
      actual: {
        durationSec: 3600,
        avgHr: 165, // way above
        timeAboveTargetPct: 0.6,
        metrics: { avg_hr: 165 }
      }
    });
    const findings = IntentMatchAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    const issues = findings[0].evidence.filter((e) => e.metric === "detected_issue");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("includes execution_score and component score when computed", () => {
    const ctx = makeCtx({
      planned: {
        sport: "bike",
        plannedDurationSec: 3600,
        intentCategory: "easy_endurance",
        targetBands: { hr: { min: 130, max: 145 } }
      },
      actual: {
        durationSec: 3600,
        avgHr: 138,
        avgPower: 180,
        timeAboveTargetPct: 0.05,
        metrics: { avg_hr: 138, avg_power: 180 }
      }
    });
    const findings = IntentMatchAnalyzer.analyze(ctx);
    expect(findings[0].evidence.find((e) => e.metric === "execution_score")).toBeDefined();
    expect(findings[0].evidence.find((e) => e.metric === "intent_match_component_score")).toBeDefined();
    expect(findings[0].evidence.find((e) => e.metric === "data_completeness_pct")).toBeDefined();
  });
});
