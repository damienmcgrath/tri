jest.mock("../../../../../lib/security/request", () => ({
  isSameOrigin: jest.fn(() => true)
}));

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body
    })
  }
}));

jest.mock("../../../../../lib/supabase/server", () => ({
  createClient: jest.fn()
}));

jest.mock("../../../../../lib/workouts/activity-metrics-backfill", () => ({
  backfillActivityMetrics: jest.fn()
}));

import { createClient } from "../../../../../lib/supabase/server";
import { backfillActivityMetrics } from "../../../../../lib/workouts/activity-metrics-backfill";
import { POST } from "./route";

describe("POST /api/uploads/activities/backfill", () => {
  const mockedCreateClient = createClient as jest.Mock;
  const mockedBackfillActivityMetrics = backfillActivityMetrics as jest.Mock;

  beforeEach(() => {
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1"
            }
          }
        })
      }
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("returns backfill summary", async () => {
    mockedBackfillActivityMetrics.mockResolvedValue({
      attempted: 20,
      updated: 20,
      skipped: 0,
      failed: 0
    });

    const response = await POST({
      json: async () => ({ all: true })
    } as Request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      attempted: 20,
      updated: 20,
      skipped: 0,
      failed: 0
    });
    expect(mockedBackfillActivityMetrics).toHaveBeenCalledWith({
      supabase: expect.anything(),
      userId: "user-1",
      limit: undefined,
      force: true
    });
  });
});
