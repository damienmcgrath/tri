jest.mock("../../../../lib/coach/auth", () => ({
  resolveCoachAuthContext: jest.fn()
}));

jest.mock("../../../../lib/openai", () => ({
  getCoachModel: jest.fn(() => "gpt-test"),
  getOpenAIClient: jest.fn()
}));

jest.mock("../../../../lib/coach/tool-handlers", () => ({
  executeCoachTool: jest.fn()
}));

jest.mock("../../../../lib/security/request", () => ({
  isSameOrigin: jest.fn(() => true),
  getClientIp: jest.fn(() => "127.0.0.1")
}));

jest.mock("../../../../lib/security/rate-limit", () => ({
  checkRateLimit: jest.fn(() => ({ allowed: true, limit: 20, remaining: 19, resetAt: Date.now() + 60000 })),
  rateLimitHeaders: jest.fn(() => ({}))
}));


jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: HeadersInit }) => ({
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
      json: async () => body
    })
  }
}));

import { POST } from "./route";
import { resolveCoachAuthContext } from "../../../../lib/coach/auth";
import { getOpenAIClient } from "../../../../lib/openai";
import { executeCoachTool } from "../../../../lib/coach/tool-handlers";

function createBuilder(terminals?: { maybeSingle?: unknown; single?: unknown; limit?: unknown }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(terminals?.limit ?? { data: [], error: null }),
    maybeSingle: jest.fn().mockResolvedValue(terminals?.maybeSingle ?? { data: null, error: null }),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(terminals?.single ?? { data: null, error: null }),
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null })
    })
  };
}

function createSupabaseMock(opts?: {
  conversationLookup?: unknown;
  createdConversationId?: string;
  history?: unknown[];
}) {
  const conversationsLookupBuilder = createBuilder({ maybeSingle: opts?.conversationLookup ?? { data: { id: "conv1" }, error: null } });
  const conversationsInsertBuilder = createBuilder({ single: { data: { id: opts?.createdConversationId ?? "conv1" }, error: null } });
  const messagesSelectBuilder = createBuilder({ limit: { data: opts?.history ?? [], error: null } });

  const supabase = {
    from: jest.fn((table: string) => {
      if (table === "ai_conversations") {
        return {
          select: jest.fn(() => conversationsLookupBuilder),
          insert: jest.fn(() => conversationsInsertBuilder),
          update: conversationsInsertBuilder.update
        };
      }

      if (table === "ai_messages") {
        return {
          select: jest.fn(() => messagesSelectBuilder),
          insert: jest.fn().mockResolvedValue({ error: null })
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    })
  };

  return { supabase, conversationsLookupBuilder, messagesSelectBuilder };
}


function makeRequest(url: string, body: Record<string, unknown>) {
  return {
    url,
    json: async () => body
  } as Request;
}

describe("POST /api/coach/chat hardening", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    (resolveCoachAuthContext as jest.Mock).mockResolvedValue({ supabase: {}, ctx: null, reason: "unauthenticated" });

    const req = makeRequest("http://localhost/api/coach/chat", { message: "Need help with my week" });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects authenticated users without athlete profile", async () => {
    (resolveCoachAuthContext as jest.Mock).mockResolvedValue({ supabase: {}, ctx: null, reason: "missing-athlete-profile" });

    const req = makeRequest("http://localhost/api/coach/chat", { message: "Need help with my week" });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("rejects accessing a conversation not owned by current athlete", async () => {
    const { supabase } = createSupabaseMock({ conversationLookup: { data: null, error: null } });

    (resolveCoachAuthContext as jest.Mock).mockResolvedValue({
      supabase,
      ctx: { userId: "user-a", athleteId: "athlete-a", email: "a@example.com" },
      reason: null
    });

    const req = makeRequest("http://localhost/api/coach/chat", {
        message: "Need help with my week",
        conversationId: "11111111-1111-4111-8111-111111111111"
      });

    const res = await POST(req);
    expect(res.status).toBe(404);
    expect((supabase.from as jest.Mock).mock.calls[0][0]).toBe("ai_conversations");
  });


  it("accepts null conversationId payloads from the client", async () => {
    const { supabase } = createSupabaseMock({ history: [] });

    (resolveCoachAuthContext as jest.Mock).mockResolvedValue({
      supabase,
      ctx: { userId: "user-a", athleteId: "athlete-a", email: "a@example.com" },
      reason: null
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: {
        create: jest.fn()
          .mockResolvedValueOnce({
            id: "resp-1",
            output: [],
            output_text: "Keep intensity controlled this week."
          })
          .mockResolvedValueOnce({
            id: "resp-2",
            output: [],
            output_text: JSON.stringify({
              headline: "Stay controlled",
              answer: "Keep intensity controlled this week.",
              insights: [],
              actions: [],
              warnings: []
            })
          })
      }
    });

    const req = makeRequest("http://localhost/api/coach/chat", {
      message: "How should I adjust this week?",
      conversationId: null
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      conversationId: "conv1",
      headline: "Stay controlled"
    });
  });


  it("returns fallback guidance instead of 502 when model call fails", async () => {
    const { supabase } = createSupabaseMock({ history: [] });

    (resolveCoachAuthContext as jest.Mock).mockResolvedValue({
      supabase,
      ctx: { userId: "user-a", athleteId: "athlete-a", email: "a@example.com" },
      reason: null
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: {
        create: jest.fn().mockRejectedValue(new Error("Upstream OpenAI outage"))
      }
    });

    const req = makeRequest("http://localhost/api/coach/chat", {
      message: "What should I do tomorrow?",
      conversationId: null
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.answer).toBe("I can’t reach the coaching model right now. Please try again soon.");
    expect(body.headline).toBe("I can’t reach the coaching model right now. Please try again soon.");
  });

  it("runs tool loop and returns stable structured JSON shape", async () => {
    const { supabase } = createSupabaseMock({ history: [] });

    (resolveCoachAuthContext as jest.Mock).mockResolvedValue({
      supabase,
      ctx: { userId: "user-a", athleteId: "athlete-a", email: "a@example.com" },
      reason: null
    });

    (executeCoachTool as jest.Mock).mockResolvedValue({ weekStart: "2026-03-09", completionRatio: 0.75 });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: {
        create: jest.fn()
          .mockResolvedValueOnce({
            id: "resp-1",
            output: [{ type: "function_call", call_id: "call-1", name: "get_week_progress", arguments: "{}" }],
            output_text: ""
          })
          .mockResolvedValueOnce({
            id: "resp-2",
            output: [],
            output_text: "You are on track this week."
          })
          .mockResolvedValueOnce({
            id: "resp-3",
            output: [],
            output_text: JSON.stringify({
              headline: "On track",
              answer: "You are on track this week.",
              insights: ["3 of 4 key sessions completed"],
              actions: [{ type: "focus", label: "Keep Thursday easy" }],
              warnings: []
            })
          })
      }
    });

    const req = makeRequest("http://localhost/api/coach/chat", { message: "How am I doing this week?" });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      conversationId: "conv1",
      responseId: "resp-2",
      headline: "On track",
      answer: "You are on track this week.",
      insights: expect.any(Array),
      actions: expect.any(Array),
      warnings: expect.any(Array)
    });

    expect(executeCoachTool).toHaveBeenCalledWith(
      "get_week_progress",
      {},
      expect.objectContaining({
        ctx: expect.objectContaining({ userId: "user-a", athleteId: "athlete-a" })
      })
    );

    const lookupConversationReq = makeRequest("http://localhost/api/coach/chat", {
        message: "continue",
        conversationId: "11111111-1111-4111-8111-111111111111"
      });

    const { supabase: supabaseWithLookup, conversationsLookupBuilder } = createSupabaseMock({
      conversationLookup: { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null },
      history: []
    });

    (resolveCoachAuthContext as jest.Mock).mockResolvedValueOnce({
      supabase: supabaseWithLookup,
      ctx: { userId: "user-a", athleteId: "athlete-a", email: "a@example.com" },
      reason: null
    });

    await POST(lookupConversationReq);

    expect(conversationsLookupBuilder.eq).toHaveBeenCalledWith("athlete_id", "athlete-a");
  });
});
