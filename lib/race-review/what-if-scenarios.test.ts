import { runWhatIfScenario } from "@/lib/race-review/what-if-scenarios";

type Activity = {
  id: string;
  sport_type: "cycling" | "running" | "swim";
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec: number | null;
  metrics_v2: unknown;
};

type Bundle = {
  id: string;
  started_at: string;
  pre_race_ctl: number | null;
  pre_race_atl: number | null;
  pre_race_tsb: number | null;
  pre_race_tsb_state: "fresh" | "absorbing" | "fatigued" | "overreaching" | null;
  athlete_rating: number | null;
  race_profile_id: string | null;
};

function buildSupabase(tables: { activities?: Activity[]; bundles?: Bundle[] }) {
  const fromFn = jest.fn((table: string) => {
    const builder: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis()
    };

    const data =
      table === "completed_activities"
        ? tables.activities ?? []
        : table === "race_bundles"
          ? tables.bundles ?? []
          : [];

    (builder as unknown as PromiseLike<{ data: unknown; error: null }>).then = (resolve) =>
      Promise.resolve({ data, error: null }).then(resolve);
    return builder;
  });

  return { from: fromFn } as unknown as Parameters<typeof runWhatIfScenario>[0];
}

describe("runWhatIfScenario", () => {
  describe("pace_at_target", () => {
    it("returns a sketch citing comparable training when matches exist", async () => {
      const supabase = buildSupabase({
        activities: [
          {
            id: "act-1",
            sport_type: "cycling",
            start_time_utc: "2026-04-01T10:00:00.000Z",
            duration_sec: 3600,
            distance_m: 36000,
            avg_hr: null,
            avg_power: 200,
            avg_pace_per_100m_sec: null,
            metrics_v2: null
          },
          {
            id: "act-2",
            sport_type: "cycling",
            start_time_utc: "2026-04-08T10:00:00.000Z",
            duration_sec: 3600,
            distance_m: 36000,
            avg_hr: null,
            avg_power: 198,
            avg_pace_per_100m_sec: null,
            metrics_v2: null
          },
          {
            id: "act-far",
            sport_type: "cycling",
            start_time_utc: "2026-04-15T10:00:00.000Z",
            duration_sec: 3600,
            distance_m: 36000,
            avg_hr: null,
            avg_power: 250,
            avg_pace_per_100m_sec: null,
            metrics_v2: null
          }
        ]
      });

      const result = await runWhatIfScenario(supabase, "u1", {
        kind: "pace_at_target",
        role: "bike",
        target: { type: "power", value: 200 }
      });

      expect(result.kind).toBe("pace_at_target");
      expect(result.basedOn.length).toBeGreaterThan(0);
      // Citations must reference athlete's own training sessions, not generic norms.
      expect(result.basedOn.every((b) => b.type === "training_session")).toBe(true);
      expect(result.basedOn.every((b) => b.id !== "act-far")).toBe(true);
      expect(result.estimate?.unit).toBe("sec/km");
    });

    it("reports low confidence when no comparable history exists", async () => {
      const supabase = buildSupabase({
        activities: [
          {
            id: "act-1",
            sport_type: "cycling",
            start_time_utc: "2026-04-01T10:00:00.000Z",
            duration_sec: 3600,
            distance_m: 36000,
            avg_hr: null,
            avg_power: 100,
            avg_pace_per_100m_sec: null,
            metrics_v2: null
          }
        ]
      });

      const result = await runWhatIfScenario(supabase, "u1", {
        kind: "pace_at_target",
        role: "bike",
        target: { type: "power", value: 220 }
      });

      expect(result.basedOn).toHaveLength(0);
      expect(result.confidence).toBe("low");
      expect(result.caveat).toBeTruthy();
    });
  });

  describe("run_off_bike_at_if", () => {
    it("returns brick citations when bricks at the requested IF exist", async () => {
      const bikeStart = "2026-04-01T08:00:00.000Z";
      const runStart = "2026-04-01T09:10:00.000Z"; // 10 minutes after the 60-min bike ends
      const supabase = buildSupabase({
        activities: [
          {
            id: "bike-1",
            sport_type: "cycling",
            start_time_utc: bikeStart,
            duration_sec: 3600,
            distance_m: 36000,
            avg_hr: null,
            avg_power: 200,
            avg_pace_per_100m_sec: null,
            metrics_v2: { power: { intensityFactor: 0.78 } }
          },
          {
            id: "run-1",
            sport_type: "running",
            start_time_utc: runStart,
            duration_sec: 1800,
            distance_m: 5000,
            avg_hr: null,
            avg_power: null,
            avg_pace_per_100m_sec: null,
            metrics_v2: null
          }
        ]
      });

      const result = await runWhatIfScenario(supabase, "u1", { kind: "run_off_bike_at_if", bikeIF: 0.78 });
      expect(result.kind).toBe("run_off_bike_at_if");
      expect(result.basedOn.length).toBeGreaterThan(0);
      // Each brick contributes exactly 2 references (bike + run).
      expect(result.basedOn.find((b) => b.id === "bike-1")).toBeTruthy();
      expect(result.basedOn.find((b) => b.id === "run-1")).toBeTruthy();
    });

    it("rejects bike-then-run pairs separated by more than 30 minutes", async () => {
      const bikeStart = "2026-04-01T08:00:00.000Z";
      const runStart = "2026-04-01T10:00:00.000Z"; // 60 minutes after bike ends
      const supabase = buildSupabase({
        activities: [
          {
            id: "bike-1",
            sport_type: "cycling",
            start_time_utc: bikeStart,
            duration_sec: 3600,
            distance_m: 36000,
            avg_hr: null,
            avg_power: 200,
            avg_pace_per_100m_sec: null,
            metrics_v2: { power: { intensityFactor: 0.78 } }
          },
          {
            id: "run-1",
            sport_type: "running",
            start_time_utc: runStart,
            duration_sec: 1800,
            distance_m: 5000,
            avg_hr: null,
            avg_power: null,
            avg_pace_per_100m_sec: null,
            metrics_v2: null
          }
        ]
      });

      const result = await runWhatIfScenario(supabase, "u1", { kind: "run_off_bike_at_if", bikeIF: 0.78 });
      expect(result.basedOn).toHaveLength(0);
      expect(result.confidence).toBe("low");
    });
  });

  describe("sustainable_load", () => {
    it("cites prior fresh-and-rated-4+ races", async () => {
      const supabase = buildSupabase({
        bundles: [
          {
            id: "race-strong-1",
            started_at: "2025-09-15T08:00:00.000Z",
            pre_race_ctl: 78,
            pre_race_atl: 65,
            pre_race_tsb: 13,
            pre_race_tsb_state: "fresh",
            athlete_rating: 5,
            race_profile_id: null
          },
          {
            id: "race-strong-2",
            started_at: "2025-06-15T08:00:00.000Z",
            pre_race_ctl: 82,
            pre_race_atl: 70,
            pre_race_tsb: 12,
            pre_race_tsb_state: "fresh",
            athlete_rating: 4,
            race_profile_id: null
          }
        ]
      });

      const result = await runWhatIfScenario(supabase, "u1", { kind: "sustainable_load" });
      expect(result.kind).toBe("sustainable_load");
      expect(result.basedOn.length).toBe(2);
      expect(result.basedOn.every((b) => b.type === "prior_race")).toBe(true);
      expect(result.estimate?.unit).toBe("ctl");
    });

    it("returns no basedOn when no matching priors exist", async () => {
      const supabase = buildSupabase({ bundles: [] });
      const result = await runWhatIfScenario(supabase, "u1", { kind: "sustainable_load" });
      expect(result.basedOn).toHaveLength(0);
      expect(result.confidence).toBe("low");
    });
  });
});
