import { computeTaperCompliance } from "./taper-compliance";

function makeSupabase(rows: Array<{ execution_result?: unknown }>) {
  const chain: any = {
    eq: () => chain,
    gte: () => chain,
    lt: () => chain,
    then: (resolve: (value: { data: unknown; error: null }) => void) => {
      resolve({ data: rows, error: null });
    }
  };
  return {
    from: () => ({ select: () => chain })
  } as any;
}

describe("computeTaperCompliance", () => {
  it("returns null when no sessions have execution_result", async () => {
    const supabase = makeSupabase([
      { execution_result: null },
      { execution_result: null }
    ]);
    const result = await computeTaperCompliance(supabase, "user-1", "2026-04-29");
    expect(result).toEqual({ score: null, summary: null });
  });

  it("scores on_target=1, partial=0.5, missed=0", async () => {
    const supabase = makeSupabase([
      { execution_result: { intentMatch: "on_target" } },
      { execution_result: { intentMatch: "on_target" } },
      { execution_result: { intentMatch: "partial" } },
      { execution_result: { intentMatch: "missed" } }
    ]);
    const result = await computeTaperCompliance(supabase, "user-1", "2026-04-29");
    expect(result.score).toBeCloseTo((2 + 0.5) / 4);
    expect(result.summary).toBe("2 of 4 taper sessions on target");
  });

  it("excludes sessions without execution_result from numerator and denominator", async () => {
    const supabase = makeSupabase([
      { execution_result: { intentMatch: "on_target" } },
      { execution_result: null },
      { execution_result: { intentMatch: "missed" } }
    ]);
    const result = await computeTaperCompliance(supabase, "user-1", "2026-04-29");
    expect(result.score).toBeCloseTo(1 / 2);
    expect(result.summary).toBe("1 of 2 taper sessions on target");
  });
});
