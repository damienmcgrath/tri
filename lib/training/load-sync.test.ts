import type { SupabaseClient } from "@supabase/supabase-js";
import { syncSessionLoad } from "./load-sync";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-04-03T12:00:00Z"));
});
afterAll(() => {
  jest.useRealTimers();
});

type UpsertCall = { table: string; data: unknown };
type SelectCall = { table: string };

function buildMockSupabase(options: {
  activity?: Record<string, unknown> | null;
  thresholdFtp?: number | null;
  sessionLoads?: Array<{ sport: string; tss: number }>;
  seedFitness?: Array<{ sport: string; ctl: number; atl: number }>;
  dailyLoads?: Array<{ date: string; sport: string; tss: number }>;
  priorCtl?: Array<{ date: string; sport: string; ctl: number }>;
}) {
  const upsertCalls: UpsertCall[] = [];
  const {
    activity = null,
    thresholdFtp = null,
    sessionLoads = [],
    seedFitness = [],
    dailyLoads = [],
    priorCtl = [],
  } = options;

  const ftpRow = thresholdFtp != null ? { value: thresholdFtp } : null;

  // Build a mock that routes based on the table name passed to from()
  const mock = {
    from: (table: string) => {
      if (table === "completed_activities") {
        return {
          select: () => ({
            eq: function () { return this; },
            maybeSingle: () => ({
              data: activity,
              error: activity === null ? { message: "not found" } : null,
            }),
          }),
        };
      }

      if (table === "athlete_ftp_history") {
        return {
          select: () => ({
            eq: () => ({
              order: function () { return this; },
              limit: () => ({
                maybeSingle: () => ({ data: ftpRow, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === "session_load") {
        return {
          select: () => ({
            eq: function () { return this; },
          }),
          upsert: (data: unknown) => {
            upsertCalls.push({ table: "session_load", data });
            return { error: null };
          },
        };
      }

      if (table === "daily_load") {
        return {
          upsert: (data: unknown) => {
            upsertCalls.push({ table: "daily_load", data });
            return { error: null };
          },
        };
      }

      if (table === "athlete_fitness") {
        return {
          select: () => ({
            eq: function () { return this; },
            gte: () => ({
              order: () => ({ data: dailyLoads, error: null }),
            }),
            lt: () => ({
              order: () => ({
                limit: () => ({ data: priorCtl, error: null }),
              }),
            }),
          }),
          upsert: (data: unknown) => {
            upsertCalls.push({ table: "athlete_fitness", data });
            return { error: null };
          },
        };
      }

      // Default: return chainable no-op
      return {
        select: () => ({
          eq: function () { return this; },
          gte: function () { return this; },
          order: function () { return this; },
          limit: function () { return this; },
          maybeSingle: () => ({ data: null, error: null }),
        }),
        upsert: () => ({ error: null }),
      };
    },
  } as unknown as SupabaseClient;

  return { mock, upsertCalls };
}

// Need to also mock the session_load select for rebuildDailyLoad
function buildFullMockSupabase(activity: Record<string, unknown>) {
  const upsertCalls: UpsertCall[] = [];
  const ftpRow = null;

  const mock = {
    from: (table: string) => {
      if (table === "completed_activities") {
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              maybeSingle: () => ({ data: activity, error: null }),
            };
            return chain;
          },
        };
      }

      if (table === "athlete_ftp_history") {
        return {
          select: () => ({
            eq: () => {
              const chain = {
                order: () => chain,
                limit: () => ({
                  maybeSingle: () => ({ data: ftpRow, error: null }),
                }),
              };
              return chain;
            },
          }),
        };
      }

      if (table === "session_load") {
        return {
          select: () => {
            const chain = {
              eq: () => chain,
            };
            // rebuildDailyLoad calls from("session_load").select().eq().eq()
            // The second eq should return { data, error }
            let eqCount = 0;
            const selectChain = {
              eq: () => {
                eqCount++;
                if (eqCount >= 2) {
                  return { data: [{ sport: "run", tss: 50 }], error: null };
                }
                return selectChain;
              },
            };
            return selectChain;
          },
          upsert: (data: unknown) => {
            upsertCalls.push({ table: "session_load", data });
            return { error: null };
          },
        };
      }

      if (table === "daily_load") {
        return {
          select: () => {
            const chain: Record<string, unknown> = {};
            chain.eq = () => chain;
            chain.gte = () => chain;
            chain.order = () => ({
              data: [{ date: activity.date ?? "2026-04-02", sport: activity.sport_type === "pool_swim" ? "swim" : activity.sport_type === "cycling" ? "bike" : activity.sport_type === "running" ? "run" : activity.sport_type === "yoga" ? "other" : activity.sport_type, tss: 50 }],
              error: null,
            });
            return chain;
          },
          upsert: (data: unknown) => {
            upsertCalls.push({ table: "daily_load", data });
            return { error: null };
          },
        };
      }

      if (table === "athlete_fitness") {
        return {
          select: () => {
            const chain: Record<string, unknown> = {};
            chain.eq = () => chain;
            chain.gte = () => chain;
            chain.lt = () => chain;
            chain.order = () => chain;
            chain.limit = () => ({ data: [], error: null });
            // For the gte path (daily loads fetch), return empty since daily_load handles it
            return chain;
          },
          upsert: (data: unknown) => {
            upsertCalls.push({ table: "athlete_fitness", data });
            return { error: null };
          },
        };
      }

      return {
        select: () => ({
          eq: function () { return this; },
        }),
        upsert: () => ({ error: null }),
      };
    },
  } as unknown as SupabaseClient;

  return { mock, upsertCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncSessionLoad", () => {
  it("returns early without error when activity is not found", async () => {
    const { mock, upsertCalls } = buildMockSupabase({ activity: null });
    // Should not throw
    await syncSessionLoad(mock, "user1", "act-missing");
    expect(upsertCalls).toHaveLength(0);
  });

  it("upserts session_load with normalized sport for a run activity", async () => {
    const activity = {
      id: "act-1",
      user_id: "user1",
      sport_type: "running",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 3600,
      avg_hr: 145,
      max_hr: 170,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-1");

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    const data = sessionLoadUpsert!.data as Record<string, unknown>;
    expect(data.sport).toBe("run");
    expect(data.date).toBe("2026-04-02");
  });

  it("upserts session_load with normalized sport for cycling", async () => {
    const activity = {
      id: "act-2",
      user_id: "user1",
      sport_type: "cycling",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 5400,
      avg_hr: 135,
      max_hr: 160,
      avg_power: 200,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-2");

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    expect((sessionLoadUpsert!.data as Record<string, unknown>).sport).toBe("bike");
  });

  it("upserts session_load with normalized sport for swimming", async () => {
    const activity = {
      id: "act-3",
      user_id: "user1",
      sport_type: "pool_swim",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 2700,
      avg_hr: 130,
      max_hr: 155,
      avg_power: null,
      avg_pace_per_100m_sec: 110,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-3");

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    expect((sessionLoadUpsert!.data as Record<string, unknown>).sport).toBe("swim");
  });

  it("calls rebuildDailyLoad and updateFitnessFromDate after session_load upsert", async () => {
    const activity = {
      id: "act-4",
      user_id: "user1",
      sport_type: "run",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 3000,
      avg_hr: 140,
      max_hr: 165,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-4");

    // Should have upserted: session_load, daily_load, athlete_fitness
    const tables = upsertCalls.map((c) => c.table);
    expect(tables).toContain("session_load");
    expect(tables).toContain("daily_load");
    expect(tables).toContain("athlete_fitness");
  });

  it("extracts avgRunPace from metrics_v2 when present", async () => {
    const activity = {
      id: "act-5",
      user_id: "user1",
      sport_type: "run",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 3600,
      avg_hr: 150,
      max_hr: 175,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: { pace: { avgPaceSecPerKm: 330 } },
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-5");

    // Should complete without error — the pace is passed to resolveTss internally
    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
  });

  it("handles unknown sport type by normalizing to 'other'", async () => {
    const activity = {
      id: "act-6",
      user_id: "user1",
      sport_type: "yoga",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 3600,
      avg_hr: 100,
      max_hr: 120,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-6");

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    expect((sessionLoadUpsert!.data as Record<string, unknown>).sport).toBe("other");
  });

  // -------------------------------------------------------------------------
  // Sport normalization: additional variants
  // -------------------------------------------------------------------------

  it.each([
    ["swim", "swim"],
    ["swimming", "swim"],
    ["open_water", "swim"],
    ["bike", "bike"],
    ["virtual_ride", "bike"],
    ["run", "run"],
    ["trail_running", "run"],
    ["treadmill", "run"],
    ["strength", "strength"],
    ["functional_fitness", "strength"],
    ["weight_training", "strength"],
  ])("normalizes sport_type '%s' to '%s'", async (inputSport, expectedSport) => {
    const activity = {
      id: `act-norm-${inputSport}`,
      user_id: "user1",
      sport_type: inputSport,
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 3600,
      avg_hr: 130,
      max_hr: 160,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", `act-norm-${inputSport}`);

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    expect((sessionLoadUpsert!.data as Record<string, unknown>).sport).toBe(expectedSport);
  });

  // -------------------------------------------------------------------------
  // Date fallback: uses start_time_utc when date field is absent
  // -------------------------------------------------------------------------
  it("falls back to start_time_utc slice when activity.date is undefined", async () => {
    const activity = {
      id: "act-7",
      user_id: "user1",
      sport_type: "run",
      // date is intentionally absent
      start_time_utc: "2026-03-28T06:30:00Z",
      duration_sec: 3000,
      avg_hr: 145,
      max_hr: 168,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-7");

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    // Should have sliced start_time_utc to YYYY-MM-DD
    expect((sessionLoadUpsert!.data as Record<string, unknown>).date).toBe("2026-03-28");
  });

  // -------------------------------------------------------------------------
  // sessionId is forwarded to the session_load upsert
  // -------------------------------------------------------------------------
  it("includes sessionId in session_load upsert when provided", async () => {
    const activity = {
      id: "act-8",
      user_id: "user1",
      sport_type: "bike",
      date: "2026-04-01",
      start_time_utc: "2026-04-01T09:00:00Z",
      duration_sec: 5400,
      avg_hr: 140,
      max_hr: 165,
      avg_power: 220,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-8", "session-xyz");

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    expect((sessionLoadUpsert!.data as Record<string, unknown>).session_id).toBe("session-xyz");
  });

  it("sets session_id to null in session_load upsert when sessionId is not provided", async () => {
    const activity = {
      id: "act-9",
      user_id: "user1",
      sport_type: "run",
      date: "2026-04-01",
      start_time_utc: "2026-04-01T07:00:00Z",
      duration_sec: 3600,
      avg_hr: 148,
      max_hr: 170,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-9");

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    expect((sessionLoadUpsert!.data as Record<string, unknown>).session_id).toBeNull();
  });

  // -------------------------------------------------------------------------
  // session_load upsert failure aborts downstream steps
  // -------------------------------------------------------------------------
  it("stops processing (no daily_load or athlete_fitness upsert) when session_load upsert fails", async () => {
    const activity = {
      id: "act-10",
      user_id: "user1",
      sport_type: "run",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T07:00:00Z",
      duration_sec: 3600,
      avg_hr: 145,
      max_hr: 168,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const upsertCalls: UpsertCall[] = [];

    // Build a mock where session_load upsert returns an error
    const errorMock = {
      from: (table: string) => {
        if (table === "completed_activities") {
          return {
            select: () => {
              const chain = {
                eq: () => chain,
                maybeSingle: () => ({ data: activity, error: null }),
              };
              return chain;
            },
          };
        }
        if (table === "athlete_ftp_history") {
          return {
            select: () => ({
              eq: () => {
                const chain = {
                  order: () => chain,
                  limit: () => ({
                    maybeSingle: () => ({ data: null, error: null }),
                  }),
                };
                return chain;
              },
            }),
          };
        }
        if (table === "session_load") {
          return {
            upsert: (data: unknown) => {
              upsertCalls.push({ table: "session_load", data });
              return { error: { message: "constraint violation" } };
            },
          };
        }
        // daily_load and athlete_fitness should NOT be called
        return {
          upsert: (data: unknown) => {
            upsertCalls.push({ table, data });
            return { error: null };
          },
          select: () => ({ eq: function() { return this; } }),
        };
      },
    } as unknown as SupabaseClient;

    await syncSessionLoad(errorMock, "user1", "act-10");

    // session_load upsert was attempted
    expect(upsertCalls.some((c) => c.table === "session_load")).toBe(true);
    // Neither daily_load nor athlete_fitness should have been upserted
    expect(upsertCalls.some((c) => c.table === "daily_load")).toBe(false);
    expect(upsertCalls.some((c) => c.table === "athlete_fitness")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // activity_id is forwarded to the session_load upsert
  // -------------------------------------------------------------------------
  it("includes activity_id in session_load upsert data", async () => {
    const activity = {
      id: "act-11",
      user_id: "user1",
      sport_type: "swim",
      date: "2026-04-01",
      start_time_utc: "2026-04-01T06:00:00Z",
      duration_sec: 2700,
      avg_hr: 135,
      max_hr: 155,
      avg_power: null,
      avg_pace_per_100m_sec: 105,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-11");

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    const data = sessionLoadUpsert!.data as Record<string, unknown>;
    expect(data.activity_id).toBe("act-11");
    expect(data.user_id).toBe("user1");
  });

  // -------------------------------------------------------------------------
  // TSS result fields are present in session_load upsert
  // -------------------------------------------------------------------------
  it("includes tss, tss_source, duration_sec, and intensity_factor in session_load upsert", async () => {
    const activity = {
      id: "act-12",
      user_id: "user1",
      sport_type: "run",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 3600,
      avg_hr: 152,
      max_hr: 178,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: null,
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await syncSessionLoad(mock, "user1", "act-12");

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
    const data = sessionLoadUpsert!.data as Record<string, unknown>;
    // tss must be a non-negative number
    expect(typeof data.tss).toBe("number");
    expect(data.tss as number).toBeGreaterThanOrEqual(0);
    // tss_source must be one of the defined sources
    expect(["device", "power", "hr", "pace", "duration_estimate"]).toContain(data.tss_source);
    // duration_sec must match input
    expect(data.duration_sec).toBe(3600);
    // intensity_factor is either null or a number
    expect(data.intensity_factor === null || typeof data.intensity_factor === "number").toBe(true);
  });

  // -------------------------------------------------------------------------
  // getAvgRunPace: extracts pace from metrics_v2 (indirectly)
  // -------------------------------------------------------------------------
  it("does not throw when metrics_v2 contains nested pace data", async () => {
    const activity = {
      id: "act-13",
      user_id: "user1",
      sport_type: "run",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 3600,
      avg_hr: null,
      max_hr: null,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      metrics_v2: { pace: { avgPaceSecPerKm: 310 } },
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await expect(syncSessionLoad(mock, "user1", "act-13")).resolves.toBeUndefined();

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
  });

  it("does not throw when metrics_v2 contains unexpected structure", async () => {
    const activity = {
      id: "act-14",
      user_id: "user1",
      sport_type: "bike",
      date: "2026-04-02",
      start_time_utc: "2026-04-02T08:00:00Z",
      duration_sec: 5400,
      avg_hr: null,
      max_hr: null,
      avg_power: 200,
      avg_pace_per_100m_sec: null,
      metrics_v2: { pace: "not-an-object" },
    };

    const { mock, upsertCalls } = buildFullMockSupabase(activity);
    await expect(syncSessionLoad(mock, "user1", "act-14")).resolves.toBeUndefined();

    const sessionLoadUpsert = upsertCalls.find((c) => c.table === "session_load");
    expect(sessionLoadUpsert).toBeDefined();
  });
});
