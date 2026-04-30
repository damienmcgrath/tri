import {
  summarizeTrajectory,
  intentMatchToScore,
  buildDeterministicVerdict,
  buildPreRaceRetrospective
} from "./retrospective";
import type { CtlTrajectoryPoint } from "./retrospective-schemas";

// ─── Pure helper tests ──────────────────────────────────────────────────────

describe("summarizeTrajectory", () => {
  it("identifies the highest CTL point as peak", () => {
    const series: CtlTrajectoryPoint[] = [
      { date: "2026-03-01", ctl: 50, atl: 40, tsb: 10 },
      { date: "2026-03-15", ctl: 65, atl: 55, tsb: 10 },
      { date: "2026-04-01", ctl: 72, atl: 60, tsb: 12 },
      { date: "2026-04-15", ctl: 70, atl: 50, tsb: 20 },
      { date: "2026-04-29", ctl: 60, atl: 35, tsb: 25 }
    ];
    const out = summarizeTrajectory(series, "2026-04-30T07:00:00.000Z");
    expect(out.peakCtl).toBe(72);
    expect(out.peakCtlDate).toBe("2026-04-01");
    expect(out.daysFromPeakToRace).toBe(29);
  });

  it("returns zeros for empty series", () => {
    const out = summarizeTrajectory([], "2026-04-30T07:00:00.000Z");
    expect(out.peakCtl).toBe(0);
    expect(out.daysFromPeakToRace).toBe(0);
  });
});

describe("intentMatchToScore", () => {
  it("maps intentMatch tokens to 0..1", () => {
    expect(intentMatchToScore("on_target")).toBe(1);
    expect(intentMatchToScore("partial")).toBe(0.5);
    expect(intentMatchToScore("missed")).toBe(0);
    expect(intentMatchToScore("unknown")).toBeNull();
    expect(intentMatchToScore(undefined)).toBeNull();
  });
});

describe("buildDeterministicVerdict", () => {
  const baseTrajectory = {
    sport: "total" as const,
    series: [],
    peakCtl: 70,
    peakCtlDate: "2026-04-25",
    targetPeakCtl: null,
    daysFromPeakToRace: 5,
    raceMorningCtl: 65
  };

  it("flags an early CTL peak", () => {
    const out = buildDeterministicVerdict({
      taper: { complianceScore: 0.9, summary: null },
      trajectory: { ...baseTrajectory, daysFromPeakToRace: 21 },
      execution: { totalKeySessions: 8, completedKeySessions: 8, rate: 1, keySessionsList: [] }
    });
    expect(out.headline.toLowerCase()).toContain("peak");
    expect(out.actionableAdjustment).toContain("21");
  });

  it("flags a low-taper-compliance build", () => {
    const out = buildDeterministicVerdict({
      taper: { complianceScore: 0.6, summary: null },
      trajectory: baseTrajectory,
      execution: { totalKeySessions: 8, completedKeySessions: 8, rate: 1, keySessionsList: [] }
    });
    expect(out.headline.toLowerCase()).toContain("taper");
    expect(out.actionableAdjustment).toContain("60%");
  });

  it("flags a low key-session execution rate", () => {
    const out = buildDeterministicVerdict({
      taper: { complianceScore: 0.92, summary: null },
      trajectory: baseTrajectory,
      execution: { totalKeySessions: 10, completedKeySessions: 5, rate: 0.5, keySessionsList: [] }
    });
    expect(out.headline.toLowerCase()).toContain("key");
  });

  it("acknowledges a clean build", () => {
    const out = buildDeterministicVerdict({
      taper: { complianceScore: 0.95, summary: null },
      trajectory: baseTrajectory,
      execution: { totalKeySessions: 8, completedKeySessions: 8, rate: 1, keySessionsList: [] }
    });
    expect(out.headline.toLowerCase()).toContain("clean");
    expect(out.actionableAdjustment.toLowerCase()).toContain("hold");
  });

  it("never uses moralising verbs", () => {
    const out = buildDeterministicVerdict({
      taper: { complianceScore: 0.4, summary: null },
      trajectory: { ...baseTrajectory, daysFromPeakToRace: 25 },
      execution: { totalKeySessions: 10, completedKeySessions: 4, rate: 0.4, keySessionsList: [] }
    });
    const all = `${out.headline} ${out.body} ${out.actionableAdjustment}`;
    expect(all).not.toMatch(/should have|failed|missed/i);
  });
});

// ─── Orchestrator integration test ──────────────────────────────────────────

type MockTables = {
  athlete_fitness?: any[];
  sessions?: any[];
};

function makeSupabaseMock(tables: MockTables) {
  function makeQuery(table: string) {
    type FilterFn = (row: any) => boolean;
    const filters: FilterFn[] = [];
    let orderBy: { col: string; asc: boolean } | null = null;

    const exec = (): any[] => {
      const data = (tables as any)[table] ?? [];
      let rows = (data as any[]).slice();
      for (const f of filters) rows = rows.filter(f);
      if (orderBy) {
        rows.sort((a, b) => {
          const av = a[orderBy!.col];
          const bv = b[orderBy!.col];
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (orderBy!.asc ? 1 : -1);
        });
      }
      return rows;
    };
    const builder: any = {
      select: () => builder,
      eq: (col: string, value: any) => {
        filters.push((row) => row[col] === value);
        return builder;
      },
      lt: (col: string, value: any) => {
        filters.push((row) => row[col] < value);
        return builder;
      },
      gte: (col: string, value: any) => {
        filters.push((row) => row[col] >= value);
        return builder;
      },
      lte: (col: string, value: any) => {
        filters.push((row) => row[col] <= value);
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderBy = { col, asc: opts?.ascending ?? true };
        return builder;
      },
      then: (resolve: any) => resolve({ data: exec(), error: null })
    };
    return builder;
  }
  return { from: makeQuery } as any;
}

describe("buildPreRaceRetrospective (orchestrator)", () => {
  beforeAll(() => {
    delete process.env.OPENAI_API_KEY; // force fallback
  });

  it("computes a deterministic retrospective from trajectory + execution + taper", async () => {
    const supabase = makeSupabaseMock({
      athlete_fitness: [
        { user_id: "user-1", sport: "total", date: "2026-03-05", ctl: 50, atl: 45, tsb: 5 },
        { user_id: "user-1", sport: "total", date: "2026-04-10", ctl: 70, atl: 60, tsb: 10 },
        { user_id: "user-1", sport: "total", date: "2026-04-29", ctl: 65, atl: 30, tsb: 35 }
      ],
      sessions: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          user_id: "user-1",
          date: "2026-03-15",
          session_role: "key",
          session_name: "Key bike intervals",
          sport: "bike",
          type: "intervals",
          status: "completed",
          execution_result: {
            coach_verdict: { sessionVerdict: { intentMatch: "on_target" } }
          }
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          user_id: "user-1",
          date: "2026-04-12",
          session_role: "key",
          session_name: "Threshold brick",
          sport: "run",
          type: "tempo",
          status: "completed",
          execution_result: {
            coach_verdict: { sessionVerdict: { intentMatch: "missed" } }
          }
        }
      ]
    });

    const result = await buildPreRaceRetrospective({
      supabase,
      userId: "user-1",
      bundleId: "bundle-1",
      raceDateIso: "2026-04-30T07:00:00.000Z",
      bundle: {
        pre_race_ctl: 65,
        pre_race_atl: 30,
        pre_race_tsb: 35,
        taper_compliance_score: 0.85,
        taper_compliance_summary: "Reasonable taper, slight overshoot mid-week."
      }
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.payload.ctlTrajectory.peakCtl).toBe(70);
    expect(result.payload.ctlTrajectory.peakCtlDate).toBe("2026-04-10");
    expect(result.payload.ctlTrajectory.daysFromPeakToRace).toBe(20);
    expect(result.payload.ctlTrajectory.raceMorningCtl).toBe(65);
    expect(result.payload.taperReadOut.complianceScore).toBe(0.85);
    expect(result.payload.keySessionExecutionRate.totalKeySessions).toBe(2);
    expect(result.payload.keySessionExecutionRate.completedKeySessions).toBe(2);
    expect(result.payload.verdict.actionableAdjustment.length).toBeGreaterThan(0);
    expect(result.payload.source).toBe("fallback");
  });

  it("produces a verdict even with no athlete_fitness data", async () => {
    const supabase = makeSupabaseMock({});
    const result = await buildPreRaceRetrospective({
      supabase,
      userId: "user-1",
      bundleId: "bundle-1",
      raceDateIso: "2026-04-30T07:00:00.000Z",
      bundle: {
        pre_race_ctl: null,
        pre_race_atl: null,
        pre_race_tsb: null,
        taper_compliance_score: null,
        taper_compliance_summary: null
      }
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.payload.ctlTrajectory.series).toHaveLength(0);
    expect(result.payload.keySessionExecutionRate.totalKeySessions).toBe(0);
    expect(result.payload.verdict.headline.length).toBeGreaterThan(0);
    expect(result.payload.verdict.actionableAdjustment.length).toBeGreaterThan(0);
  });
});
