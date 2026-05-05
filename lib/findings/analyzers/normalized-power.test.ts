import { NormalizedPowerAnalyzer } from "./normalized-power";
import type { Phase1AnalyzerContext } from "./index";
import type { SessionDiagnosisInput } from "@/lib/coach/session-diagnosis";

function makeCtx(overrides: {
  sport?: string;
  has_power?: boolean;
  diagnosisInput?: Partial<SessionDiagnosisInput> & {
    actualMetrics?: Record<string, number | null>;
  };
} = {}): Phase1AnalyzerContext {
  const actualMetrics = overrides.diagnosisInput?.actualMetrics ?? {};
  const di: SessionDiagnosisInput = {
    planned: { sport: "bike" },
    actual: { metrics: actualMetrics }
  };
  return {
    session_id: "s1",
    intent: { source: "open", type: "endurance", structure: "open", resolved_at: "2026-05-05T00:00:00.000Z" },
    timeseries: { sport: overrides.sport ?? "cycling", duration_sec: 3600, has_power: overrides.has_power ?? true },
    physModel: { ftp: 250 },
    diagnosisInput: di
  };
}

describe("NormalizedPowerAnalyzer", () => {
  it("emits a finding with NP, avg power, and VI when all are present (happy path)", () => {
    const ctx = makeCtx({
      diagnosisInput: {
        actualMetrics: { normalized_power: 215, avg_power: 200, variability_index: 1.07 }
      }
    });
    expect(NormalizedPowerAnalyzer.applies_to(ctx)).toBe(true);
    const findings = NormalizedPowerAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("session.normalized_power");
    expect(f.analyzer_id).toBe("NormalizedPower");
    expect(f.category).toBe("execution");
    expect(f.evidence.find((e) => e.metric === "normalized_power")?.value).toBe(215);
    expect(f.evidence.find((e) => e.metric === "avg_power")?.value).toBe(200);
    expect(f.evidence.find((e) => e.metric === "variability_index")?.value).toBe(1.07);
    expect(f.reasoning.length).toBeLessThanOrEqual(240);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it("does not apply when sport is not cycling (applies_to filter)", () => {
    const ctx = makeCtx({
      sport: "run",
      diagnosisInput: { actualMetrics: { normalized_power: 215 } }
    });
    expect(NormalizedPowerAnalyzer.applies_to(ctx)).toBe(false);
  });

  it("does not apply when normalized_power is missing (missing-data fallback)", () => {
    const ctx = makeCtx({ diagnosisInput: { actualMetrics: {} } });
    expect(NormalizedPowerAnalyzer.applies_to(ctx)).toBe(false);
    expect(NormalizedPowerAnalyzer.analyze(ctx)).toEqual([]);
  });

  it("does not apply when normalized_power is zero or negative (edge value)", () => {
    expect(
      NormalizedPowerAnalyzer.applies_to(makeCtx({ diagnosisInput: { actualMetrics: { normalized_power: 0 } } }))
    ).toBe(false);
    expect(
      NormalizedPowerAnalyzer.applies_to(makeCtx({ diagnosisInput: { actualMetrics: { normalized_power: -5 } } }))
    ).toBe(false);
  });

  it("emits NP finding without VI when variability is missing", () => {
    const ctx = makeCtx({
      diagnosisInput: { actualMetrics: { normalized_power: 240 } }
    });
    const findings = NormalizedPowerAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.evidence.find((e) => e.metric === "variability_index")).toBeUndefined();
    expect(f.headline).toContain("240");
  });

  it("treats sport='bike' the same as sport='cycling'", () => {
    const ctx = makeCtx({
      sport: "bike",
      diagnosisInput: { actualMetrics: { normalized_power: 200 } }
    });
    expect(NormalizedPowerAnalyzer.applies_to(ctx)).toBe(true);
    expect(NormalizedPowerAnalyzer.analyze(ctx)).toHaveLength(1);
  });
});
