import { executeCoachTool } from "@/lib/coach/tool-handlers";

function createQueryBuilder(terminal: Record<string, unknown>) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(terminal.maybeSingle ?? { data: null, error: null }),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(terminal.single ?? { data: null, error: null })
  };

  return builder;
}

describe("executeCoachTool hardening", () => {
  const ctx = {
    userId: "user-a",
    athleteId: "athlete-a",
    email: "a@example.com"
  };

  it("rejects ownership identifiers in tool args", async () => {
    const supabase = {
      from: jest.fn()
    } as unknown as { from: jest.Mock };

    await expect(executeCoachTool("get_recent_sessions", { daysBack: 7, athleteId: "athlete-b" }, { supabase: supabase as never, ctx })).rejects.toThrow();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("falls back to uploaded activities when legacy completed sessions are missing", async () => {
    const completedBuilder = createQueryBuilder({
      limit: {
        data: [],
        error: null
      }
    });
    completedBuilder.limit.mockResolvedValue({
      data: [],
      error: null
    });

    const uploadedBuilder = createQueryBuilder({
      limit: {
        data: [
          {
            id: "activity-1",
            sport_type: "swim",
            start_time_utc: "2026-03-10T07:10:00.000Z",
            duration_sec: 3600,
            distance_m: 2400,
            avg_hr: 141,
            avg_power: null,
            calories: 510,
            moving_duration_sec: 3500,
            elapsed_duration_sec: 3600,
            pool_length_m: 25,
            laps_count: 24,
            avg_pace_per_100m_sec: 150,
            metrics_v2: { schemaVersion: 1 }
          }
        ],
        error: null
      }
    });
    uploadedBuilder.limit.mockResolvedValue({
      data: [
        {
          id: "activity-1",
          sport_type: "swim",
          start_time_utc: "2026-03-10T07:10:00.000Z",
          duration_sec: 3600,
          distance_m: 2400,
          avg_hr: 141,
          avg_power: null,
          calories: 510,
          moving_duration_sec: 3500,
          elapsed_duration_sec: 3600,
          pool_length_m: 25,
          laps_count: 24,
          avg_pace_per_100m_sec: 150,
          metrics_v2: { schemaVersion: 1 }
        }
      ],
      error: null
    });

    const plannedBuilder = createQueryBuilder({
      limit: {
        data: [],
        error: null
      }
    });
    plannedBuilder.limit.mockResolvedValue({
      data: [],
      error: null
    });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "completed_sessions") return completedBuilder;
        if (table === "completed_activities") return uploadedBuilder;
        if (table === "sessions") return plannedBuilder;
        throw new Error(`Unexpected table: ${table}`);
      })
    } as unknown as { from: jest.Mock };

    const result = await executeCoachTool("get_recent_sessions", { daysBack: 7 }, { supabase: supabase as never, ctx });

    expect(uploadedBuilder.eq).toHaveBeenCalledWith("user_id", ctx.userId);
    expect(result).toMatchObject({
      completed: [
        {
          id: "activity:activity-1",
          date: "2026-03-10",
          sport: "swim",
          durationMinutes: 60,
          distanceMeters: 2400,
          avgHr: 141,
          avgPower: null,
          calories: 510,
          movingDurationMinutes: 58,
          elapsedDurationMinutes: 60,
          poolLengthMeters: 25,
          lapsCount: 24,
          avgPacePer100mSec: 150,
          metricsV2: { schemaVersion: 1 },
          avgPaceSecPerKm: null,
          avgPaceSecPer100m: 150,
          source: "uploaded_activity"
        }
      ]
    });
  });


  it("does not expose swim-only pace field for non-swim uploaded activities", async () => {
    const completedBuilder = createQueryBuilder({ limit: { data: [], error: null } });
    completedBuilder.limit.mockResolvedValue({ data: [], error: null });

    const uploadedBuilder = createQueryBuilder({
      limit: {
        data: [
          {
            id: "activity-bike-1",
            sport_type: "bike",
            start_time_utc: "2026-03-11T07:10:00.000Z",
            duration_sec: 3120,
            distance_m: 18740,
            avg_hr: 147,
            avg_power: 156,
            calories: 552,
            moving_duration_sec: 3060,
            elapsed_duration_sec: 3120,
            pool_length_m: null,
            laps_count: null,
            avg_pace_per_100m_sec: 17,
            metrics_v2: { schemaVersion: 1 }
          }
        ],
        error: null
      }
    });
    uploadedBuilder.limit.mockResolvedValue({
      data: [
        {
          id: "activity-bike-1",
          sport_type: "bike",
          start_time_utc: "2026-03-11T07:10:00.000Z",
          duration_sec: 3120,
          distance_m: 18740,
          avg_hr: 147,
          avg_power: 156,
          calories: 552,
          moving_duration_sec: 3060,
          elapsed_duration_sec: 3120,
          pool_length_m: null,
          laps_count: null,
          avg_pace_per_100m_sec: 17,
          metrics_v2: { schemaVersion: 1 }
        }
      ],
      error: null
    });

    const plannedBuilder = createQueryBuilder({ limit: { data: [], error: null } });
    plannedBuilder.limit.mockResolvedValue({ data: [], error: null });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "completed_sessions") return completedBuilder;
        if (table === "completed_activities") return uploadedBuilder;
        if (table === "sessions") return plannedBuilder;
        throw new Error(`Unexpected table: ${table}`);
      })
    } as unknown as { from: jest.Mock };

    const result = await executeCoachTool("get_recent_sessions", { daysBack: 7 }, { supabase: supabase as never, ctx });

    expect(result).toMatchObject({
      completed: [
        {
          id: "activity:activity-bike-1",
          sport: "bike",
          avgPacePer100mSec: null,
          avgPaceSecPer100m: null
        }
      ]
    });
  });

  it("returns explicit activity details payload", async () => {
    const activityBuilder = createQueryBuilder({
      maybeSingle: {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          sport_type: "run",
          start_time_utc: "2026-03-10T07:10:00.000Z",
          end_time_utc: "2026-03-10T08:00:00.000Z",
          duration_sec: 3000,
          distance_m: 10000,
          avg_hr: 152,
          avg_power: 250,
          calories: 700,
          moving_duration_sec: 2950,
          elapsed_duration_sec: 3000,
          pool_length_m: null,
          laps_count: null,
          avg_pace_per_100m_sec: 30,
          best_pace_per_100m_sec: null,
          avg_stroke_rate_spm: null,
          avg_swolf: null,
          avg_cadence: 86,
          max_hr: 170,
          max_power: 330,
          elevation_gain_m: 120,
          elevation_loss_m: 120,
          activity_vendor: "garmin",
          activity_type_raw: "running",
          activity_subtype_raw: null,
          metrics_v2: { schemaVersion: 1 }
        },
        error: null
      }
    });

    const linksBuilder = createQueryBuilder({
      maybeSingle: {
        data: {
          planned_session_id: "session-1",
          confirmation_status: "suggested",
          confidence: 0.88
        },
        error: null
      }
    });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "completed_activities") return activityBuilder;
        if (table === "session_activity_links") return linksBuilder;
        throw new Error(`Unexpected table: ${table}`);
      })
    } as unknown as { from: jest.Mock };

    const result = await executeCoachTool(
      "get_activity_details",
      { activityId: "11111111-1111-4111-8111-111111111111" },
      { supabase: supabase as never, ctx }
    );

    expect(result).toMatchObject({
      source: "uploaded_activity",
      linkedSession: {
        planned_session_id: "session-1"
      },
      activity: {
        id: "11111111-1111-4111-8111-111111111111",
        sport_type: "run"
      }
    });
  });

  it("rejects proposal creation for another athlete session", async () => {
    const sessionsBuilder = createQueryBuilder({ maybeSingle: { data: null, error: null } });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "sessions") return sessionsBuilder;
        throw new Error(`Unexpected table: ${table}`);
      })
    } as unknown as { from: jest.Mock };

    await expect(executeCoachTool(
      "create_plan_change_proposal",
      {
        title: "Reduce load",
        rationale: "Fatigue is elevated",
        changeSummary: "Swap hard run for easy run",
        targetSessionId: "11111111-1111-4111-8111-111111111111"
      },
      { supabase: supabase as never, ctx }
    )).rejects.toThrow("not owned by current athlete");

    expect(sessionsBuilder.eq).toHaveBeenCalledWith("athlete_id", ctx.athleteId);
  });

  it("returns upcoming sessions with correct shape", async () => {
    const sessionsBuilder = createQueryBuilder({});
    sessionsBuilder.limit.mockResolvedValue({
      data: [
        {
          id: "s1",
          date: "2026-04-04",
          sport: "run",
          type: "Easy run",
          duration_minutes: 45,
          status: "planned",
          notes: "Keep HR low"
        },
        {
          id: "s2",
          date: "2026-04-05",
          sport: "swim",
          type: "Aerobic swim",
          duration_minutes: 60,
          status: "planned",
          notes: null
        }
      ],
      error: null
    });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "sessions") return sessionsBuilder;
        throw new Error(`Unexpected table: ${table}`);
      })
    } as unknown as { from: jest.Mock };

    const result = await executeCoachTool("get_upcoming_sessions", { daysAhead: 7 }, { supabase: supabase as never, ctx });

    expect(result).toMatchObject({
      range: { from: expect.any(String), to: expect.any(String) },
      sessions: [
        { id: "s1", sport: "run", type: "Easy run", notes: "Keep HR low" },
        { id: "s2", sport: "swim", type: "Aerobic swim", notes: null }
      ]
    });
    expect(sessionsBuilder.eq).toHaveBeenCalledWith("athlete_id", ctx.athleteId);
  });

  it("throws on Supabase error in get_upcoming_sessions", async () => {
    const sessionsBuilder = createQueryBuilder({});
    sessionsBuilder.limit.mockResolvedValue({
      data: null,
      error: { message: "connection error" }
    });

    const supabase = {
      from: jest.fn(() => sessionsBuilder)
    } as unknown as { from: jest.Mock };

    await expect(
      executeCoachTool("get_upcoming_sessions", { daysAhead: 7 }, { supabase: supabase as never, ctx })
    ).rejects.toThrow("connection error");
  });

  it("returns week progress with correct structure", async () => {
    const plannedBuilder = createQueryBuilder({});
    plannedBuilder.lte = jest.fn().mockResolvedValue({
      data: [
        { id: "s1", status: "completed", duration_minutes: 60 },
        { id: "s2", status: "planned", duration_minutes: 45 },
        { id: "s3", status: "planned", duration_minutes: 30 }
      ],
      error: null
    });

    const completedBuilder = createQueryBuilder({});
    completedBuilder.lte = jest.fn().mockResolvedValue({
      data: [{ id: "c1" }],
      error: null
    });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "sessions") return plannedBuilder;
        if (table === "completed_sessions") return completedBuilder;
        throw new Error(`Unexpected table: ${table}`);
      })
    } as unknown as { from: jest.Mock };

    const result = await executeCoachTool("get_week_progress", {}, { supabase: supabase as never, ctx });

    expect(result).toMatchObject({
      weekStart: expect.any(String),
      weekEnd: expect.any(String),
      plannedSessionCount: 3,
      completedSessionCount: 1,
      plannedMinutes: 135,
      completionRatio: expect.any(Number)
    });
  });

  it("throws on unsupported tool name", async () => {
    const supabase = { from: jest.fn() } as unknown as { from: jest.Mock };

    await expect(
      executeCoachTool("nonexistent_tool" as never, {}, { supabase: supabase as never, ctx })
    ).rejects.toThrow("Unsupported tool");
  });

  it("returns activity details as not found when activity does not exist", async () => {
    const activityBuilder = createQueryBuilder({
      maybeSingle: { data: null, error: null }
    });

    const supabase = {
      from: jest.fn(() => activityBuilder)
    } as unknown as { from: jest.Mock };

    await expect(
      executeCoachTool("get_activity_details", { activityId: "11111111-1111-4111-8111-111111111111" }, { supabase: supabase as never, ctx })
    ).rejects.toThrow("not found");
  });

  it("returns activity details with error from Supabase", async () => {
    const activityBuilder = createQueryBuilder({
      maybeSingle: { data: null, error: { message: "db error" } }
    });

    const supabase = {
      from: jest.fn(() => activityBuilder)
    } as unknown as { from: jest.Mock };

    await expect(
      executeCoachTool("get_activity_details", { activityId: "22222222-2222-4222-8222-222222222222" }, { supabase: supabase as never, ctx })
    ).rejects.toThrow("db error");
  });

  it("successful proposal creation returns expected fields", async () => {
    const sessionsBuilder = createQueryBuilder({
      maybeSingle: { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null }
    });

    const proposalBuilder = createQueryBuilder({
      single: {
        data: {
          id: "proposal-1",
          title: "Reduce load",
          rationale: "Fatigue is elevated",
          status: "pending",
          proposed_date: null,
          proposed_duration_minutes: null
        },
        error: null
      }
    });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "sessions") return sessionsBuilder;
        if (table === "coach_plan_change_proposals") return proposalBuilder;
        throw new Error(`Unexpected table: ${table}`);
      })
    } as unknown as { from: jest.Mock };

    const result = await executeCoachTool(
      "create_plan_change_proposal",
      {
        title: "Reduce load",
        rationale: "Fatigue is elevated",
        changeSummary: "Swap hard run for easy run",
        targetSessionId: "11111111-1111-4111-8111-111111111111"
      },
      { supabase: supabase as never, ctx }
    );

    expect(result).toMatchObject({
      id: "proposal-1",
      title: "Reduce load",
      status: "pending"
    });
  });
});
