import {
  deriveLegSummary,
  buildLegDelta,
  buildTransitionsDelta,
  buildDeterministicProgressionNarrative,
  buildRaceComparison,
  loadPriorRaceCandidates
} from "./comparison";
import type { ComparisonPayload } from "./comparison-schemas";

// ─── Pure helper tests ──────────────────────────────────────────────────────

describe("deriveLegSummary", () => {
  it("returns null for null input", () => {
    expect(deriveLegSummary(null)).toBeNull();
  });

  it("derives bike NP from metrics_v2.normalizedPower", () => {
    const out = deriveLegSummary({
      id: "x",
      race_segment_role: "bike",
      duration_sec: 7200,
      distance_m: 60000,
      avg_hr: 150,
      avg_power: 165,
      metrics_v2: { normalizedPower: 168 }
    });
    expect(out?.np).toBe(168);
  });

  it("falls back to halves average when normalizedPower is missing", () => {
    const out = deriveLegSummary({
      id: "x",
      race_segment_role: "bike",
      duration_sec: 7200,
      distance_m: 60000,
      avg_hr: 150,
      avg_power: 200,
      metrics_v2: { halves: { firstHalfAvgPower: 210, lastHalfAvgPower: 190 } }
    });
    expect(out?.np).toBe(200);
  });

  it("computes run pace as sec/km", () => {
    const out = deriveLegSummary({
      id: "x",
      race_segment_role: "run",
      duration_sec: 2700,
      distance_m: 10000,
      avg_hr: 160,
      avg_power: null,
      metrics_v2: null
    });
    expect(out?.pace).toBe(270);
  });

  it("computes swim pace as sec/100m", () => {
    const out = deriveLegSummary({
      id: "x",
      race_segment_role: "swim",
      duration_sec: 1500,
      distance_m: 1500,
      avg_hr: 155,
      avg_power: null,
      metrics_v2: null
    });
    expect(out?.pace).toBe(100);
  });
});

describe("buildLegDelta", () => {
  it("returns null when either side is missing", () => {
    expect(buildLegDelta(null, { id: "p", race_segment_role: "bike", duration_sec: 100, distance_m: null, avg_hr: null, avg_power: null, metrics_v2: null })).toBeNull();
  });

  it("computes positive duration delta when this is slower", () => {
    const delta = buildLegDelta(
      { id: "t", race_segment_role: "bike", duration_sec: 7300, distance_m: 60000, avg_hr: 152, avg_power: 168, metrics_v2: { normalizedPower: 170 } },
      { id: "p", race_segment_role: "bike", duration_sec: 7200, distance_m: 60000, avg_hr: 150, avg_power: 165, metrics_v2: { normalizedPower: 167 } }
    );
    expect(delta).not.toBeNull();
    expect(delta!.durationDeltaSec).toBe(100);
    expect(delta!.npDelta).toBe(3);
    expect(delta!.avgHrDelta).toBe(2);
  });

  it("returns null deltas when one side lacks the metric", () => {
    const delta = buildLegDelta(
      { id: "t", race_segment_role: "run", duration_sec: 2700, distance_m: 10000, avg_hr: 160, avg_power: null, metrics_v2: null },
      { id: "p", race_segment_role: "run", duration_sec: 2800, distance_m: null, avg_hr: 162, avg_power: null, metrics_v2: null }
    );
    expect(delta?.paceDelta).toBeNull();
    expect(delta?.avgHrDelta).toBe(-2);
  });
});

describe("buildTransitionsDelta", () => {
  it("returns null when either side lacks a transition", () => {
    const out = buildTransitionsDelta(
      [{ id: "t", race_segment_role: "t1", duration_sec: 90, distance_m: null, avg_hr: null, avg_power: null, metrics_v2: null }],
      []
    );
    expect(out.t1Sec).toBeNull();
  });

  it("computes positive delta when this T1 is slower", () => {
    const out = buildTransitionsDelta(
      [{ id: "t", race_segment_role: "t1", duration_sec: 100, distance_m: null, avg_hr: null, avg_power: null, metrics_v2: null }],
      [{ id: "p", race_segment_role: "t1", duration_sec: 80, distance_m: null, avg_hr: null, avg_power: null, metrics_v2: null }]
    );
    expect(out.t1Sec).toBe(20);
  });
});

describe("buildDeterministicProgressionNarrative", () => {
  const samplePayload: ComparisonPayload = {
    thisRace: {
      bundleId: "00000000-0000-0000-0000-000000000001",
      raceProfileId: "00000000-0000-0000-0000-000000000010",
      name: "Triglav 2026",
      date: "2026-04-30",
      distanceType: "olympic",
      finishSec: 9000,
      goalSec: 9100
    },
    priorRace: {
      bundleId: "00000000-0000-0000-0000-000000000002",
      raceProfileId: "00000000-0000-0000-0000-000000000020",
      name: "Bled 2025",
      date: "2025-08-15",
      distanceType: "olympic",
      finishSec: 9135,
      goalSec: 9100
    },
    finishDeltaSec: -135,
    perLeg: {
      swim: { durationDeltaSec: -90, npDelta: null, paceDelta: -3, avgHrDelta: 0, thisDurationSec: 1410, priorDurationSec: 1500 },
      bike: { durationDeltaSec: 0, npDelta: 0, paceDelta: null, avgHrDelta: -1, thisDurationSec: 4500, priorDurationSec: 4500 },
      run: { durationDeltaSec: -45, npDelta: null, paceDelta: -5, avgHrDelta: 1, thisDurationSec: 2700, priorDurationSec: 2745 }
    },
    transitionsDelta: { t1Sec: -10, t2Sec: 0 },
    preRaceStateDelta: { ctl: 5, atl: -2, tsb: 7, taperCompliance: 0.05 }
  };

  it("renders a complete narrative without moralising verbs", () => {
    const out = buildDeterministicProgressionNarrative(samplePayload);
    const all = `${out.headline} ${out.netDelta} ${out.perDiscipline.swim} ${out.perDiscipline.bike} ${out.perDiscipline.run}`;
    expect(out.headline.toLowerCase()).toContain("improvement");
    expect(out.headline).toContain("Bled 2025");
    expect(out.netDelta.toLowerCase()).toContain("faster");
    expect(out.perDiscipline.bike).toContain("Bike");
    expect(out.perDiscipline.bike?.toLowerCase()).toContain("np held within 1w");
    expect(all).not.toMatch(/should have|failed|missed/i);
  });

  it("handles regression framing when finish is slower", () => {
    const slower: ComparisonPayload = {
      ...samplePayload,
      finishDeltaSec: 60,
      perLeg: { swim: null, bike: null, run: null }
    };
    const out = buildDeterministicProgressionNarrative(slower);
    expect(out.headline.toLowerCase()).toContain("regression");
    expect(out.netDelta.toLowerCase()).toContain("slower");
    expect(out.perDiscipline.swim).toBeNull();
  });
});

// ─── Orchestrator + loadPriorRaceCandidates integration ─────────────────────

type MockTables = {
  race_bundles?: any[];
  race_profiles?: any[];
  completed_activities?: any[];
};

function makeSupabaseMock(tables: MockTables) {
  function makeQuery(table: string) {
    type FilterFn = (row: any) => boolean;
    const filters: FilterFn[] = [];
    let inFilter: { col: string; ids: any[] } | null = null;
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
      in: (col: string, ids: any[]) => {
        inFilter = { col, ids };
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderBy = { col, asc: opts?.ascending ?? true };
        return builder;
      },
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: exec()[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: exec(), error: null })
    };
    return builder;
  }
  return { from: makeQuery } as any;
}

describe("loadPriorRaceCandidates", () => {
  it("filters to same distance type and excludes the bundle itself", async () => {
    const supabase = makeSupabaseMock({
      race_bundles: [
        { id: "00000000-0000-0000-0000-00000000aaaa", user_id: "user-1", started_at: "2026-04-30T07:00:00.000Z", total_duration_sec: 9000, goal_time_sec: 9100, race_profile_id: "00000000-0000-0000-0000-0000000000a1" },
        { id: "00000000-0000-0000-0000-00000000cccc", user_id: "user-1", started_at: "2025-08-15T07:00:00.000Z", total_duration_sec: 9135, goal_time_sec: 9100, race_profile_id: "00000000-0000-0000-0000-0000000000a2" },
        { id: "00000000-0000-0000-0000-00000000dddd", user_id: "user-1", started_at: "2025-05-01T07:00:00.000Z", total_duration_sec: 18000, goal_time_sec: 18000, race_profile_id: "00000000-0000-0000-0000-0000000000a3" },
        { id: "00000000-0000-0000-0000-00000000eeee", user_id: "user-1", started_at: "2024-09-10T07:00:00.000Z", total_duration_sec: 9300, goal_time_sec: 9300, race_profile_id: "00000000-0000-0000-0000-0000000000a4" }
      ],
      race_profiles: [
        { id: "00000000-0000-0000-0000-0000000000a1", user_id: "user-1", name: "Triglav 2026", date: "2026-04-30", distance_type: "olympic" },
        { id: "00000000-0000-0000-0000-0000000000a2", user_id: "user-1", name: "Bled 2025", date: "2025-08-15", distance_type: "olympic" },
        { id: "00000000-0000-0000-0000-0000000000a3", user_id: "user-1", name: "Half 2025", date: "2025-05-01", distance_type: "half" },
        { id: "00000000-0000-0000-0000-0000000000a4", user_id: "user-1", name: "Olympic 2024", date: "2024-09-10", distance_type: "olympic" }
      ]
    });

    const out = await loadPriorRaceCandidates(supabase, "user-1", "00000000-0000-0000-0000-00000000aaaa");
    expect(out.map((c) => c.bundleId)).toEqual(["00000000-0000-0000-0000-00000000cccc", "00000000-0000-0000-0000-00000000eeee"]);
    expect(out.every((c) => c.distanceType === "olympic")).toBe(true);
  });

  it("returns empty when the bundle has no profile distance_type", async () => {
    const supabase = makeSupabaseMock({
      race_bundles: [
        { id: "00000000-0000-0000-0000-00000000aaaa", user_id: "user-1", started_at: "2026-04-30T07:00:00.000Z", total_duration_sec: 9000, goal_time_sec: null, race_profile_id: null }
      ]
    });
    const out = await loadPriorRaceCandidates(supabase, "user-1", "00000000-0000-0000-0000-00000000aaaa");
    expect(out).toHaveLength(0);
  });
});

describe("buildRaceComparison (orchestrator)", () => {
  beforeAll(() => {
    delete process.env.OPENAI_API_KEY; // force fallback narrative
  });

  it("rejects comparison of two bundles with different distance types", async () => {
    const supabase = makeSupabaseMock({
      race_bundles: [
        { id: "00000000-0000-0000-0000-00000000aaaa", user_id: "user-1", started_at: "2026-04-30T07:00:00.000Z", total_duration_sec: 9000, goal_time_sec: 9100, race_profile_id: "00000000-0000-0000-0000-0000000000a1", pre_race_ctl: 70, pre_race_atl: 50, pre_race_tsb: 20, taper_compliance_score: 0.9 },
        { id: "00000000-0000-0000-0000-00000000bbbb", user_id: "user-1", started_at: "2025-05-01T07:00:00.000Z", total_duration_sec: 18000, goal_time_sec: 18000, race_profile_id: "00000000-0000-0000-0000-0000000000a3", pre_race_ctl: 65, pre_race_atl: 50, pre_race_tsb: 15, taper_compliance_score: 0.85 }
      ],
      race_profiles: [
        { id: "00000000-0000-0000-0000-0000000000a1", user_id: "user-1", name: "Olympic 2026", date: "2026-04-30", distance_type: "olympic" },
        { id: "00000000-0000-0000-0000-0000000000a3", user_id: "user-1", name: "Half 2025", date: "2025-05-01", distance_type: "half" }
      ]
    });

    const result = await buildRaceComparison({
      supabase,
      userId: "user-1",
      bundleId: "00000000-0000-0000-0000-00000000aaaa",
      priorBundleId: "00000000-0000-0000-0000-00000000bbbb"
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("incompatible_distance");
  });

  it("produces a payload + narrative for a same-distance comparison", async () => {
    const supabase = makeSupabaseMock({
      race_bundles: [
        { id: "00000000-0000-0000-0000-00000000aaaa", user_id: "user-1", started_at: "2026-04-30T07:00:00.000Z", total_duration_sec: 9000, goal_time_sec: 9100, race_profile_id: "00000000-0000-0000-0000-0000000000a1", pre_race_ctl: 70, pre_race_atl: 50, pre_race_tsb: 20, taper_compliance_score: 0.9 },
        { id: "00000000-0000-0000-0000-00000000bbbb", user_id: "user-1", started_at: "2025-08-15T07:00:00.000Z", total_duration_sec: 9135, goal_time_sec: 9100, race_profile_id: "00000000-0000-0000-0000-0000000000a2", pre_race_ctl: 65, pre_race_atl: 50, pre_race_tsb: 15, taper_compliance_score: 0.85 }
      ],
      race_profiles: [
        { id: "00000000-0000-0000-0000-0000000000a1", user_id: "user-1", name: "Triglav 2026", date: "2026-04-30", distance_type: "olympic" },
        { id: "00000000-0000-0000-0000-0000000000a2", user_id: "user-1", name: "Bled 2025", date: "2025-08-15", distance_type: "olympic" }
      ],
      completed_activities: [
        { id: "t-bike", user_id: "user-1", race_bundle_id: "00000000-0000-0000-0000-00000000aaaa", race_segment_role: "bike", duration_sec: 4500, distance_m: 40000, avg_hr: 152, avg_power: 168, metrics_v2: { normalizedPower: 170 } },
        { id: "t-run", user_id: "user-1", race_bundle_id: "00000000-0000-0000-0000-00000000aaaa", race_segment_role: "run", duration_sec: 2700, distance_m: 10000, avg_hr: 160, avg_power: null, metrics_v2: null },
        { id: "p-bike", user_id: "user-1", race_bundle_id: "00000000-0000-0000-0000-00000000bbbb", race_segment_role: "bike", duration_sec: 4500, distance_m: 40000, avg_hr: 153, avg_power: 165, metrics_v2: { normalizedPower: 167 } },
        { id: "p-run", user_id: "user-1", race_bundle_id: "00000000-0000-0000-0000-00000000bbbb", race_segment_role: "run", duration_sec: 2745, distance_m: 10000, avg_hr: 159, avg_power: null, metrics_v2: null }
      ]
    });

    const result = await buildRaceComparison({
      supabase,
      userId: "user-1",
      bundleId: "00000000-0000-0000-0000-00000000aaaa",
      priorBundleId: "00000000-0000-0000-0000-00000000bbbb"
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.payload.finishDeltaSec).toBe(-135);
    expect(result.payload.perLeg.bike?.npDelta).toBe(3);
    expect(result.payload.perLeg.run?.durationDeltaSec).toBe(-45);
    expect(result.payload.preRaceStateDelta.ctl).toBe(5);
    expect(result.narrative.headline.length).toBeGreaterThan(0);
    expect(result.source).toBe("fallback");
  });
});
