import { snapshotPreRaceState } from "./snapshot-pre-race-state";

type FitnessRow = { date: string; ctl: number; atl: number; tsb: number; ramp_rate: number | null };

function makeSupabase(opts: {
  bundle: { pre_race_snapshot_status: string } | null;
  fitness: FitnessRow | null;
  taperRows?: Array<{ execution_result?: unknown }>;
}) {
  const updates: Record<string, unknown>[] = [];

  const supabase: any = {
    from: (table: string) => {
      if (table === "race_bundles") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.bundle, error: null })
              })
            })
          }),
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            return {
              eq: () => ({
                eq: async () => ({ error: null })
              })
            };
          }
        };
      }
      if (table === "athlete_fitness") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                lte: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: opts.fitness ?? null, error: null })
                    })
                  })
                })
              })
            })
          })
        };
      }
      if (table === "sessions") {
        const chain: any = {
          eq: () => chain,
          gte: () => chain,
          lt: () => chain,
          then: (resolve: any) => resolve({ data: opts.taperRows ?? [], error: null })
        };
        return { select: () => chain };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };
  return { supabase, updates };
}

describe("snapshotPreRaceState", () => {
  it("is a no-op when status is already captured", async () => {
    const { supabase, updates } = makeSupabase({
      bundle: { pre_race_snapshot_status: "captured" },
      fitness: null
    });
    const result = await snapshotPreRaceState({
      supabase,
      userId: "user-1",
      bundleId: "b1",
      raceDate: "2026-04-29"
    });
    expect(result).toEqual({ status: "noop", reason: "already_captured" });
    expect(updates).toHaveLength(0);
  });

  it("marks unavailable when there is no fitness row on or before the race date", async () => {
    const { supabase, updates } = makeSupabase({
      bundle: { pre_race_snapshot_status: "pending" },
      fitness: null
    });
    const result = await snapshotPreRaceState({
      supabase,
      userId: "user-1",
      bundleId: "b1",
      raceDate: "2026-04-29"
    });
    expect(result).toEqual({ status: "unavailable", bundleId: "b1" });
    expect(updates[0]).toMatchObject({ pre_race_snapshot_status: "unavailable" });
  });

  it("captures fitness + taper compliance when both available", async () => {
    const { supabase, updates } = makeSupabase({
      bundle: { pre_race_snapshot_status: "pending" },
      fitness: { date: "2026-04-28", ctl: 78.4, atl: 62.1, tsb: 16.3, ramp_rate: 1.4 },
      taperRows: [
        { execution_result: { intentMatch: "on_target" } },
        { execution_result: { intentMatch: "on_target" } },
        { execution_result: { intentMatch: "partial" } }
      ]
    });
    const result = await snapshotPreRaceState({
      supabase,
      userId: "user-1",
      bundleId: "b1",
      raceDate: "2026-04-29"
    });
    expect(result).toEqual({ status: "captured", bundleId: "b1" });
    expect(updates[0]).toMatchObject({
      pre_race_ctl: 78.4,
      pre_race_atl: 62.1,
      pre_race_tsb: 16.3,
      pre_race_tsb_state: "fresh",
      pre_race_ramp_rate: 1.4,
      pre_race_snapshot_status: "captured"
    });
    expect(typeof updates[0].taper_compliance_score).toBe("number");
  });

  it("transitions to partial when fitness exists but taper has no scoreable sessions", async () => {
    const { supabase, updates } = makeSupabase({
      bundle: { pre_race_snapshot_status: "pending" },
      fitness: { date: "2026-04-28", ctl: 50, atl: 50, tsb: 0, ramp_rate: null },
      taperRows: []
    });
    const result = await snapshotPreRaceState({
      supabase,
      userId: "user-1",
      bundleId: "b1",
      raceDate: "2026-04-29"
    });
    expect(result).toEqual({ status: "partial", bundleId: "b1" });
    expect(updates[0]).toMatchObject({ pre_race_snapshot_status: "partial" });
    expect(updates[0].taper_compliance_score).toBeNull();
  });
});
