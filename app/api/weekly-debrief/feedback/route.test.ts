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

jest.mock("../../../../lib/weekly-debrief", () => {
  const { z } = require("zod");
  return {
    saveWeeklyDebriefFeedback: jest.fn(),
    weeklyDebriefFeedbackInputSchema: z.object({
      weekStart: z.string(),
      helpful: z.boolean().nullable(),
      accurate: z.boolean().nullable(),
      note: z.string().nullable().optional()
    })
  };
});

import { createClient } from "../../../../lib/supabase/server";
import { saveWeeklyDebriefFeedback } from "../../../../lib/weekly-debrief";
import { POST } from "./route";

describe("POST /api/weekly-debrief/feedback", () => {
  const mockedCreateClient = createClient as jest.Mock;
  const mockedSaveWeeklyDebriefFeedback = saveWeeklyDebriefFeedback as jest.Mock;

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

  test("persists helpfulness and accuracy feedback", async () => {
    mockedSaveWeeklyDebriefFeedback.mockResolvedValue({
      weekStart: "2026-03-09",
      feedback: {
        helpful: true,
        accurate: false,
        note: "Too soft on the missed bike session."
      }
    });

    const response = await POST({
      json: async () => ({
        weekStart: "2026-03-09",
        helpful: true,
        accurate: false,
        note: "Too soft on the missed bike session."
      })
    } as Request);

    expect(response.status).toBe(200);
    expect(mockedSaveWeeklyDebriefFeedback).toHaveBeenCalledWith({
      supabase: expect.any(Object),
      athleteId: "user-1",
      input: {
        weekStart: "2026-03-09",
        helpful: true,
        accurate: false,
        note: "Too soft on the missed bike session."
      }
    });
  });
});
