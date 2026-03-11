import { TextDecoder, TextEncoder } from "node:util";
import { ReadableStream } from "node:stream/web";

(globalThis as unknown as { ReadableStream?: typeof ReadableStream }).ReadableStream = ReadableStream;
(globalThis as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(globalThis as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;
class MockResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this.status = init?.status ?? 200;
    this.headers = new Headers(init?.headers);
    this.body = (body as ReadableStream<Uint8Array>) ?? null;
  }

  async text() {
    if (!this.body) {
      return "";
    }

    const reader = this.body.getReader();
    const decoder = new TextDecoder();
    let output = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      output += decoder.decode(value, { stream: true });
    }

    return output;
  }
}

(globalThis as unknown as { Response?: typeof MockResponse }).Response = MockResponse;

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
  const conversationsLookupBuilder = createBuilder({ maybeSingle: opts?.conversationLookup ?? { data: { id: "conv1", last_response_id: null }, error: null } });
  const conversationsInsertBuilder = createBuilder({ single: { data: { id: opts?.createdConversationId ?? "conv1", last_response_id: null }, error: null } });
  const messagesSelectBuilder = createBuilder({ limit: { data: opts?.history ?? [], error: null } });
  const aiMessagesInsert = jest.fn().mockResolvedValue({ error: null });

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
          insert: aiMessagesInsert
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    })
  };

  return { supabase, conversationsLookupBuilder, aiMessagesInsert };
}

function makeRequest(url: string, body: Record<string, unknown>) {
  return {
    url,
    signal: new AbortController().signal,
    json: async () => body
  } as Request;
}

function makeStream(events: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    }
  };
}

async function readSse(response: Response) {
  const text = await response.text();
  const frames = text.split("\n\n").filter(Boolean);
  return frames.map((frame) => {
    const eventName = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
    const dataLine = frame.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim() ?? "{}";
    return { event: eventName, data: JSON.parse(dataLine) as Record<string, unknown> };
  });
}

describe("POST /api/coach/chat streaming", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    (resolveCoachAuthContext as jest.Mock).mockResolvedValue({ supabase: {}, ctx: null, reason: "unauthenticated" });
    const res = await POST(makeRequest("http://localhost/api/coach/chat", { message: "Need help with my week" }));
    expect(res.status).toBe(401);
  });

  it("streams assistant chunks and completion metadata", async () => {
    const { supabase } = createSupabaseMock({ history: [] });
    (resolveCoachAuthContext as jest.Mock).mockResolvedValue({
      supabase,
      ctx: { userId: "user-a", athleteId: "athlete-a", email: "a@example.com" },
      reason: null
    });

    const create = jest.fn()
      .mockResolvedValueOnce(
        makeStream([
          { type: "response.created", response: { id: "resp-analysis" } },
          { type: "response.output_text.delta", delta: "Internal draft" }
        ])
      )
      .mockResolvedValueOnce(
        makeStream([
          { type: "response.created", response: { id: "resp-1" } },
          { type: "response.output_text.delta", delta: "Keep " },
          { type: "response.output_text.delta", delta: "it easy." }
        ])
      )
      .mockResolvedValueOnce(
        makeStream([
          { type: "response.created", response: { id: "resp-structured" } },
          {
            type: "response.output_text.delta",
            delta: JSON.stringify({ headline: "Stay easy", answer: "Keep it easy.", insights: [], actions: [], warnings: [] })
          }
        ])
      );

    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });

    const res = await POST(makeRequest("http://localhost/api/coach/chat", { message: "How should I adjust this week?", conversationId: null }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSse(res as Response);
    const deltas = events.filter((event) => event.event === "message_delta");

    expect(deltas.map((event) => event.data.chunk)).toEqual(["Keep ", "it easy."]);
    expect(events.find((event) => event.event === "message_start")?.data.conversationId).toBe("conv1");
    expect(events.find((event) => event.event === "message_complete")?.data).toMatchObject({
      conversationId: "conv1",
      responseId: "resp-1",
      structured: { headline: "Stay easy", answer: "Keep it easy." }
    });
  });

  it("keeps tool calls server-side and scoped", async () => {
    const { supabase } = createSupabaseMock({ history: [] });
    (resolveCoachAuthContext as jest.Mock).mockResolvedValue({
      supabase,
      ctx: { userId: "user-a", athleteId: "athlete-a", email: "a@example.com" },
      reason: null
    });

    (executeCoachTool as jest.Mock).mockResolvedValue({ weekStart: "2026-03-09", completionRatio: 0.75 });

    const create = jest.fn()
      .mockResolvedValueOnce(
        makeStream([
          { type: "response.created", response: { id: "resp-1" } },
          {
            type: "response.output_item.done",
            item: { type: "function_call", call_id: "call-1", name: "get_week_progress", arguments: "{}" }
          }
        ])
      )
      .mockResolvedValueOnce(
        makeStream([
          { type: "response.created", response: { id: "resp-2" } },
          { type: "response.output_text.delta", delta: "Internal stitched answer." }
        ])
      )
      .mockResolvedValueOnce(
        makeStream([
          { type: "response.created", response: { id: "resp-final" } },
          { type: "response.output_text.delta", delta: "You are on track." }
        ])
      )
      .mockResolvedValueOnce(
        makeStream([
          { type: "response.created", response: { id: "resp-3" } },
          {
            type: "response.output_text.delta",
            delta: JSON.stringify({ headline: "On track", answer: "You are on track.", insights: [], actions: [], warnings: [] })
          }
        ])
      );

    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });

    const res = await POST(makeRequest("http://localhost/api/coach/chat", { message: "How am I doing this week?" }));
    const events = await readSse(res as Response);

    expect(events.find((event) => event.event === "message_complete")?.data).toMatchObject({ responseId: "resp-final" });
    expect(executeCoachTool).toHaveBeenCalledWith(
      "get_week_progress",
      {},
      expect.objectContaining({
        ctx: expect.objectContaining({ userId: "user-a", athleteId: "athlete-a" })
      })
    );
  });

  it("returns stream error event when model call fails", async () => {
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

    const res = await POST(makeRequest("http://localhost/api/coach/chat", { message: "What should I do tomorrow?" }));
    const events = await readSse(res as Response);

    expect(events.find((event) => event.event === "message_complete")?.data).toMatchObject({
      structured: {
        answer: "I can’t reach the coaching model right now. Please try again soon."
      }
    });
  });
});
