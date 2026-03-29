/**
 * @jest-environment node
 */
// Mock all external dependencies before imports
const mockExchangeCodeForTokens = jest.fn();
jest.mock("../../../../../lib/integrations/providers/strava/client", () => ({
  exchangeCodeForTokens: (...args: unknown[]) => mockExchangeCodeForTokens(...args)
}));

const mockUpsertConnection = jest.fn();
const mockGetConnection = jest.fn();
jest.mock("../../../../../lib/integrations/token-service", () => ({
  upsertConnection: (...args: unknown[]) => mockUpsertConnection(...args),
  getConnection: (...args: unknown[]) => mockGetConnection(...args)
}));

const mockBackfillRecentActivities = jest.fn();
jest.mock("../../../../../lib/integrations/ingestion-service", () => ({
  backfillRecentActivities: (...args: unknown[]) => mockBackfillRecentActivities(...args)
}));

const mockGetUser = jest.fn();
jest.mock("../../../../../lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser }
  }))
}));

import { GET } from "./route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeState(userId: string, nonce: string): string {
  return Buffer.from(JSON.stringify({ userId, nonce })).toString("base64url");
}

function makeRequest(
  params: { code?: string; state?: string; error?: string },
  nonce?: string
): Request {
  const url = new URL("http://localhost:3000/api/integrations/strava/callback");
  if (params.code) url.searchParams.set("code", params.code);
  if (params.state) url.searchParams.set("state", params.state);
  if (params.error) url.searchParams.set("error", params.error);

  const cookie = nonce ? `strava_oauth_nonce=${nonce}` : "";
  return new Request(url.toString(), {
    headers: {
      host: "localhost:3000",
      ...(cookie ? { cookie } : {})
    }
  });
}

const validAthleteProfile = { id: 123, firstname: "Jane", lastname: "Doe", profile: "" };
const validTokens = {
  access_token: "acc",
  refresh_token: "ref",
  expires_at: Math.floor(Date.now() / 1000) + 21600,
  scope: "activity:read_all",
  athlete: validAthleteProfile
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockExchangeCodeForTokens.mockResolvedValue(validTokens);
  mockUpsertConnection.mockResolvedValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/strava/callback", () => {
  it("redirects to error page when user denies access", async () => {
    const req = makeRequest({ error: "access_denied" });
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("error=strava_denied");
  });

  it("redirects to error page when code is missing", async () => {
    const req = makeRequest({ state: makeState("user-1", "nonce-abc") }, "nonce-abc");
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("error=strava_invalid");
  });

  it("redirects to error page when state is missing", async () => {
    const req = makeRequest({ code: "auth-code" }, "nonce-abc");
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("error=strava_invalid");
  });

  it("redirects to error page when nonce cookie is missing", async () => {
    const req = makeRequest({ code: "auth-code", state: makeState("user-1", "nonce-abc") });
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("error=strava_invalid");
  });

  it("redirects to error page when nonce does not match", async () => {
    const req = makeRequest(
      { code: "auth-code", state: makeState("user-1", "correct-nonce") },
      "wrong-nonce"
    );
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("error=strava_invalid");
  });

  it("redirects to error page when token exchange fails", async () => {
    mockExchangeCodeForTokens.mockRejectedValue(new Error("Strava code exchange 401"));
    const nonce = "test-nonce";
    const req = makeRequest({ code: "code", state: makeState("user-1", nonce) }, nonce);
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("error=strava_exchange");
    expect(mockUpsertConnection).not.toHaveBeenCalled();
  });

  it("stores connection and redirects on success", async () => {
    const nonce = "test-nonce";
    const req = makeRequest({ code: "auth-code", state: makeState("user-1", nonce) }, nonce);
    const res = await GET(req);

    expect(mockExchangeCodeForTokens).toHaveBeenCalledWith(
      "auth-code",
      "http://localhost:3000/api/integrations/strava/callback"
    );
    expect(mockUpsertConnection).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        provider: "strava",
        providerAthleteId: "123",
        accessToken: "acc",
        providerDisplayName: "Jane Doe"
      })
    );
    expect(res.headers.get("location")).toContain("connected=strava");
    // No backfill triggered — user controls sync via button
    expect(mockBackfillRecentActivities).not.toHaveBeenCalled();
  });

  it("clears the nonce cookie on success", async () => {
    const nonce = "clear-me";
    const req = makeRequest({ code: "code", state: makeState("user-1", nonce) }, nonce);
    const res = await GET(req);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("strava_oauth_nonce=");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("redirects to error when user mismatch in state", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "different-user" } } });
    const nonce = "nonce-xyz";
    const req = makeRequest({ code: "code", state: makeState("user-1", nonce) }, nonce);
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("error=strava_invalid");
  });
});
