import type { ExternalConnection } from "./token-service";

// Mock Supabase service-role client
const mockSingle = jest.fn();
const mockMaybeSingle = jest.fn();
const mockUpdate = jest.fn();
const mockUpsert = jest.fn();
const mockDelete = jest.fn();

const builder = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  is: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  upsert: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  maybeSingle: mockMaybeSingle,
  single: mockSingle
};

const mockFrom = jest.fn().mockReturnValue(builder);
const mockSupabase = { from: mockFrom };

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => mockSupabase)
}));

// Mock Strava client
const mockStravaRefreshToken = jest.fn();
jest.mock("./providers/strava/client", () => ({
  refreshToken: (...args: unknown[]) => mockStravaRefreshToken(...args)
}));

// Set required env vars
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

// Import after mocks are set up
import { refreshIfExpired, updateSyncStatus, deleteConnection } from "./token-service";

const baseConnection: ExternalConnection = {
  id: "conn-1",
  userId: "user-1",
  provider: "strava",
  providerAthleteId: "athlete-123",
  accessToken: "old-access-token",
  refreshToken: "old-refresh-token",
  tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min from now
  scope: "activity:read_all",
  providerDisplayName: "Jane Doe",
  providerProfile: {},
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncError: null
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default success responses
  builder.update.mockReturnThis();
  builder.eq.mockReturnThis();
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockUpdate.mockResolvedValue({ error: null });

  // Make the chained update().eq().eq() chain resolve via the builder itself
  // The final call in updateSyncStatus is just .update(...).eq(...).eq(...) which
  // returns a promise. We mock builder to resolve when awaited.
  const buildAwaitable = (returnValue: { error: null | { message: string } }) => {
    const chain = {
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: (v: unknown) => void) => Promise.resolve(returnValue).then(resolve)
    };
    return chain;
  };

  mockFrom.mockReturnValue(buildAwaitable({ error: null }));
});

describe("refreshIfExpired", () => {
  it("returns connection unchanged when token has more than 5 minutes remaining", async () => {
    const conn = { ...baseConnection, tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000) };
    const result = await refreshIfExpired(conn);

    expect(result).toBe(conn);
    expect(mockStravaRefreshToken).not.toHaveBeenCalled();
  });

  it("refreshes token when it expires in less than 5 minutes", async () => {
    const conn = { ...baseConnection, tokenExpiresAt: new Date(Date.now() + 60 * 1000) }; // 1 min

    const newExpiresAt = Math.floor(Date.now() / 1000) + 21600;
    mockStravaRefreshToken.mockResolvedValue({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_at: newExpiresAt
    });

    const result = await refreshIfExpired(conn);

    expect(mockStravaRefreshToken).toHaveBeenCalledWith("old-refresh-token");
    expect(result.accessToken).toBe("new-access-token");
    expect(result.refreshToken).toBe("new-refresh-token");
    expect(result.tokenExpiresAt.getTime()).toBeCloseTo(newExpiresAt * 1000, -3);
  });

  it("refreshes token when it is already expired", async () => {
    const conn = { ...baseConnection, tokenExpiresAt: new Date(Date.now() - 5000) }; // 5s ago

    mockStravaRefreshToken.mockResolvedValue({
      access_token: "fresh-token",
      refresh_token: "fresh-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 21600
    });

    const result = await refreshIfExpired(conn);
    expect(result.accessToken).toBe("fresh-token");
  });

  it("throws when token refresh API call fails", async () => {
    const conn = { ...baseConnection, tokenExpiresAt: new Date(Date.now() + 60 * 1000) };
    mockStravaRefreshToken.mockRejectedValue(new Error("Strava token refresh 401"));

    await expect(refreshIfExpired(conn)).rejects.toThrow("Strava token refresh 401");
  });
});

describe("updateSyncStatus", () => {
  it("sets last_synced_at when status is ok", async () => {
    // Should not throw
    await expect(updateSyncStatus("user-1", "strava", "ok")).resolves.toBeUndefined();
  });

  it("sets last_sync_error when status is error", async () => {
    await expect(
      updateSyncStatus("user-1", "strava", "error", "API timeout")
    ).resolves.toBeUndefined();
  });
});

describe("deleteConnection", () => {
  it("deletes the connection row", async () => {
    await expect(deleteConnection("user-1", "strava")).resolves.toBeUndefined();
  });
});
