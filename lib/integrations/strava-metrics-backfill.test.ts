process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

import { backfillStravaMetrics, type BackfillResult } from "./strava-metrics-backfill";
import type { ExternalConnection } from "./token-service";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSelect = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockOrder = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "completed_activities") {
        return {
          select: (...args: unknown[]) => {
            mockSelect(...args);
            const selectStr = typeof args[0] === "string" ? args[0] : "";

            // Return chainable query builder
            const chain = {
              eq: (...eqArgs: unknown[]) => {
                mockEq(...eqArgs);
                return chain;
              },
              order: (...orderArgs: unknown[]) => {
                mockOrder(...orderArgs);
                // First call: list of activities; second call: metrics check
                return chain;
              },
              then: undefined as unknown
            };

            // Make it thenable so await works
            if (selectStr.includes("metrics_v2")) {
              // metrics check query
              Object.defineProperty(chain, "then", {
                value: (resolve: (v: unknown) => void) =>
                  resolve({ data: mockMetricsRows, error: null }),
                configurable: true
              });
            } else {
              // activity list query
              Object.defineProperty(chain, "then", {
                value: (resolve: (v: unknown) => void) =>
                  resolve({ data: mockActivityRows, error: null }),
                configurable: true
              });
            }
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            mockUpdate(payload);
            const updateChain = {
              eq: (...eqArgs: unknown[]) => {
                mockEq(...eqArgs);
                return updateChain;
              },
              then: undefined as unknown
            };
            Object.defineProperty(updateChain, "then", {
              value: (resolve: (v: unknown) => void) =>
                resolve({ error: null }),
              configurable: true
            });
            return updateChain;
          }
        };
      }
      return { select: jest.fn(), update: jest.fn() };
    }
  })
}));

jest.mock("./providers/strava/client", () => ({
  fetchActivity: jest.fn().mockResolvedValue({
    id: 100,
    name: "Morning Run",
    sport_type: "Run",
    start_date: "2026-03-15T07:00:00Z",
    elapsed_time: 3600,
    moving_time: 3500,
    distance: 10000,
    total_elevation_gain: 50,
    average_heartrate: 145,
    max_heartrate: 172,
    average_watts: 250,
    max_watts: 400,
    weighted_average_watts: 265,
    average_cadence: 88,
    calories: 520,
    average_temp: 18,
    suffer_score: 75,
    laps: [
      { lap_index: 0, elapsed_time: 1800, moving_time: 1750, distance: 5000, average_heartrate: 140, max_heartrate: 160, average_watts: 245, average_cadence: 86 },
      { lap_index: 1, elapsed_time: 1800, moving_time: 1750, distance: 5000, average_heartrate: 150, max_heartrate: 172, average_watts: 255, average_cadence: 90 }
    ],
    splits_metric: [
      { split: 1, distance: 1000, elapsed_time: 360, moving_time: 350, average_heartrate: 138, average_speed: 2.86 },
      { split: 2, distance: 1000, elapsed_time: 355, moving_time: 350, average_heartrate: 142, average_speed: 2.86 },
      { split: 3, distance: 1000, elapsed_time: 358, moving_time: 350, average_heartrate: 146, average_speed: 2.86 },
      { split: 4, distance: 1000, elapsed_time: 360, moving_time: 350, average_heartrate: 148, average_speed: 2.86 },
      { split: 5, distance: 1000, elapsed_time: 362, moving_time: 350, average_heartrate: 150, average_speed: 2.86 }
    ]
  })
}));

jest.mock("./token-service", () => ({
  refreshIfExpired: jest.fn().mockImplementation((conn: ExternalConnection) =>
    Promise.resolve(conn)
  )
}));

// ─── Test data ───────────────────────────────────────────────────────────────

let mockActivityRows: Record<string, unknown>[] = [];
let mockMetricsRows: Record<string, unknown>[] = [];

const baseConnection: ExternalConnection = {
  id: "conn-1",
  userId: "user-1",
  provider: "strava",
  providerAthleteId: "12345",
  accessToken: "tok_test",
  refreshToken: "ref_test",
  tokenExpiresAt: new Date(Date.now() + 3600000),
  scope: "activity:read_all",
  providerDisplayName: "Test Athlete",
  providerProfile: {},
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  syncWindowDays: 7
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockActivityRows = [];
  mockMetricsRows = [];
});

describe("backfillStravaMetrics", () => {
  it("returns zero counts when no Strava activities exist", async () => {
    mockActivityRows = [];
    mockMetricsRows = [];

    const result = await backfillStravaMetrics("user-1", baseConnection);

    expect(result.updated).toBe(0);
    expect(result.total).toBe(0);
    expect(result.rateLimited).toBe(false);
  });

  it("skips activities that already have metrics_v2", async () => {
    mockActivityRows = [
      { id: "act-1", external_activity_id: "100", sport_type: "run", start_time_utc: "2026-03-15T07:00:00Z", duration_sec: 3600, distance_m: 10000 }
    ];
    mockMetricsRows = [
      { id: "act-1", metrics_v2: { schemaVersion: 1, sourceFormat: "strava" } }
    ];

    const result = await backfillStravaMetrics("user-1", baseConnection);

    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.total).toBe(1);
  });

  it("fetches and updates activities missing metrics_v2", async () => {
    mockActivityRows = [
      { id: "act-1", external_activity_id: "100", sport_type: "run", start_time_utc: "2026-03-15T07:00:00Z", duration_sec: 3600, distance_m: 10000 }
    ];
    mockMetricsRows = [
      { id: "act-1", metrics_v2: null }
    ];

    const result = await backfillStravaMetrics("user-1", baseConnection);

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);

    // Verify the update was called with metrics_v2
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload.metrics_v2).toBeDefined();
    expect(updatePayload.metrics_v2.schemaVersion).toBe(1);
    expect(updatePayload.metrics_v2.sourceFormat).toBe("strava");
    expect(updatePayload.metrics_v2.power.normalizedPower).toBe(265);
    expect(updatePayload.metrics_v2.laps).toHaveLength(2);
    expect(updatePayload.end_time_utc).toBeDefined();
    expect(updatePayload.avg_pace_per_100m_sec).toBeDefined();
  });

  it("reports progress via callback", async () => {
    mockActivityRows = [
      { id: "act-1", external_activity_id: "100", sport_type: "run", start_time_utc: "2026-03-15T07:00:00Z", duration_sec: 3600, distance_m: 10000 }
    ];
    mockMetricsRows = [
      { id: "act-1", metrics_v2: null }
    ];

    const progressUpdates: unknown[] = [];
    await backfillStravaMetrics("user-1", baseConnection, (p) => progressUpdates.push(p));

    expect(progressUpdates).toHaveLength(1);
    expect(progressUpdates[0]).toMatchObject({ current: 1, total: 1, updated: 1, failed: 0 });
  });

  it("skips activities without external_activity_id", async () => {
    mockActivityRows = [
      { id: "act-1", external_activity_id: null, sport_type: "run", start_time_utc: "2026-03-15T07:00:00Z", duration_sec: 3600, distance_m: 10000 }
    ];
    mockMetricsRows = [
      { id: "act-1", metrics_v2: null }
    ];

    const result = await backfillStravaMetrics("user-1", baseConnection);

    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1); // alreadyBackfilled(0) + 1 for missing externalId
  });
});
