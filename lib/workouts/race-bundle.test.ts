import { attemptRaceBundle } from "./race-bundle";

type Row = Record<string, unknown>;

function makeBuilder(behaviors: { [key: string]: unknown }) {
  // Simple Supabase chain mock — every call records to behaviors.calls and
  // resolves with what the test sets up via behaviors.responses[key].
  const builder: any = {};
  builder.from = (table: string) => {
    behaviors.lastTable = table;
    return builder;
  };
  builder.select = () => builder;
  builder.insert = (rows: unknown) => {
    (behaviors.inserts as any[]).push({ table: behaviors.lastTable, rows });
    if (behaviors.lastTable === "race_bundles") {
      return {
        select: () => ({
          single: async () => ({ data: { id: "bundle-1" }, error: null })
        })
      };
    }
    return Promise.resolve({ error: null });
  };
  builder.update = (patch: Row) => {
    return {
      eq: (..._args: unknown[]) => ({
        eq: async (..._inner: unknown[]) => {
          (behaviors.updates as any[]).push({ table: behaviors.lastTable, patch });
          return { error: null };
        }
      })
    };
  };
  builder.delete = () => ({
    eq: () => ({ in: async () => ({ error: null }) })
  });
  builder.eq = () => builder;
  builder.in = () => builder;
  builder.gte = () => builder;
  builder.lte = () => builder;
  builder.order = () => Promise.resolve({ data: behaviors.activities, error: null });
  return builder;
}

describe("attemptRaceBundle", () => {
  function buildSupabase(opts: {
    sameDaySessions: Row[];
    activities: Row[];
    existingLinks?: Row[];
  }) {
    const behaviors: any = {
      inserts: [],
      updates: [],
      activities: opts.activities,
      lastTable: ""
    };

    // Custom from() that branches per table.
    const supabase: any = {};
    supabase.from = (table: string) => {
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: opts.sameDaySessions, error: null })
            })
          })
        };
      }
      if (table === "completed_activities") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: () => ({
                  order: () => Promise.resolve({ data: opts.activities, error: null })
                })
              })
            })
          }),
          update: (patch: Row) => ({
            eq: () => ({
              eq: async () => {
                behaviors.updates.push({ patch });
                return { error: null };
              }
            })
          })
        };
      }
      if (table === "session_activity_links") {
        const chainable: any = {};
        chainable.eq = () => chainable;
        chainable.in = () => Promise.resolve({ error: null });
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: opts.existingLinks ?? [], error: null })
            })
          }),
          insert: (rows: unknown) => {
            behaviors.inserts.push({ table, rows });
            return Promise.resolve({ error: null });
          },
          delete: () => chainable
        };
      }
      if (table === "race_bundles") {
        return {
          insert: (rows: unknown) => {
            behaviors.inserts.push({ table, rows });
            return {
              select: () => ({
                single: async () => ({ data: { id: "bundle-1" }, error: null })
              })
            };
          }
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    return { supabase, behaviors };
  }

  it("bundles 5 same-day activities into the planned race session", async () => {
    const baseStart = new Date("2026-04-26T08:03:08.000Z").getTime();
    const at = (offsetSec: number, sport: string, durationSec: number, distance: number, id: string) => ({
      id,
      sport_type: sport,
      start_time_utc: new Date(baseStart + offsetSec * 1000).toISOString(),
      duration_sec: durationSec,
      distance_m: distance
    });

    const { supabase, behaviors } = buildSupabase({
      sameDaySessions: [
        {
          id: "session-race",
          date: "2026-04-26",
          sport: "other",
          type: "Olympic (race)",
          session_name: "Joe Hannon Olympic",
          duration_minutes: 150
        }
      ],
      activities: [
        at(0, "swim", 1601, 600, "act-swim"),
        at(1605, "strength", 130, 213, "act-t1"),
        at(1740, "bike", 4619, 39966, "act-bike"),
        at(6361, "strength", 99, 160, "act-t2"),
        at(6462, "run", 2641, 9368, "act-run")
      ],
      existingLinks: []
    });

    const result = await attemptRaceBundle({
      supabase,
      userId: "user-1",
      date: "2026-04-26",
      source: "strava_reconstructed"
    });

    expect(result.status).toBe("bundled");
    if (result.status !== "bundled") return;
    expect(result.plannedSessionId).toBe("session-race");
    expect(result.segmentIds).toEqual(["act-swim", "act-t1", "act-bike", "act-t2", "act-run"]);

    const bundleInsert = behaviors.inserts.find((i: any) => i.table === "race_bundles");
    expect(bundleInsert).toBeTruthy();
    expect(bundleInsert.rows.source).toBe("strava_reconstructed");
    expect(bundleInsert.rows.user_id).toBe("user-1");

    const linkInsert = behaviors.inserts.find((i: any) => i.table === "session_activity_links");
    expect(linkInsert).toBeTruthy();
    expect((linkInsert.rows as Row[]).length).toBe(5);
    expect((linkInsert.rows as Row[])[0]).toMatchObject({
      planned_session_id: "session-race",
      completed_activity_id: "act-swim",
      confirmation_status: "confirmed",
      match_method: "race_bundle"
    });

    expect(behaviors.updates.length).toBe(5);
    const roles = behaviors.updates.map((u: any) => u.patch.race_segment_role);
    expect(roles).toEqual(["swim", "t1", "bike", "t2", "run"]);
  });

  it("skips when no race-flagged session exists that day", async () => {
    const { supabase } = buildSupabase({
      sameDaySessions: [
        { id: "s1", type: "Easy Run", session_name: "Easy Run", duration_minutes: 45 }
      ],
      activities: [{ id: "a1", sport_type: "swim", start_time_utc: "2026-04-26T08:00:00Z", duration_sec: 1500, distance_m: 600 }]
    });

    const result = await attemptRaceBundle({
      supabase,
      userId: "user-1",
      date: "2026-04-26",
      source: "strava_reconstructed"
    });

    expect(result).toEqual({ status: "skipped", reason: "no_race_session" });
  });

  it("self-heals when bundle + roles are present but links failed previously", async () => {
    const { supabase, behaviors } = buildSupabase({
      sameDaySessions: [
        { id: "session-race", type: "Race", session_name: "Race", duration_minutes: 150 }
      ],
      activities: [
        { id: "a1", sport_type: "swim", start_time_utc: "2026-04-26T08:00:00Z", duration_sec: 1500, race_bundle_id: "existing-bundle", race_segment_role: "swim", race_segment_index: 0 },
        { id: "a2", sport_type: "bike", start_time_utc: "2026-04-26T08:30:00Z", duration_sec: 4500, race_bundle_id: "existing-bundle", race_segment_role: "bike", race_segment_index: 1 },
        { id: "a3", sport_type: "run", start_time_utc: "2026-04-26T09:50:00Z", duration_sec: 2400, race_bundle_id: "existing-bundle", race_segment_role: "run", race_segment_index: 2 }
      ],
      existingLinks: []
    });

    const result = await attemptRaceBundle({
      supabase,
      userId: "user-1",
      date: "2026-04-26",
      source: "strava_reconstructed"
    });

    expect(result.status).toBe("bundled");
    if (result.status !== "bundled") return;
    expect(result.bundleId).toBe("existing-bundle");
    expect(result.plannedSessionId).toBe("session-race");
    expect(result.segmentIds).toEqual(["a1", "a2", "a3"]);

    const linkInsert = behaviors.inserts.find((i: any) => i.table === "session_activity_links");
    expect(linkInsert).toBeTruthy();
    expect((linkInsert.rows as Row[]).length).toBe(3);
    expect((linkInsert.rows as Row[])[0]).toMatchObject({
      match_method: "race_bundle",
      match_reason: expect.objectContaining({ recovered: true })
    });

    // Crucially the bundler did NOT insert another race_bundles row — it reused.
    const bundleInsert = behaviors.inserts.find((i: any) => i.table === "race_bundles");
    expect(bundleInsert).toBeUndefined();
  });

  it("bails on partial bundle state (some bundled, some not)", async () => {
    const { supabase } = buildSupabase({
      sameDaySessions: [
        { id: "s1", type: "Race", session_name: "Race", duration_minutes: 150 }
      ],
      activities: [
        { id: "a1", sport_type: "swim", start_time_utc: "2026-04-26T08:00:00Z", duration_sec: 1500, race_bundle_id: "existing-bundle" },
        { id: "a2", sport_type: "bike", start_time_utc: "2026-04-26T08:30:00Z", duration_sec: 4500 }, // not bundled
        { id: "a3", sport_type: "run", start_time_utc: "2026-04-26T09:50:00Z", duration_sec: 2400, race_bundle_id: "existing-bundle" }
      ]
    });

    const result = await attemptRaceBundle({
      supabase,
      userId: "user-1",
      date: "2026-04-26",
      source: "strava_reconstructed"
    });

    expect(result).toEqual({ status: "skipped", reason: "partial_bundle_state" });
  });
});
