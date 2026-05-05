import { PacingConsistencyAnalyzer } from "./pacing-consistency";
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

describe("PacingConsistencyAnalyzer", () => {
  it("emits a positive finding when VI is steady and HR drift is minimal (happy path)", () => {
    const ctx = makeCtx({
      planned: { sport: "bike" },
      actual: {
        variabilityIndex: 1.04,
        splitMetrics: { firstHalfAvgHr: 145, lastHalfAvgHr: 147 },
        metrics: {}
      }
    });
    expect(PacingConsistencyAnalyzer.applies_to(ctx)).toBe(true);
    const findings = PacingConsistencyAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("session.pacing_consistency");
    expect(f.category).toBe("pacing");
    expect(f.polarity).toBe("positive");
    expect(f.evidence.find((e) => e.metric === "variability_index")?.value).toBe(1.04);
    expect(f.reasoning.length).toBeLessThanOrEqual(240);
  });

  it("flags significant pace fade with severity 2+ (edge value)", () => {
    const ctx = makeCtx({
      planned: { sport: "run" },
      actual: {
        splitMetrics: { firstHalfPaceSPerKm: 280, lastHalfPaceSPerKm: 340 }, // 21% fade
        metrics: {}
      }
    }, "run");
    const findings = PacingConsistencyAnalyzer.analyze(ctx);
    expect(findings[0].polarity).toBe("concern");
    expect(findings[0].severity).toBeGreaterThanOrEqual(2);
    expect(findings[0].evidence.find((e) => e.metric === "pace_fade_pct")).toBeDefined();
  });

  it("flags moderate HR drift with observation polarity (5-8% drift)", () => {
    const ctx = makeCtx({
      planned: { sport: "bike" },
      actual: {
        splitMetrics: { firstHalfAvgHr: 140, lastHalfAvgHr: 150 }, // 7.1% drift
        metrics: {}
      }
    });
    const findings = PacingConsistencyAnalyzer.analyze(ctx);
    expect(findings[0].polarity).toBe("observation");
    expect(findings[0].severity).toBe(1);
  });

  it("does not apply when neither VI nor split halves are available (applies_to filter)", () => {
    const ctx = makeCtx({
      planned: { sport: "bike" },
      actual: { metrics: {} }
    });
    expect(PacingConsistencyAnalyzer.applies_to(ctx)).toBe(false);
  });

  it("returns [] gracefully when partial split data is provided (missing-data fallback)", () => {
    // only firstHalfAvgHr provided — analyzer's applies_to is false, but if invoked, should not throw
    const ctx = makeCtx({
      planned: { sport: "bike" },
      actual: { splitMetrics: { firstHalfAvgHr: 140 }, metrics: {} }
    });
    expect(PacingConsistencyAnalyzer.applies_to(ctx)).toBe(false);
    expect(PacingConsistencyAnalyzer.analyze(ctx)).toEqual([]);
  });

  it("flags high VI (>1.20) with severity 2+", () => {
    const ctx = makeCtx({
      planned: { sport: "bike" },
      actual: { variabilityIndex: 1.25, metrics: {} }
    });
    const findings = PacingConsistencyAnalyzer.analyze(ctx);
    expect(findings[0].polarity).toBe("concern");
    expect(findings[0].severity).toBeGreaterThanOrEqual(2);
  });

  it("includes power drift evidence for cycling halves", () => {
    const ctx = makeCtx({
      planned: { sport: "bike" },
      actual: {
        splitMetrics: { firstHalfAvgPower: 200, lastHalfAvgPower: 195 },
        metrics: {}
      }
    });
    const findings = PacingConsistencyAnalyzer.analyze(ctx);
    expect(findings[0].evidence.find((e) => e.metric === "power_drift_pct")).toBeDefined();
    expect(findings[0].evidence.find((e) => e.metric === "first_half_power")?.value).toBe(200);
  });
});
