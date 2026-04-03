jest.mock("../../../../lib/security/request", () => ({
  isSameOrigin: jest.fn(() => true),
  getClientIp: jest.fn(() => "127.0.0.1")
}));

jest.mock("../../../../lib/security/rate-limit", () => ({
  checkRateLimit: jest.fn(() => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60000 })),
  rateLimitHeaders: jest.fn(() => ({}))
}));

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body
    })
  }
}));

jest.mock("../../../../lib/supabase/server", () => ({
  createClient: jest.fn()
}));

jest.mock("../../../../lib/athlete-context", () => ({
  getCurrentWeekStart: jest.fn(() => "2026-03-09")
}));

jest.mock("../../../../lib/weekly-debrief", () => ({
  refreshWeeklyDebrief: jest.fn()
}));

import { createClient } from "../../../../lib/supabase/server";
import { refreshWeeklyDebrief } from "../../../../lib/weekly-debrief";
import { POST } from "./route";

describe("POST /api/weekly-debrief/refresh", () => {
  const mockedCreateClient = createClient as jest.Mock;
  const mockedRefreshWeeklyDebrief = refreshWeeklyDebrief as jest.Mock;

  beforeEach(() => {
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              user_metadata: { timezone: "UTC" }
            }
          }
        })
      }
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("returns refreshed debrief payload", async () => {
    mockedRefreshWeeklyDebrief.mockResolvedValue({
      readiness: { isReady: true, reason: "Ready" },
      artifact: { weekStart: "2026-03-09" }
    });

    const response = await POST({
      json: async () => ({ weekStart: "2026-03-09" })
    } as Request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      readiness: { isReady: true, reason: "Ready" },
      artifact: { weekStart: "2026-03-09" }
    });
    expect(mockedRefreshWeeklyDebrief).toHaveBeenCalledWith(expect.objectContaining({
      athleteId: "user-1",
      weekStart: "2026-03-09"
    }));
  });
});
