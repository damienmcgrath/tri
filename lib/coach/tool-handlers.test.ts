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
            parse_summary: { lapCount: 24 }
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
          parse_summary: { lapCount: 24 }
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
          parseSummary: { lapCount: 24 },
          source: "upload"
        }
      ]
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
});
