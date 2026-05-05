import { TSSAnalyzer } from "./tss";
import type { Phase1AnalyzerContext } from "./index";
import type { SessionDiagnosisInput } from "@/lib/coach/session-diagnosis";

function makeCtx(actualMetrics: Record<string, number | null> = {}, sport: string = "cycling"): Phase1AnalyzerContext {
  const di: SessionDiagnosisInput = {
    planned: { sport: sport === "cycling" ? "bike" : (sport as "run" | "swim") },
    actual: { metrics: actualMetrics }
  };
  return {
    session_id: "s1",
    intent: { source: "open", type: "endurance", structure: "open", resolved_at: "2026-05-05T00:00:00.000Z" },
    timeseries: { sport, duration_sec: 3600 },
    physModel: { ftp: 250 },
    diagnosisInput: di
  };
}

describe("TSSAnalyzer", () => {
  it("emits a TSS finding with intensity factor and total work when present (happy path)", () => {
    const ctx = makeCtx({ training_stress_score: 85, intensity_factor: 0.78, total_work_kj: 920 });
    expect(TSSAnalyzer.applies_to(ctx)).toBe(true);
    const findings = TSSAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("session.tss");
    expect(f.category).toBe("durability");
    expect(f.evidence.find((e) => e.metric === "training_stress_score")?.value).toBe(85);
    expect(f.evidence.find((e) => e.metric === "intensity_factor")?.value).toBe(0.78);
    expect(f.evidence.find((e) => e.metric === "total_work_kj")?.value).toBe(920);
    expect(f.headline).toContain("85");
    expect(f.reasoning.length).toBeLessThanOrEqual(240);
  });

  it("does not apply when TSS is missing (missing-data fallback)", () => {
    expect(TSSAnalyzer.applies_to(makeCtx({}))).toBe(false);
    expect(TSSAnalyzer.analyze(makeCtx({}))).toEqual([]);
  });

  it("flags concern polarity at high TSS (>=200)", () => {
    const findings = TSSAnalyzer.analyze(makeCtx({ training_stress_score: 220 }));
    expect(findings[0].polarity).toBe("concern");
    expect(findings[0].severity).toBe(2);
  });

  it("returns observation polarity at moderate TSS (e.g. 70)", () => {
    const findings = TSSAnalyzer.analyze(makeCtx({ training_stress_score: 70 }));
    expect(findings[0].polarity).toBe("observation");
    expect(findings[0].severity).toBe(0);
  });

  it("works for run sessions with TSS available (applies_to is sport-agnostic)", () => {
    const ctx = makeCtx({ training_stress_score: 65 }, "run");
    expect(TSSAnalyzer.applies_to(ctx)).toBe(true);
    expect(TSSAnalyzer.analyze(ctx)).toHaveLength(1);
  });

  it("does not apply when TSS is zero or negative", () => {
    expect(TSSAnalyzer.applies_to(makeCtx({ training_stress_score: 0 }))).toBe(false);
    expect(TSSAnalyzer.applies_to(makeCtx({ training_stress_score: -10 }))).toBe(false);
  });

  it("omits IF and total_work_kj evidence when only TSS is available", () => {
    const findings = TSSAnalyzer.analyze(makeCtx({ training_stress_score: 60 }));
    const f = findings[0];
    expect(f.evidence.find((e) => e.metric === "intensity_factor")).toBeUndefined();
    expect(f.evidence.find((e) => e.metric === "total_work_kj")).toBeUndefined();
  });
});
