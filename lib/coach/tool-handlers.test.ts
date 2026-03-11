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
