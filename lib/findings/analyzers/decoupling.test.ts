import { DecouplingAnalyzer } from "./decoupling";
import type { Phase1AnalyzerContext } from "./index";
import type { SessionDiagnosisInput, SplitMetrics } from "@/lib/coach/session-diagnosis";

function makeCtx(args: {
  sport?: string;
  splits?: SplitMetrics | null;
}): Phase1AnalyzerContext {
  const splits = args.splits ?? null;
  const di: SessionDiagnosisInput = {
    planned: { sport: (args.sport ?? "bike") === "bike" ? "bike" : "run" },
    actual: { splitMetrics: splits, metrics: {} }
  };
  return {
    session_id: "s1",
    intent: { source: "open", type: "endurance", structure: "open" },
    timeseries: { sport: args.sport ?? "bike", duration_sec: 5400 },
    physModel: {},
    diagnosisInput: di
  };
}

describe("DecouplingAnalyzer", () => {
  it("emits a decoupling finding for cycling with full halves (happy path)", () => {
    const ctx = makeCtx({
      sport: "bike",
      splits: { firstHalfAvgHr: 145, lastHalfAvgHr: 152, firstHalfAvgPower: 200, lastHalfAvgPower: 195 }
    });
    expect(DecouplingAnalyzer.applies_to(ctx)).toBe(true);
    const findings = DecouplingAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("session.decoupling");
    expect(f.category).toBe("durability");
    const pct = f.evidence.find((e) => e.metric === "aerobic_decoupling.percent")?.value;
    expect(typeof pct).toBe("number");
    expect(f.evidence.find((e) => e.metric === "aerobic_decoupling.severity")).toBeDefined();
    expect(f.evidence.find((e) => e.metric === "first_half_hr")?.value).toBe(145);
    expect(f.evidence.find((e) => e.metric === "last_half_hr")?.value).toBe(152);
    expect(f.reasoning.length).toBeLessThanOrEqual(240);
  });

  it("flags concern polarity for significant_drift (5-10%)", () => {
    // first ratio = 140/200 = 0.700; last = 160/200 = 0.800; pct ≈ 14.3% → poor_durability
    // tune to ~7%: first 140/200=0.7, last 150/200=0.75, ((0.75/0.7)-1)*100 ≈ 7.14
    const ctx = makeCtx({
      splits: { firstHalfAvgHr: 140, lastHalfAvgHr: 150, firstHalfAvgPower: 200, lastHalfAvgPower: 200 }
    });
    const findings = DecouplingAnalyzer.analyze(ctx);
    expect(findings[0].polarity).toBe("concern");
    expect(findings[0].severity).toBeGreaterThanOrEqual(2);
  });

  it("returns positive polarity for stable drift (<3%)", () => {
    // first 150/200=0.75, last 152/200=0.76, ratio ~1.0133 → ~1.3% drift → stable
    const ctx = makeCtx({
      splits: { firstHalfAvgHr: 150, lastHalfAvgHr: 152, firstHalfAvgPower: 200, lastHalfAvgPower: 200 }
    });
    const findings = DecouplingAnalyzer.analyze(ctx);
    expect(findings[0].polarity).toBe("positive");
    expect(findings[0].severity).toBe(0);
  });

  it("does not apply for swim (applies_to filter)", () => {
    const ctx = makeCtx({
      sport: "swim",
      splits: { firstHalfAvgHr: 140, lastHalfAvgHr: 145, firstHalfPaceSPerKm: 90, lastHalfPaceSPerKm: 92 }
    });
    expect(DecouplingAnalyzer.applies_to(ctx)).toBe(false);
  });

  it("does not apply when split halves are missing (missing-data fallback)", () => {
    expect(DecouplingAnalyzer.applies_to(makeCtx({ sport: "bike", splits: null }))).toBe(false);
    expect(DecouplingAnalyzer.applies_to(makeCtx({ sport: "bike", splits: { firstHalfAvgHr: 140 } }))).toBe(false);
  });

  it("emits a run-sport finding using pace halves", () => {
    const ctx = makeCtx({
      sport: "run",
      splits: { firstHalfAvgHr: 145, lastHalfAvgHr: 158, firstHalfPaceSPerKm: 280, lastHalfPaceSPerKm: 285 }
    });
    expect(DecouplingAnalyzer.applies_to(ctx)).toBe(true);
    const findings = DecouplingAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.find((e) => e.metric === "first_half_pace")).toBeDefined();
  });

  it("returns [] when computeAerobicDecoupling returns null on edge values (zero output)", () => {
    const ctx = makeCtx({
      sport: "bike",
      splits: { firstHalfAvgHr: 140, lastHalfAvgHr: 150, firstHalfAvgPower: 0, lastHalfAvgPower: 200 }
    });
    expect(DecouplingAnalyzer.applies_to(ctx)).toBe(false);
  });
});
