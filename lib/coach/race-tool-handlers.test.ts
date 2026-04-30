import {
  getRaceObject,
  getRaceSegmentMetrics,
  getPriorRacesForComparison,
  getBestComparableTrainingForSegment
} from "@/lib/coach/race-tool-handlers";

type AnyRow = Record<string, unknown>;

/**
 * Lightweight Supabase mock specialised for the race-tool tests. Each call
 * to from(<table>) returns a fresh chainable builder that resolves to the
 * pre-seeded rows for that table. We don't simulate filters — the
 * production handlers don't rely on them being honoured by the mock to
 * prove correctness; we only assert on the shape of the handler output.
 */
function buildSupabase(tables: Record<string, AnyRow[] | AnyRow | null>) {
  const fromFn = jest.fn((table: string) => {
    const rows = tables[table];
    const isList = Array.isArray(rows);

    const builder: Record<string, jest.Mock> = {};
    builder.select = jest.fn().mockReturnValue(builder);
    builder.eq = jest.fn().mockReturnValue(builder);
    builder.in = jest.fn().mockReturnValue(builder);
    builder.neq = jest.fn().mockReturnValue(builder);
    builder.lt = jest.fn().mockReturnValue(builder);
    builder.gte = jest.fn().mockReturnValue(builder);
    builder.lte = jest.fn().mockReturnValue(builder);
    builder.order = jest.fn().mockReturnValue(builder);
    builder.limit = jest.fn().mockReturnValue(builder);
    builder.maybeSingle = jest.fn().mockResolvedValue({
      data: isList ? (rows[0] ?? null) : (rows ?? null),
      error: null
    });
    // Awaiting the builder directly resolves with `data: <rows>` as Supabase does.
    (builder as unknown as PromiseLike<{ data: unknown; error: null }>).then = (resolve) =>
      Promise.resolve({ data: isList ? rows : (rows ?? null), error: null }).then(resolve);
    return builder;
  });

  return { from: fromFn } as unknown as Parameters<typeof getRaceObject>[0]["supabase"];
}

const ctx = { userId: "u1", athleteId: "u1", email: null };
const bundleId = "bundle-1";

describe("race tool handlers", () => {
  describe("getRaceObject", () => {
    it("throws when bundleId is missing", async () => {
      const supabase = buildSupabase({});
      await expect(
        getRaceObject({ supabase, ctx, bundleId: "" })
      ).rejects.toThrow(/Race scope is required/);
    });

    it("returns the loaded race summary", async () => {
      const supabase = buildSupabase({
        race_bundles: {
          id: bundleId,
          user_id: "u1",
          started_at: "2026-04-15T08:00:00.000Z",
          ended_at: null,
          total_duration_sec: 9000,
          total_distance_m: 51500,
          source: "garmin_multisport",
          race_profile_id: null,
          goal_time_sec: 8400,
          goal_strategy_summary: null,
          course_profile_snapshot: {},
          pre_race_ctl: 80,
          pre_race_atl: 70,
          pre_race_tsb: 10,
          pre_race_tsb_state: "fresh",
          pre_race_ramp_rate: 1,
          pre_race_snapshot_at: "2026-04-14T00:00:00.000Z",
          pre_race_snapshot_status: "captured",
          taper_compliance_score: 0.92,
          taper_compliance_summary: "clean",
          athlete_rating: 4,
          athlete_notes: "Held bike steady",
          issues_flagged: [],
          finish_position: null,
          age_group_position: null,
          subjective_captured_at: "2026-04-15T20:00:00.000Z",
          status: "reviewed",
          inferred_transitions: false
        },
        completed_activities: [],
        race_reviews: null,
        race_lessons: null
      });

      const result = await getRaceObject({ supabase, ctx, bundleId });
      expect(result.bundle.id).toBe(bundleId);
      expect(result.bundle.taper_compliance_score).toBe(0.92);
    });
  });

  describe("getRaceSegmentMetrics", () => {
    it("returns the segment row for the requested role", async () => {
      const supabase = buildSupabase({
        completed_activities: {
          id: "act-bike",
          sport_type: "cycling",
          start_time_utc: "2026-04-15T08:30:00.000Z",
          duration_sec: 5400,
          distance_m: 40000,
          avg_hr: 152,
          avg_power: 215,
          race_segment_role: "bike",
          race_segment_index: 1,
          metrics_v2: { laps: [{ avgPower: 220 }, { avgPower: 210 }] },
          moving_duration_sec: 5400,
          elapsed_duration_sec: 5400,
          avg_pace_per_100m_sec: null
        }
      });

      const result = await getRaceSegmentMetrics({ role: "bike" }, { supabase, ctx, bundleId });
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.activityId).toBe("act-bike");
        expect(result.avgPower).toBe(215);
      }
    });

    it("returns found=false when the segment does not exist", async () => {
      const supabase = buildSupabase({ completed_activities: null });
      const result = await getRaceSegmentMetrics({ role: "swim" }, { supabase, ctx, bundleId });
      expect(result.found).toBe(false);
    });
  });

  describe("getPriorRacesForComparison", () => {
    it("filters to same distance type by default", async () => {
      const supabase = buildSupabase({
        race_bundles: [
          // The scoped bundle (loaded once by loadSummaryOrThrow)
          {
            id: bundleId,
            user_id: "u1",
            started_at: "2026-04-15T08:00:00.000Z",
            ended_at: null,
            total_duration_sec: 9000,
            total_distance_m: 51500,
            source: "garmin_multisport",
            race_profile_id: "profile-current",
            goal_time_sec: 8400,
            goal_strategy_summary: null,
            course_profile_snapshot: {},
            pre_race_ctl: null,
            pre_race_atl: null,
            pre_race_tsb: null,
            pre_race_tsb_state: null,
            pre_race_ramp_rate: null,
            pre_race_snapshot_at: null,
            pre_race_snapshot_status: "pending",
            taper_compliance_score: null,
            taper_compliance_summary: null,
            athlete_rating: null,
            athlete_notes: null,
            issues_flagged: [],
            finish_position: null,
            age_group_position: null,
            subjective_captured_at: null,
            status: "imported",
            inferred_transitions: false
          }
        ]
      });

      // First call to .from('race_bundles') resolves the scoped bundle (via
      // maybeSingle), the second resolves the prior list. We approximate
      // that by mutating the table after the first resolution.
      let callIndex = 0;
      const fromFn = jest.fn((table: string) => {
        const builder: Record<string, jest.Mock> = {};
        builder.select = jest.fn().mockReturnValue(builder);
        builder.eq = jest.fn().mockReturnValue(builder);
        builder.in = jest.fn().mockReturnValue(builder);
        builder.neq = jest.fn().mockReturnValue(builder);
        builder.lt = jest.fn().mockReturnValue(builder);
        builder.gte = jest.fn().mockReturnValue(builder);
        builder.lte = jest.fn().mockReturnValue(builder);
        builder.order = jest.fn().mockReturnValue(builder);
        builder.limit = jest.fn().mockReturnValue(builder);

        if (table === "race_bundles") {
          callIndex += 1;
          if (callIndex === 1) {
            // bundle-helpers.loadRaceBundleSummary maybeSingle
            builder.maybeSingle = jest.fn().mockResolvedValue({
              data: {
                id: bundleId,
                user_id: "u1",
                started_at: "2026-04-15T08:00:00.000Z",
                total_duration_sec: 9000,
                total_distance_m: 51500,
                source: "garmin_multisport",
                race_profile_id: "profile-current",
                goal_time_sec: 8400,
                goal_strategy_summary: null,
                course_profile_snapshot: {},
                pre_race_snapshot_status: "pending",
                issues_flagged: [],
                status: "imported",
                inferred_transitions: false
              },
              error: null
            });
            (builder as unknown as PromiseLike<unknown>).then = (resolve) =>
              Promise.resolve({ data: null, error: null }).then(resolve as never);
          } else {
            const data = [
              {
                id: "prior-same-distance",
                started_at: "2026-01-15T08:00:00.000Z",
                total_duration_sec: 9300,
                goal_time_sec: 9000,
                race_profile_id: "profile-prior-same"
              },
              {
                id: "prior-different-distance",
                started_at: "2025-09-15T08:00:00.000Z",
                total_duration_sec: 18000,
                goal_time_sec: null,
                race_profile_id: "profile-prior-diff"
              }
            ];
            (builder as unknown as PromiseLike<unknown>).then = (resolve) =>
              Promise.resolve({ data, error: null }).then(resolve as never);
          }
        } else if (table === "race_profiles") {
          const data = [
            { id: "profile-current", name: "Olympic A", distance_type: "olympic" },
            { id: "profile-prior-same", name: "Olympic B", distance_type: "olympic" },
            { id: "profile-prior-diff", name: "Half Iron A", distance_type: "half_iron" }
          ];
          (builder as unknown as PromiseLike<unknown>).then = (resolve) =>
            Promise.resolve({ data, error: null }).then(resolve as never);
          builder.maybeSingle = jest.fn().mockResolvedValue({
            data: { id: "profile-current", name: "Olympic A", date: "2026-04-15", distance_type: "olympic" },
            error: null
          });
        } else if (table === "race_reviews") {
          const data = [
            { race_bundle_id: "prior-same-distance", verdict: { headline: "ok" }, leg_status: { swim: "on_plan" } },
            { race_bundle_id: "prior-different-distance", verdict: null, leg_status: null }
          ];
          (builder as unknown as PromiseLike<unknown>).then = (resolve) =>
            Promise.resolve({ data, error: null }).then(resolve as never);
          builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        } else if (table === "race_lessons") {
          builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        } else if (table === "completed_activities") {
          (builder as unknown as PromiseLike<unknown>).then = (resolve) =>
            Promise.resolve({ data: [], error: null }).then(resolve as never);
        } else {
          (builder as unknown as PromiseLike<unknown>).then = (resolve) =>
            Promise.resolve({ data: null, error: null }).then(resolve as never);
          builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        }
        return builder;
      });

      const supabase2 = { from: fromFn } as unknown as Parameters<typeof getPriorRacesForComparison>[1]["supabase"];

      const result = await getPriorRacesForComparison(
        { sameDistanceOnly: true, limit: 5 },
        { supabase: supabase2, ctx, bundleId }
      );

      expect(result.priorRaces).toHaveLength(1);
      expect(result.priorRaces[0]?.bundleId).toBe("prior-same-distance");
      expect(result.priorRaces[0]?.distanceType).toBe("olympic");
    });
  });

  describe("getBestComparableTrainingForSegment", () => {
    it("returns found=false when the segment diagnostic has no comparable training", async () => {
      const fromFn = jest.fn((table: string) => {
        const builder: Record<string, jest.Mock> = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          lt: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
        };
        if (table === "race_bundles") {
          builder.maybeSingle = jest.fn().mockResolvedValue({
            data: {
              id: bundleId,
              user_id: "u1",
              started_at: "2026-04-15T08:00:00.000Z",
              total_duration_sec: 9000,
              total_distance_m: 51500,
              source: "garmin_multisport",
              race_profile_id: null,
              goal_time_sec: null,
              goal_strategy_summary: null,
              course_profile_snapshot: {},
              pre_race_snapshot_status: "pending",
              issues_flagged: [],
              status: "imported",
              inferred_transitions: false
            },
            error: null
          });
        }
        if (table === "race_reviews") {
          builder.maybeSingle = jest.fn().mockResolvedValue({
            data: { segment_diagnostics: [{ discipline: "bike", referenceFrames: { vsBestComparableTraining: null } }] },
            error: null
          });
        }
        // race_lessons + completed_activities default null
        return builder;
      });
      const supabase = { from: fromFn } as unknown as Parameters<typeof getBestComparableTrainingForSegment>[1]["supabase"];

      const result = await getBestComparableTrainingForSegment(
        { role: "bike" },
        { supabase, ctx, bundleId }
      );
      expect(result.found).toBe(false);
    });
  });
});
