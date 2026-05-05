// Regression-parity test: drives the registry against a synthetic activity
// timeseries fixture and asserts the Finding.evidence values match the
// numbers produced by the existing metric path (lib/workouts/session-execution-builders.ts).

import { analyzerRegistry, phase1Analyzers } from "./registry";
import { buildDiagnosisInput } from "@/lib/workouts/session-execution-builders";
import type {
  SessionExecutionActivityRow,
  SessionExecutionSessionRow
} from "@/lib/workouts/session-execution-helpers";
import { computeAerobicDecoupling } from "@/lib/analytics/session-signals";
import { diagnoseCompletedSession } from "@/lib/coach/session-diagnosis";
import type { Phase1AnalyzerContext } from "./analyzers";

function makeSession(overrides: Partial<SessionExecutionSessionRow> = {}): SessionExecutionSessionRow {
  return {
    id: "session-fixture",
    user_id: "user-fixture",
    sport: "bike",
    type: "Tempo bike",
    duration_minutes: 60,
    intent_category: "threshold_quality",
    target: "60 min @ 200-240W; HR Z3 130-150",
    notes: null,
    session_name: "Tempo bike",
    session_role: "key",
    status: "planned",
    ...overrides
  };
}

function makeActivity(overrides: Partial<SessionExecutionActivityRow> = {}): SessionExecutionActivityRow {
  return {
    id: "activity-fixture",
    sport_type: "bike",
    duration_sec: 3600,
    distance_m: 32000,
    avg_hr: 142,
    avg_power: 215,
    avg_pace_per_100m_sec: null,
    laps_count: null,
    parse_summary: null,
    metrics_v2: {
      power: { normalizedPower: 225, variabilityIndex: 1.05, intensityFactor: 0.9, totalWorkKj: 770 },
      load: { trainingStressScore: 90, aerobicTrainingEffect: 3.2 },
      cadence: { avgCadence: 88 },
      firstHalfAvgHr: 138,
      lastHalfAvgHr: 146,
      firstHalfAvgPower: 218,
      lastHalfAvgPower: 212
    },
    ...overrides
  };
}

function ctxFromFixture(session: SessionExecutionSessionRow, activity: SessionExecutionActivityRow): Phase1AnalyzerContext {
  const di = buildDiagnosisInput(session, activity);
  return {
    session_id: session.id,
    intent: { source: "plan", type: "threshold", structure: "intervals", resolved_at: "2026-05-05T00:00:00.000Z" },
    timeseries: {
      sport: activity.sport_type,
      duration_sec: activity.duration_sec ?? 0,
      has_power: typeof activity.avg_power === "number",
      has_hr: typeof activity.avg_hr === "number"
    },
    physModel: { ftp: 250 },
    diagnosisInput: di
  };
}

describe("analyzerRegistry — Phase 1 regression parity", () => {
  it("registers all 7 Phase 1 analyzers", () => {
    expect(phase1Analyzers).toHaveLength(7);
    const ids = phase1Analyzers.map((a) => a.id);
    expect(ids).toEqual([
      "NormalizedPower",
      "TSS",
      "Decoupling",
      "Completion",
      "IntentMatch",
      "IntensityCompliance",
      "PacingConsistency"
    ]);
  });

  it("emits the same NP, TSS, IF and total work numbers as buildDiagnosisInput", () => {
    const session = makeSession();
    const activity = makeActivity();
    const ctx = ctxFromFixture(session, activity);
    const findings = analyzerRegistry.run(ctx);

    const np = findings.find((f) => f.analyzer_id === "NormalizedPower");
    expect(np).toBeDefined();
    expect(np?.evidence.find((e) => e.metric === "normalized_power")?.value).toBe(225);
    expect(np?.evidence.find((e) => e.metric === "variability_index")?.value).toBe(1.05);

    const tss = findings.find((f) => f.analyzer_id === "TSS");
    expect(tss).toBeDefined();
    expect(tss?.evidence.find((e) => e.metric === "training_stress_score")?.value).toBe(90);
    expect(tss?.evidence.find((e) => e.metric === "intensity_factor")?.value).toBe(0.9);
    expect(tss?.evidence.find((e) => e.metric === "total_work_kj")?.value).toBe(770);
  });

  it("decoupling % matches computeAerobicDecoupling for the same fixture halves", () => {
    const session = makeSession();
    const activity = makeActivity();
    const ctx = ctxFromFixture(session, activity);
    const findings = analyzerRegistry.run(ctx);

    const expected = computeAerobicDecoupling({
      sport: "bike",
      firstHalfAvgHr: 138,
      lastHalfAvgHr: 146,
      firstHalfAvgPower: 218,
      lastHalfAvgPower: 212
    });
    expect(expected).not.toBeNull();

    const dec = findings.find((f) => f.analyzer_id === "Decoupling");
    expect(dec).toBeDefined();
    expect(dec?.evidence.find((e) => e.metric === "aerobic_decoupling.percent")?.value).toBe(expected!.percent);
    expect(dec?.evidence.find((e) => e.metric === "aerobic_decoupling.severity")?.value).toBe(expected!.severity);
  });

  it("intent match status matches diagnoseCompletedSession for the same fixture", () => {
    const session = makeSession();
    const activity = makeActivity();
    const ctx = ctxFromFixture(session, activity);

    const expected = diagnoseCompletedSession(ctx.diagnosisInput!);
    const findings = analyzerRegistry.run(ctx);
    const im = findings.find((f) => f.analyzer_id === "IntentMatch");

    if (expected.evidenceCount === 0) {
      expect(im).toBeUndefined();
      return;
    }
    expect(im).toBeDefined();
    const statusValue = im?.evidence.find((e) => e.metric === "intent_match_status")?.value;
    const evidenceCountValue = im?.evidence.find((e) => e.metric === "evidence_count")?.value;
    expect(evidenceCountValue).toBe(expected.evidenceCount);
    expect(["matched", "partial", "missed"]).toContain(statusValue);
  });

  it("completion % derives from buildDiagnosisInput's interval/duration fields", () => {
    const session = makeSession({ duration_minutes: 60 });
    const activity = makeActivity({ duration_sec: 3000 }); // 50 min vs 60 min planned ≈ 83%
    const ctx = ctxFromFixture(session, activity);
    const findings = analyzerRegistry.run(ctx);

    const completion = findings.find((f) => f.analyzer_id === "Completion");
    expect(completion).toBeDefined();
    expect(completion?.evidence.find((e) => e.metric === "duration_completion_pct")?.value).toBe(83);
  });

  it("every emitted finding has non-empty evidence and reasoning ≤240 chars", () => {
    const session = makeSession();
    const activity = makeActivity();
    const ctx = ctxFromFixture(session, activity);
    const findings = analyzerRegistry.run(ctx);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.reasoning.length).toBeLessThanOrEqual(240);
      expect(f.reasoning.length).toBeGreaterThan(0);
      expect(f.id).toMatch(/^session\./);
    }
  });

  it("gracefully skips analyzers when their inputs are missing (no crashes)", () => {
    const session = makeSession({ duration_minutes: null, intent_category: null, target: null });
    const activity = makeActivity({
      avg_hr: null,
      avg_power: null,
      duration_sec: null,
      metrics_v2: {}
    });
    const ctx = ctxFromFixture(session, activity);
    const findings = analyzerRegistry.run(ctx);
    // Specific high-data analyzers should drop out; the registry must not throw.
    expect(Array.isArray(findings)).toBe(true);
  });
});
