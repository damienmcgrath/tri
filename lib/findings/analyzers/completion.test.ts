import { CompletionAnalyzer } from "./completion";
import type { Phase1AnalyzerContext } from "./index";
import type { SessionDiagnosisInput } from "@/lib/coach/session-diagnosis";

function makeCtx(input: SessionDiagnosisInput, sport: string = "bike"): Phase1AnalyzerContext {
  return {
    session_id: "s1",
    intent: { source: "open", type: "endurance", structure: "open" },
    timeseries: { sport, duration_sec: input.actual.durationSec ?? 3600 },
    physModel: {},
    diagnosisInput: input
  };
}

describe("CompletionAnalyzer", () => {
  it("reports both interval and duration completion when both are present (happy path)", () => {
    const ctx = makeCtx({
      planned: { plannedDurationSec: 3600, plannedIntervals: 5 },
      actual: { durationSec: 3600, completedIntervals: 5, intervalCompletionPct: 1, metrics: {} }
    });
    expect(CompletionAnalyzer.applies_to(ctx)).toBe(true);
    const findings = CompletionAnalyzer.analyze(ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("session.completion");
    expect(f.evidence.find((e) => e.metric === "interval_completion_pct")?.value).toBe(100);
    expect(f.evidence.find((e) => e.metric === "duration_completion_pct")?.value).toBe(100);
    expect(f.polarity).toBe("positive");
    expect(f.reasoning.length).toBeLessThanOrEqual(240);
  });

  it("flags concern severity 2 when completion is well below target (50-79%)", () => {
    const ctx = makeCtx({
      planned: { plannedDurationSec: 3600 },
      actual: { durationSec: 1800, metrics: {} } // 50%
    });
    const findings = CompletionAnalyzer.analyze(ctx);
    expect(findings[0].polarity).toBe("concern");
    expect(findings[0].severity).toBeGreaterThanOrEqual(2);
  });

  it("does not apply when no planned target (applies_to filter)", () => {
    const ctx = makeCtx({
      planned: {},
      actual: { durationSec: 3600, metrics: {} }
    });
    expect(CompletionAnalyzer.applies_to(ctx)).toBe(false);
  });

  it("returns [] when actual data is missing for the planned target (missing-data fallback)", () => {
    const ctx = makeCtx({
      planned: { plannedDurationSec: 3600, plannedIntervals: 5 },
      actual: { metrics: {} } // no completed
    });
    const findings = CompletionAnalyzer.analyze(ctx);
    expect(findings).toEqual([]);
  });

  it("clamps over-completion at 100% in the score (edge value)", () => {
    const ctx = makeCtx({
      planned: { plannedDurationSec: 3600 },
      actual: { durationSec: 7200, metrics: {} } // 200%
    });
    const findings = CompletionAnalyzer.analyze(ctx);
    expect(findings[0].polarity).toBe("positive"); // capped at 100% internally
    expect(findings[0].evidence.find((e) => e.metric === "duration_completion_pct")?.value).toBe(200);
  });

  it("uses provided intervalCompletionPct when present (preferred over derived ratio)", () => {
    const ctx = makeCtx({
      planned: { plannedIntervals: 5 },
      actual: { completedIntervals: 4, intervalCompletionPct: 0.85, metrics: {} }
    });
    const findings = CompletionAnalyzer.analyze(ctx);
    expect(findings[0].evidence.find((e) => e.metric === "interval_completion_pct")?.value).toBe(85);
  });

  it("derives intervalCompletionPct from completedIntervals when not provided", () => {
    const ctx = makeCtx({
      planned: { plannedIntervals: 5 },
      actual: { completedIntervals: 4, metrics: {} } // 80%
    });
    const findings = CompletionAnalyzer.analyze(ctx);
    expect(findings[0].evidence.find((e) => e.metric === "interval_completion_pct")?.value).toBe(80);
  });
});
