import {
  pickMatchedAxis,
  buildDeterministicLinkNarrative,
  buildDeterministicAiFallback,
  buildTrainingToRaceLinks,
  type RaceLegSummary,
  type TrainingLinkMetrics
} from "./training-links";
import type { TrainingToRaceLinks } from "./training-links-schemas";

// ─── Pure helper tests ──────────────────────────────────────────────────────

describe("pickMatchedAxis", () => {
  const baseBikeLeg: RaceLegSummary = {
    role: "bike",
    durationSec: 7200,
    avgPower: 200,
    avgHr: 150,
    avgPace: null,
    normalizedPower: 210
  };
  const baseRunLeg: RaceLegSummary = {
    role: "run",
    durationSec: 2700,
    avgPower: null,
    avgHr: 160,
    avgPace: 270,
    normalizedPower: null
  };

  it("bike prefers NP when both sides have it", () => {
    const metrics: TrainingLinkMetrics = { avgPower: 200, normalizedPower: 215, avgPace: null, avgHr: 152 };
    expect(pickMatchedAxis("bike", baseBikeLeg, metrics)).toBe("np");
  });

  it("bike falls back to hr_at_power when NP is missing on candidate", () => {
    const metrics: TrainingLinkMetrics = { avgPower: 200, normalizedPower: null, avgPace: null, avgHr: 152 };
    expect(pickMatchedAxis("bike", baseBikeLeg, metrics)).toBe("hr_at_power");
  });

  it("bike falls to duration when no power data", () => {
    const metrics: TrainingLinkMetrics = { avgPower: null, normalizedPower: null, avgPace: null, avgHr: null };
    expect(pickMatchedAxis("bike", baseBikeLeg, metrics)).toBe("duration");
  });

  it("run prefers pace when both sides have it", () => {
    const metrics: TrainingLinkMetrics = { avgPower: null, normalizedPower: null, avgPace: 275, avgHr: 158 };
    expect(pickMatchedAxis("run", baseRunLeg, metrics)).toBe("pace");
  });

  it("run falls back to hr_at_power without pace", () => {
    const metrics: TrainingLinkMetrics = { avgPower: null, normalizedPower: null, avgPace: null, avgHr: 158 };
    expect(pickMatchedAxis("run", baseRunLeg, metrics)).toBe("hr_at_power");
  });

  it("run falls to duration with no metric overlap", () => {
    const metrics: TrainingLinkMetrics = { avgPower: null, normalizedPower: null, avgPace: null, avgHr: null };
    expect(pickMatchedAxis("run", baseRunLeg, metrics)).toBe("duration");
  });
});

describe("buildDeterministicLinkNarrative", () => {
  it("renders an NP-axis narrative with rounded watts", () => {
    const out = buildDeterministicLinkNarrative(
      "bike",
      "np",
      { role: "bike", durationSec: 7200, avgPower: 200, avgHr: 150, avgPace: null, normalizedPower: 167.4 },
      { avgPower: 200, normalizedPower: 168, avgPace: null, avgHr: 150 },
      "Vrhnika 2hr brick",
      "2026-03-15"
    );
    expect(out).toContain("167W");
    expect(out).toContain("168W");
    expect(out).toContain("Vrhnika");
    expect(out).toContain("2026-03-15");
  });

  it("renders a pace-axis narrative formatted as MM:SS/km for run", () => {
    const out = buildDeterministicLinkNarrative(
      "run",
      "pace",
      { role: "run", durationSec: 2700, avgPower: null, avgHr: 160, avgPace: 270, normalizedPower: null },
      { avgPower: null, normalizedPower: null, avgPace: 268, avgHr: 158 },
      "10K race-pace tempo",
      "2026-04-02"
    );
    expect(out).toContain("/km");
    expect(out).toContain("4:30");
    expect(out).toContain("10K race-pace tempo");
  });

  it("does not moralise for duration fallback narratives", () => {
    const out = buildDeterministicLinkNarrative(
      "swim",
      "duration",
      { role: "swim", durationSec: 1500, avgPower: null, avgHr: null, avgPace: null, normalizedPower: null },
      { avgPower: null, normalizedPower: null, avgPace: null, avgHr: null },
      "Long pool set",
      "2026-04-10"
    );
    expect(out).not.toMatch(/should have|failed|missed/i);
    expect(out).toContain("Long pool set");
  });
});

describe("buildDeterministicAiFallback", () => {
  it("summarizes per-leg counts and warning count", () => {
    const perLeg: TrainingToRaceLinks["perLeg"] = {
      swim: [],
      bike: [
        {
          sessionId: "11111111-1111-1111-1111-111111111111",
          date: "2026-03-01",
          sessionName: "Race-pace ride",
          durationSec: 7200,
          matchedAxis: "np",
          matchScore: 0.81,
          metricsV2: { avgPower: 200, normalizedPower: 215, avgPace: null, avgHr: 150 },
          narrative: "ok"
        }
      ],
      run: []
    };
    const warnings = [
      {
        sessionId: "22222222-2222-2222-2222-222222222222",
        date: "2026-04-12",
        sessionName: "Brick run",
        observation: "ran below race pace"
      }
    ];
    const out = buildDeterministicAiFallback(perLeg, warnings);
    expect(out).toContain("1 bike");
    expect(out).toContain("1 warning");
    expect(out).not.toContain("0 swim");
  });

  it("returns the no-analogue message when every leg is empty", () => {
    const perLeg: TrainingToRaceLinks["perLeg"] = { swim: [], bike: [], run: [] };
    const out = buildDeterministicAiFallback(perLeg, []);
    expect(out.toLowerCase()).toContain("no comparable");
  });
});

// ─── Orchestrator integration test (mocked supabase) ────────────────────────

type MockTables = {
  sessions?: any[];
  session_activity_links?: any[];
  completed_activities?: any[];
};

function makeSupabaseMock(tables: MockTables) {
  function makeQuery(table: string) {
    type FilterFn = (row: any) => boolean;
    const filters: FilterFn[] = [];
    let inFilter: { col: string; ids: string[] } | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;

    const exec = (): any[] => {
      const data = (tables as any)[table] ?? [];
      let rows = (data as any[]).slice();
      for (const f of filters) rows = rows.filter(f);
      if (inFilter) rows = rows.filter((r) => inFilter!.ids.includes(r[inFilter!.col]));
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
      neq: (col: string, value: any) => {
        filters.push((row) => row[col] !== value);
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
      in: (col: string, ids: string[]) => {
        inFilter = { col, ids };
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderBy = { col, asc: opts?.ascending ?? true };
        return builder;
      },
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: exec()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: exec()[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: exec(), error: null })
    };
    return builder;
  }
  return { from: makeQuery } as any;
}

describe("buildTrainingToRaceLinks (orchestrator)", () => {
  beforeAll(() => {
    delete process.env.OPENAI_API_KEY; // force the AI fallback path
  });

  it("returns empty perLeg + empty warnings when build pool is empty", async () => {
    const supabase = makeSupabaseMock({});
    const result = await buildTrainingToRaceLinks({
      supabase,
      userId: "user-1",
      bundleId: "bundle-1",
      raceDateIso: "2026-04-30T07:00:00.000Z",
      legs: [
        { role: "swim", durationSec: 1500, avgPower: null, avgHr: 160, avgPace: 105, normalizedPower: null },
        { role: "bike", durationSec: 7200, avgPower: 200, avgHr: 150, avgPace: null, normalizedPower: 210 },
        { role: "run", durationSec: 2700, avgPower: null, avgHr: 165, avgPace: 270, normalizedPower: null }
      ]
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.payload.perLeg.swim).toHaveLength(0);
    expect(result.payload.perLeg.bike).toHaveLength(0);
    expect(result.payload.perLeg.run).toHaveLength(0);
    expect(result.payload.warningsMissed).toHaveLength(0);
    expect(result.payload.aiNarrative).toBeNull();
    expect(result.payload.source).toBe("fallback");
  });

  it("matches a comparable bike session with NP and produces a narrative", async () => {
    const supabase = makeSupabaseMock({
      sessions: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          user_id: "user-1",
          date: "2026-03-15",
          sport: "bike",
          type: "race-pace",
          session_name: "Vrhnika 2hr brick",
          session_role: "key",
          duration_minutes: 120,
          status: "completed"
        }
      ],
      session_activity_links: [
        {
          user_id: "user-1",
          planned_session_id: "11111111-1111-1111-1111-111111111111",
          completed_activity_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          confirmation_status: "confirmed"
        }
      ],
      completed_activities: [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          user_id: "user-1",
          sport_type: "bike",
          avg_power: 165,
          avg_hr: 148,
          avg_pace_per_100m_sec: null,
          duration_sec: 7200,
          distance_m: 60000,
          metrics_v2: { normalizedPower: 167 }
        }
      ]
    });

    const result = await buildTrainingToRaceLinks({
      supabase,
      userId: "user-1",
      bundleId: "bundle-1",
      raceDateIso: "2026-04-30T07:00:00.000Z",
      legs: [
        { role: "bike", durationSec: 7200, avgPower: 200, avgHr: 150, avgPace: null, normalizedPower: 167 }
      ]
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.payload.perLeg.bike).toHaveLength(1);
    const link = result.payload.perLeg.bike[0];
    expect(link.matchedAxis).toBe("np");
    expect(link.metricsV2.normalizedPower).toBe(167);
    expect(link.narrative).toContain("Vrhnika");
    expect(result.payload.windowWeeks).toBe(8);
  });

  it("flags a key session whose execution_result.intentMatch is missed", async () => {
    const supabase = makeSupabaseMock({
      sessions: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          user_id: "user-1",
          date: "2026-04-12",
          sport: "run",
          type: "tempo",
          session_name: "Threshold brick run",
          session_role: "key",
          duration_minutes: 45,
          status: "completed",
          execution_result: {
            coach_verdict: {
              sessionVerdict: {
                intentMatch: "missed",
                headline: "Tempo target slipped — pace 8% under target through the back half."
              }
            }
          }
        }
      ]
    });

    const result = await buildTrainingToRaceLinks({
      supabase,
      userId: "user-1",
      bundleId: "bundle-1",
      raceDateIso: "2026-04-30T07:00:00.000Z",
      legs: [
        { role: "run", durationSec: 2700, avgPower: null, avgHr: 165, avgPace: 270, normalizedPower: null }
      ]
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.payload.warningsMissed).toHaveLength(1);
    expect(result.payload.warningsMissed[0].observation).toContain("Tempo target");
  });

  it("respects the windowWeeks override", async () => {
    const supabase = makeSupabaseMock({});
    const result = await buildTrainingToRaceLinks({
      supabase,
      userId: "user-1",
      bundleId: "bundle-1",
      raceDateIso: "2026-04-30T07:00:00.000Z",
      legs: [{ role: "run", durationSec: 2700, avgPower: null, avgHr: 160, avgPace: 270, normalizedPower: null }],
      windowWeeks: 12
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.payload.windowWeeks).toBe(12);
  });
});
