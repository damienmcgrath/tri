import { manualStitchRaceBundle } from "./manual-stitch";

function makeSupabase(opts: {
  activities: Array<Record<string, unknown>>;
  raceProfiles?: Array<Record<string, unknown>>;
  sameDaySessions?: Array<Record<string, unknown>>;
}) {
  const inserts: Array<{ table: string; rows: unknown }> = [];
  const updates: Array<{ table: string; patch: unknown }> = [];
  const bundleUpdates: Array<Record<string, unknown>> = [];

  const supabase: any = {
    from: (table: string) => {
      if (table === "completed_activities") {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: opts.activities, error: null })
            })
          }),
          update: (patch: Record<string, unknown>) => {
            updates.push({ table, patch });
            return {
              eq: () => ({
                eq: async () => ({ error: null })
              })
            };
          }
        };
      }
      if (table === "race_profiles") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: opts.raceProfiles ?? [], error: null })
            })
          })
        };
      }
      if (table === "race_bundles") {
        return {
          insert: (rows: unknown) => {
            inserts.push({ table, rows });
            return {
              select: () => ({
                single: async () => ({ data: { id: "bundle-1" }, error: null })
              })
            };
          },
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "bundle-1", pre_race_snapshot_status: "pending" },
                  error: null
                })
              })
            })
          }),
          update: (patch: Record<string, unknown>) => {
            bundleUpdates.push(patch);
            return {
              eq: () => ({
                eq: async () => ({ error: null })
              })
            };
          }
        };
      }
      if (table === "sessions") {
        const taperChain: any = {
          eq: () => taperChain,
          gte: () => taperChain,
          lt: () => taperChain,
          then: (resolve: any) => resolve({ data: opts.sameDaySessions ?? [], error: null })
        };
        return { select: () => taperChain };
      }
      if (table === "session_activity_links") {
        return {
          insert: (rows: unknown) => {
            inserts.push({ table, rows });
            return Promise.resolve({ error: null });
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
                      maybeSingle: async () => ({ data: null, error: null })
                    })
                  })
                })
              })
            })
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };
  return { supabase, inserts, updates, bundleUpdates };
}

describe("manualStitchRaceBundle", () => {
  it("rejects when fewer than three segments are provided", async () => {
    const { supabase } = makeSupabase({ activities: [] });
    const result = await manualStitchRaceBundle({
      supabase,
      userId: "user-1",
      segments: [
        { activityId: "a", role: "swim", index: 0 },
        { activityId: "b", role: "bike", index: 1 }
      ]
    });
    expect(result).toEqual({ status: "error", reason: "fewer_than_three_segments" });
  });

  it("rejects when any activity already belongs to a bundle", async () => {
    const { supabase } = makeSupabase({
      activities: [
        { id: "a", sport_type: "swim", start_time_utc: "2026-04-29T08:00:00Z", duration_sec: 1500, distance_m: 1500, race_bundle_id: "existing", user_id: "user-1" },
        { id: "b", sport_type: "bike", start_time_utc: "2026-04-29T08:30:00Z", duration_sec: 4500, distance_m: 40000, race_bundle_id: null, user_id: "user-1" },
        { id: "c", sport_type: "run", start_time_utc: "2026-04-29T09:50:00Z", duration_sec: 2400, distance_m: 10000, race_bundle_id: null, user_id: "user-1" }
      ]
    });
    const result = await manualStitchRaceBundle({
      supabase,
      userId: "user-1",
      segments: [
        { activityId: "a", role: "swim", index: 0 },
        { activityId: "b", role: "bike", index: 1 },
        { activityId: "c", role: "run", index: 2 }
      ]
    });
    expect(result).toEqual({ status: "error", reason: "activity_already_in_bundle" });
  });

  it("creates a manual race bundle and stamps inferred_transitions=true", async () => {
    const { supabase, inserts } = makeSupabase({
      activities: [
        { id: "a", sport_type: "swim", start_time_utc: "2026-04-29T08:00:00Z", duration_sec: 1500, distance_m: 1500, race_bundle_id: null, user_id: "user-1" },
        { id: "b", sport_type: "bike", start_time_utc: "2026-04-29T08:30:00Z", duration_sec: 4500, distance_m: 40000, race_bundle_id: null, user_id: "user-1" },
        { id: "c", sport_type: "run", start_time_utc: "2026-04-29T09:50:00Z", duration_sec: 2400, distance_m: 10000, race_bundle_id: null, user_id: "user-1" }
      ]
    });
    const result = await manualStitchRaceBundle({
      supabase,
      userId: "user-1",
      segments: [
        { activityId: "a", role: "swim", index: 0 },
        { activityId: "b", role: "bike", index: 1 },
        { activityId: "c", role: "run", index: 2 }
      ]
    });
    expect(result).toMatchObject({ status: "stitched", bundleId: "bundle-1" });

    const bundleInsert = inserts.find((i) => i.table === "race_bundles");
    expect(bundleInsert).toBeTruthy();
    expect(bundleInsert!.rows).toMatchObject({
      source: "manual",
      inferred_transitions: true,
      user_id: "user-1"
    });
  });
});
