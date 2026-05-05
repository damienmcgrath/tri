import { IntensityComplianceAnalyzer } from "./intensity-compliance";
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

describe("IntensityComplianceAnalyzer", () => {
  it("emits a positive in-band finding when avg HR sits inside the target (happy path)", () => {
    const ctx = makeCtx({
      planned: { sport: "bike", targetBands: { hr: { min: 130, max: 145 } } },
      actual: { avgHr: 138, timeAboveTargetPct: 0.02, metrics: {} }
    });
    expect(IntensityComplianceAnalyzer.applies_to(ctx)).toBe(true);
    const findings = IntensityComplianceAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("session.intensity_compliance");
    expect(f.polarity).toBe("positive");
    expect(f.evidence.find((e) => e.metric === "avg_hr")?.value).toBe(138);
    expect(f.evidence.find((e) => e.metric === "hr_band_position")?.value).toBe("in_band");
    expect(f.reasoning.length).toBeLessThanOrEqual(240);
  });

  it("flags concern severity 2 when time_above_target_pct >= 0.25 (edge value)", () => {
    const ctx = makeCtx({
      planned: { sport: "bike", targetBands: { hr: { min: 130, max: 145 } } },
      actual: { avgHr: 150, timeAboveTargetPct: 0.4, metrics: {} }
    });
    const findings = IntensityComplianceAnalyzer.analyze(ctx);
    expect(findings[0].polarity).toBe("concern");
    expect(findings[0].severity).toBe(2);
    expect(findings[0].evidence.find((e) => e.metric === "time_above_target_pct")?.value).toBe(40);
  });

  it("does not apply when no target bands are set (applies_to filter)", () => {
    const ctx = makeCtx({
      planned: { sport: "bike" },
      actual: { avgHr: 138, metrics: {} }
    });
    expect(IntensityComplianceAnalyzer.applies_to(ctx)).toBe(false);
  });

  it("returns [] when the actual data does not match any planned band (missing-data fallback)", () => {
    const ctx = makeCtx({
      planned: { sport: "bike", targetBands: { hr: { min: 130, max: 145 } } },
      actual: { avgPower: 200, metrics: {} } // no avg_hr
    });
    const findings = IntensityComplianceAnalyzer.analyze(ctx);
    expect(findings).toEqual([]);
  });

  it("classifies position as 'below' when value is under min", () => {
    const ctx = makeCtx({
      planned: { sport: "bike", targetBands: { power: { min: 200, max: 240 } } },
      actual: { avgPower: 180, metrics: {} }
    });
    const findings = IntensityComplianceAnalyzer.analyze(ctx);
    expect(findings[0].evidence.find((e) => e.metric === "power_band_position")?.value).toBe("below");
  });

  it("classifies position as 'above' when value exceeds max", () => {
    const ctx = makeCtx({
      planned: { sport: "bike", targetBands: { power: { min: 200, max: 240 } } },
      actual: { avgPower: 260, metrics: {} }
    });
    const findings = IntensityComplianceAnalyzer.analyze(ctx);
    expect(findings[0].evidence.find((e) => e.metric === "power_band_position")?.value).toBe("above");
  });

  it("supports running pace bands", () => {
    const ctx = makeCtx({
      planned: { sport: "run", targetBands: { pace: { min: 280, max: 320 } } },
      actual: { avgPaceSPerKm: 295, metrics: {} }
    }, "run");
    expect(IntensityComplianceAnalyzer.applies_to(ctx)).toBe(true);
    const findings = IntensityComplianceAnalyzer.analyze(ctx);
    expect(findings[0].evidence.find((e) => e.metric === "pace_band_position")?.value).toBe("in_band");
  });
});
