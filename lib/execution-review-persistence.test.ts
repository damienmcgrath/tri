import { buildWeeklyExecutionBrief } from "./execution-review-persistence";
import type { SupabaseClient } from "@supabase/supabase-js";

type ReviewOverrides = {
  intentMatch?: "on_target" | "partial" | "missed";
  provisional?: boolean;
};

function buildExecutionResult(overrides: ReviewOverrides = {}) {
  const intentMatch = overrides.intentMatch ?? "on_target";
  const provisional = overrides.provisional ?? false;
  return {
    version: 2,
    deterministic: {
      planned: {},
      actual: {},
      detectedIssues: [],
      missingEvidence: [],
      rulesSummary: {
        intentMatch,
        executionScore: 80,
        executionScoreBand: "On target",
        confidence: provisional ? "low" : "high",
        provisional,
        evidenceCount: 3,
        executionCost: "low"
      }
    }
  };
}

function buildSupabaseStub(sessions: Array<{ id: string; session_name: string; type: string; date: string; execution_result: ReturnType<typeof buildExecutionResult> }>): SupabaseClient {
  const builder = {
    select: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: sessions, error: null })
  };
  return { from: jest.fn().mockReturnValue(builder) } as unknown as SupabaseClient;
}

describe("buildWeeklyExecutionBrief", () => {
  test("emits an all-provisional caveat when every reviewed session is provisional", async () => {
    const supabase = buildSupabaseStub([
      { id: "s1", session_name: "Easy run", type: "Run", date: "2026-03-09", execution_result: buildExecutionResult({ intentMatch: "on_target", provisional: true }) },
      { id: "s2", session_name: "Bike Z2", type: "Bike", date: "2026-03-10", execution_result: buildExecutionResult({ intentMatch: "on_target", provisional: true }) }
    ]);

    const brief = await buildWeeklyExecutionBrief({
      supabase,
      athleteId: "user-1",
      weekStart: "2026-03-09",
      weekEnd: "2026-03-15",
      athleteContext: null
    });

    expect(brief.trend.provisionalCount).toBe(2);
    expect(brief.trend.reviewedCount).toBe(2);
    expect(brief.confidenceNote).not.toBeNull();
    expect(brief.confidenceNote).toMatch(/provisional/i);
  });

  test("keeps the N-of-M provisional note when only some reviews are provisional", async () => {
    const supabase = buildSupabaseStub([
      { id: "s1", session_name: "Easy run", type: "Run", date: "2026-03-09", execution_result: buildExecutionResult({ intentMatch: "on_target", provisional: true }) },
      { id: "s2", session_name: "Bike Z2", type: "Bike", date: "2026-03-10", execution_result: buildExecutionResult({ intentMatch: "on_target", provisional: false }) }
    ]);

    const brief = await buildWeeklyExecutionBrief({
      supabase,
      athleteId: "user-1",
      weekStart: "2026-03-09",
      weekEnd: "2026-03-15",
      athleteContext: null
    });

    expect(brief.confidenceNote).toMatch(/1 of 2 reviews?/i);
  });

  test("omits the confidence note when no reviews are provisional", async () => {
    const supabase = buildSupabaseStub([
      { id: "s1", session_name: "Easy run", type: "Run", date: "2026-03-09", execution_result: buildExecutionResult({ intentMatch: "on_target", provisional: false }) }
    ]);

    const brief = await buildWeeklyExecutionBrief({
      supabase,
      athleteId: "user-1",
      weekStart: "2026-03-09",
      weekEnd: "2026-03-15",
      athleteContext: null
    });

    expect(brief.confidenceNote).toBeNull();
  });
});
