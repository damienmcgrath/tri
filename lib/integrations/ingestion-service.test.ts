import type { ExternalConnection } from "./token-service";
import type { StravaActivitySummary } from "./providers/strava/normalizer";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockFetchActivity = jest.fn();
const mockFetchRecentActivitiesWithRateLimit = jest.fn();
jest.mock("./providers/strava/client", () => ({
  fetchActivity: (...args: unknown[]) => mockFetchActivity(...args),
  fetchRecentActivitiesWithRateLimit: (...args: unknown[]) => mockFetchRecentActivitiesWithRateLimit(...args)
}));

jest.mock("./providers/strava/rate-limiter", () => ({
  shouldThrottle: () => false
}));

const mockRefreshIfExpired = jest.fn();
const mockUpdateSyncStatus = jest.fn();
jest.mock("./token-service", () => ({
  refreshIfExpired: (...args: unknown[]) => mockRefreshIfExpired(...args),
  updateSyncStatus: (...args: unknown[]) => mockUpdateSyncStatus(...args)
}));

// Build a reusable Supabase query chain mock
function makeChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "gte", "lte", "insert", "upsert", "update", "delete", "is"];
  methods.forEach((m) => { chain[m] = jest.fn().mockReturnValue(chain); });
  (chain as { then: (resolve: (v: unknown) => void) => Promise<unknown> }).then = (resolve) =>
    Promise.resolve(resolvedValue).then(resolve);
  (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = jest.fn().mockResolvedValue(resolvedValue);
  (chain as { single: () => Promise<unknown> }).single = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

const mockFrom = jest.fn();
const mockCreateClient = jest.fn(() => ({ from: mockFrom }));
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockCreateClient()
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

import { ingestStravaActivity, backfillRecentActivities } from "./ingestion-service";

const connection: ExternalConnection = {
  id: "conn-1",
  userId: "user-1",
  provider: "strava",
  providerAthleteId: "athlete-123",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
  scope: "activity:read_all",
  providerDisplayName: "Test User",
  providerProfile: {},
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  syncWindowDays: 7
};

const rawActivity: StravaActivitySummary = {
  id: 999,
  name: "Test Run",
  sport_type: "Run",
  start_date: "2026-03-15T08:00:00Z",
  elapsed_time: 3600,
  moving_time: 3500,
  distance: 10000,
  average_heartrate: 150,
  max_heartrate: 175
};

const createdActivity = {
  id: "activity-uuid-1",
  start_time_utc: "2026-03-15T08:00:00Z",
  sport_type: "run",
  duration_sec: 3600,
  distance_m: "10000"
};

beforeEach(() => {
  jest.resetAllMocks();
  mockCreateClient.mockReturnValue({ from: mockFrom });
  mockUpdateSyncStatus.mockResolvedValue(undefined);
  mockRefreshIfExpired.mockImplementation((c) => Promise.resolve(c));
});

describe("ingestStravaActivity", () => {
  it("returns skipped when activity already imported", async () => {
    // First from() call (dedup check) returns existing row
    mockFrom.mockReturnValueOnce(makeChain({ data: { id: "existing-id" }, error: null }));

    // Second from() (sync log insert)
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await ingestStravaActivity("user-1", "999", connection);

    expect(result.status).toBe("skipped");
    expect(mockFetchActivity).not.toHaveBeenCalled();
  });

  it("imports a new activity and runs matching", async () => {
    mockFetchActivity.mockResolvedValue(rawActivity);

    const calls: unknown[] = [];
    mockFrom.mockImplementation((table: string) => {
      calls.push(table);
      const chain = makeChain({ data: null, error: null });

      if (table === "completed_activities") {
        // First call: dedup → no existing
        // Second call: insert → return created activity
        if (calls.filter(c => c === "completed_activities").length === 1) {
          (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        } else {
          (chain as { single: () => Promise<unknown> }).single = jest.fn().mockResolvedValue({ data: createdActivity, error: null });
        }
      } else if (table === "sessions") {
        // No matching sessions
        (chain as { then: (resolve: (v: unknown) => void) => Promise<unknown> }).then = (resolve) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
      }
      return chain;
    });

    const result = await ingestStravaActivity("user-1", "999", connection);

    expect(mockFetchActivity).toHaveBeenCalledWith("access-token", "999");
    expect(result.status).toBe("imported");
    if (result.status === "imported") {
      expect(result.matched).toBe(false);
    }
  });

  it("skips non-triathlon activity (golf)", async () => {
    const golfActivity = { ...rawActivity, sport_type: "Golf", name: "Morning Golf" };
    mockFetchActivity.mockResolvedValue(golfActivity);

    const calls: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      calls.push(table);
      const chain = makeChain({ data: null, error: null });
      if (table === "completed_activities") {
        // Dedup check: not found
        (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    const result = await ingestStravaActivity("user-1", "999", connection);

    expect(result.status).toBe("skipped");
    // Should log the filter event
    expect(calls).toContain("external_sync_log");
    // Should NOT attempt to insert into completed_activities (only dedup check + sync log)
    const completedActivityCalls = calls.filter(c => c === "completed_activities");
    expect(completedActivityCalls.length).toBe(1); // only the dedup check
  });

  it("imports strength activities (not filtered)", async () => {
    const strengthActivity = { ...rawActivity, sport_type: "WeightTraining", name: "Gym Session" };
    mockFetchActivity.mockResolvedValue(strengthActivity);

    const calls: unknown[] = [];
    mockFrom.mockImplementation((table: string) => {
      calls.push(table);
      const chain = makeChain({ data: null, error: null });

      if (table === "completed_activities") {
        if (calls.filter(c => c === "completed_activities").length === 1) {
          (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        } else {
          (chain as { single: () => Promise<unknown> }).single = jest.fn().mockResolvedValue({
            data: { ...createdActivity, sport_type: "strength" },
            error: null
          });
        }
      } else if (table === "sessions") {
        (chain as { then: (resolve: (v: unknown) => void) => Promise<unknown> }).then = (resolve) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
      }
      return chain;
    });

    const result = await ingestStravaActivity("user-1", "999", connection);

    expect(result.status).toBe("imported");
  });

  it("returns skipped on uniqueness constraint violation (23505)", async () => {
    mockFetchActivity.mockResolvedValue(rawActivity);

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      const chain = makeChain({ data: null, error: null });

      if (table === "completed_activities" && callCount === 1) {
        // Dedup check: not found
        (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      } else if (table === "completed_activities" && callCount >= 2) {
        // Insert: conflict
        (chain as { single: () => Promise<unknown> }).single = jest.fn().mockResolvedValue({
          data: null,
          error: { code: "23505", message: "duplicate key" }
        });
      }
      return chain;
    });

    const result = await ingestStravaActivity("user-1", "999", connection);
    expect(result.status).toBe("skipped");
  });
});

describe("backfillRecentActivities", () => {
  it("returns empty result when no activities returned", async () => {
    mockFetchRecentActivitiesWithRateLimit.mockResolvedValue({ data: [], rateLimit: null });
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await backfillRecentActivities("user-1", connection);

    expect(result).toEqual({ imported: 0, skipped: 0, matched: 0 });
    expect(mockRefreshIfExpired).toHaveBeenCalledWith(connection);
  });

  it("skips activities that already exist", async () => {
    mockFetchRecentActivitiesWithRateLimit
      .mockResolvedValueOnce({ data: [rawActivity], rateLimit: null })
      .mockResolvedValueOnce({ data: [], rateLimit: null });

    mockFrom.mockImplementation((table: string) => {
      const chain = makeChain({ data: null, error: null });
      if (table === "completed_activities") {
        // Dedup check: already exists
        (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = jest.fn().mockResolvedValue({ data: { id: "existing" }, error: null });
      }
      return chain;
    });

    const result = await backfillRecentActivities("user-1", connection);

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
  });

  it("skips non-triathlon activities during backfill", async () => {
    const golfActivity = { ...rawActivity, id: 1000, sport_type: "Golf", name: "Golf Round" };
    const runActivity = { ...rawActivity, id: 1001, sport_type: "Run", name: "Easy Run" };

    mockFetchRecentActivitiesWithRateLimit
      .mockResolvedValueOnce({ data: [golfActivity, runActivity], rateLimit: null })
      .mockResolvedValueOnce({ data: [], rateLimit: null });

    const calls: unknown[] = [];
    mockFrom.mockImplementation((table: string) => {
      calls.push(table);
      const chain = makeChain({ data: null, error: null });

      if (table === "completed_activities") {
        // Dedup check: not found
        (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        // Insert: return created activity
        (chain as { single: () => Promise<unknown> }).single = jest.fn().mockResolvedValue({
          data: { ...createdActivity, id: "activity-uuid-run" },
          error: null
        });
      } else if (table === "sessions") {
        (chain as { then: (resolve: (v: unknown) => void) => Promise<unknown> }).then = (resolve) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
      }
      return chain;
    });

    const result = await backfillRecentActivities("user-1", connection);

    expect(result.imported).toBe(1); // only the run
    expect(result.skipped).toBe(1); // the golf activity
  });

  it("paginates until empty page is returned", async () => {
    // Page 1: full page, page 2: empty
    mockFetchRecentActivitiesWithRateLimit
      .mockResolvedValueOnce({ data: Array(50).fill(rawActivity).map((a, i) => ({ ...a, id: i + 1 })), rateLimit: null })
      .mockResolvedValueOnce({ data: [], rateLimit: null });

    // All activities already imported (dedup)
    mockFrom.mockImplementation(() => {
      const chain = makeChain({ data: { id: "existing" }, error: null });
      (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = jest.fn().mockResolvedValue({ data: { id: "existing" }, error: null });
      return chain;
    });

    const result = await backfillRecentActivities("user-1", connection);

    expect(mockFetchRecentActivitiesWithRateLimit).toHaveBeenCalledTimes(2);
    expect(result.skipped).toBe(50);
  });
});
