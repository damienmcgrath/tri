/**
 * @jest-environment node
 */

const mockGetConnectionByProviderAthleteId = jest.fn();
const mockRefreshIfExpired = jest.fn();
const mockSoftDisconnect = jest.fn();
jest.mock("../../../../../lib/integrations/token-service", () => ({
  getConnectionByProviderAthleteId: (...args: unknown[]) => mockGetConnectionByProviderAthleteId(...args),
  refreshIfExpired: (...args: unknown[]) => mockRefreshIfExpired(...args),
  softDisconnect: (...args: unknown[]) => mockSoftDisconnect(...args)
}));

const mockIngestStravaActivity = jest.fn();
jest.mock("../../../../../lib/integrations/ingestion-service", () => ({
  ingestStravaActivity: (...args: unknown[]) => mockIngestStravaActivity(...args)
}));

import { GET, POST } from "./route";

const VERIFY_TOKEN = "test-verify-token";

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
});

// ─── GET (subscription verification) ────────────────────────────────────────

describe("GET /api/integrations/strava/webhook", () => {
  function makeGetRequest(params: Record<string, string>): Request {
    const url = new URL("http://localhost:3000/api/integrations/strava/webhook");
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return new Request(url.toString());
  }

  it("returns hub.challenge on valid verification", async () => {
    const req = makeGetRequest({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "challenge-123"
    });
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ "hub.challenge": "challenge-123" });
  });

  it("returns 403 on wrong verify token", async () => {
    const req = makeGetRequest({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong-token",
      "hub.challenge": "challenge-123"
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 on wrong mode", async () => {
    const req = makeGetRequest({
      "hub.mode": "unsubscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "challenge-123"
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when challenge is missing", async () => {
    const req = makeGetRequest({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY_TOKEN
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 500 when verify token env var is not set", async () => {
    delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
    const req = makeGetRequest({
      "hub.mode": "subscribe",
      "hub.verify_token": "any",
      "hub.challenge": "challenge-123"
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

// ─── POST (event receiver) ───────────────────────────────────────────────────

describe("POST /api/integrations/strava/webhook", () => {
  function makePostRequest(body: Record<string, unknown>): Request {
    return new Request("http://localhost:3000/api/integrations/strava/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  const connection = {
    id: "conn-1",
    userId: "user-1",
    provider: "strava",
    providerAthleteId: "12345",
    accessToken: "token",
    refreshToken: "refresh",
    tokenExpiresAt: new Date(Date.now() + 3600000),
    scope: "activity:read_all",
    providerDisplayName: "Test",
    providerProfile: {},
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    syncWindowDays: 7
  };

  it("ingests activity on create event", async () => {
    mockGetConnectionByProviderAthleteId.mockResolvedValue(connection);
    mockRefreshIfExpired.mockResolvedValue(connection);
    mockIngestStravaActivity.mockResolvedValue({ status: "imported", activityId: "act-1", matched: false });

    const res = await POST(makePostRequest({
      object_type: "activity",
      object_id: 999,
      aspect_type: "create",
      owner_id: 12345,
      subscription_id: 1,
      event_time: Date.now() / 1000
    }));

    expect(res.status).toBe(200);
    expect(mockGetConnectionByProviderAthleteId).toHaveBeenCalledWith("strava", "12345");
    expect(mockRefreshIfExpired).toHaveBeenCalledWith(connection);
    expect(mockIngestStravaActivity).toHaveBeenCalledWith("user-1", 999, connection);
  });

  it("ingests activity on update event", async () => {
    mockGetConnectionByProviderAthleteId.mockResolvedValue(connection);
    mockRefreshIfExpired.mockResolvedValue(connection);
    mockIngestStravaActivity.mockResolvedValue({ status: "skipped" });

    const res = await POST(makePostRequest({
      object_type: "activity",
      object_id: 999,
      aspect_type: "update",
      owner_id: 12345,
      subscription_id: 1,
      event_time: Date.now() / 1000
    }));

    expect(res.status).toBe(200);
    expect(mockIngestStravaActivity).toHaveBeenCalled();
  });

  it("soft-disconnects on athlete deauthorization", async () => {
    mockSoftDisconnect.mockResolvedValue(undefined);

    const res = await POST(makePostRequest({
      object_type: "athlete",
      object_id: 12345,
      aspect_type: "update",
      owner_id: 12345,
      subscription_id: 1,
      event_time: Date.now() / 1000,
      updates: { authorized: "false" }
    }));

    expect(res.status).toBe(200);
    expect(mockSoftDisconnect).toHaveBeenCalledWith("strava", "12345");
    expect(mockIngestStravaActivity).not.toHaveBeenCalled();
  });

  it("returns 200 when no connection found for athlete", async () => {
    mockGetConnectionByProviderAthleteId.mockResolvedValue(null);

    const res = await POST(makePostRequest({
      object_type: "activity",
      object_id: 999,
      aspect_type: "create",
      owner_id: 99999,
      subscription_id: 1,
      event_time: Date.now() / 1000
    }));

    expect(res.status).toBe(200);
    expect(mockIngestStravaActivity).not.toHaveBeenCalled();
  });

  it("returns 200 even when ingest fails (does not propagate error)", async () => {
    mockGetConnectionByProviderAthleteId.mockResolvedValue(connection);
    mockRefreshIfExpired.mockResolvedValue(connection);
    mockIngestStravaActivity.mockRejectedValue(new Error("API error"));

    const res = await POST(makePostRequest({
      object_type: "activity",
      object_id: 999,
      aspect_type: "create",
      owner_id: 12345,
      subscription_id: 1,
      event_time: Date.now() / 1000
    }));

    expect(res.status).toBe(200);
  });

  it("ignores activity delete events", async () => {
    const res = await POST(makePostRequest({
      object_type: "activity",
      object_id: 999,
      aspect_type: "delete",
      owner_id: 12345,
      subscription_id: 1,
      event_time: Date.now() / 1000
    }));

    expect(res.status).toBe(200);
    expect(mockIngestStravaActivity).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new Request("http://localhost:3000/api/integrations/strava/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json"
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
