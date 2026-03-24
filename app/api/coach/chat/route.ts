import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveCoachAuthContext } from "@/lib/coach/auth";
import { COACH_STRUCTURING_INSTRUCTIONS, COACH_SYSTEM_INSTRUCTIONS } from "@/lib/coach/instructions";
import { executeCoachTool } from "@/lib/coach/tool-handlers";
import { coachToolSchemas, coachTools, type CoachToolName } from "@/lib/coach/tools";
import { coachChatRequestSchema, coachStructuredResponseSchema, type CoachStructuredResponse } from "@/lib/coach/types";
import { getCoachModel, getOpenAIClient } from "@/lib/openai";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";
import { logCoachAudit } from "@/lib/coach/audit";

type ConversationRow = {
  id: string;
  title: string;
  updated_at: string;
  last_response_id: string | null;
};

type ConversationMessageRow = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

function isCoachToolName(name: string): name is CoachToolName {
  return Object.prototype.hasOwnProperty.call(coachToolSchemas, name);
}

function parseToolArgs(argumentsJson: string) {
  if (!argumentsJson || argumentsJson.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(argumentsJson) as Record<string, unknown>;
  } catch {
    throw new Error("Model provided invalid JSON tool arguments.");
  }
}

function extractOutputText(response: { output_text?: string }) {
  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("Model returned an empty response.");
  }
  return text;
}

function safeStructuredFallback(answer: string): CoachStructuredResponse {
  return {
    headline: "Coach recommendation",
    answer,
    insights: [],
    actions: [],
    warnings: []
  };
}

function buildServiceFallback() {
  const answer = "I can’t reach the coaching model right now. Please try again soon.";

  return {
    answer,
    structured: {
      headline: answer,
      answer,
      insights: [],
      actions: [],
      warnings: []
    },
    responseId: undefined as string | undefined,
    previousResponseId: undefined as string | undefined
  };
}

type StreamedResponseResult = {
  responseId: string;
  outputText: string;
  toolCalls: Array<{ callId: string; name: string; argumentsJson: string }>;
};

type StreamWriters = {
  onAnswerDelta?: (chunk: string) => void;
};

function sseEvent(event: string, data: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function collectResponseStream(params: {
  request: Parameters<ReturnType<typeof getOpenAIClient>["responses"]["create"]>[0];
  signal: AbortSignal;
  streamWriters?: StreamWriters;
  emitAnswerText: boolean;
}) {
  const client = getOpenAIClient();
  const stream = await client.responses.create({ ...params.request, stream: true }, { signal: params.signal });

  let responseId = "";
  let outputText = "";
  const toolCallMap = new Map<string, { callId: string; name: string; argumentsJson: string }>();

  for await (const event of stream) {
    if (event.type === "response.created") {
      responseId = event.response.id;
      continue;
    }

    if (event.type === "response.output_text.delta") {
      outputText += event.delta;
      if (params.emitAnswerText) {
        params.streamWriters?.onAnswerDelta?.(event.delta);
      }
      continue;
    }

    if (event.type === "response.output_item.added" && event.item.type === "function_call") {
      toolCallMap.set(event.item.call_id, {
        callId: event.item.call_id,
        name: event.item.name,
        argumentsJson: event.item.arguments ?? ""
      });
      continue;
    }

    if (event.type === "response.function_call_arguments.delta") {
      const existing = toolCallMap.get(event.item_id);
      if (existing) {
        existing.argumentsJson += event.delta;
      }
      continue;
    }

    if (event.type === "response.output_item.done" && event.item.type === "function_call") {
      toolCallMap.set(event.item.call_id, {
        callId: event.item.call_id,
        name: event.item.name,
        argumentsJson: event.item.arguments ?? ""
      });
    }
  }

  if (!responseId) {
    throw new Error("Model response stream completed without response id.");
  }

  return {
    responseId,
    outputText,
    toolCalls: [...toolCallMap.values()]
  } satisfies StreamedResponseResult;
}

async function runCoachResponseFlow(params: {
  userMessage: string;
  priorMessages: ConversationMessageRow[];
  previousResponseId?: string;
  supabaseConversationId: string;
  toolDeps: Parameters<typeof executeCoachTool>[2];
  signal: AbortSignal;
  streamWriters?: StreamWriters;
}) {
  const history = params.priorMessages.slice(-10).map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n");

  let response = await collectResponseStream({
    request: {
      model: getCoachModel(),
      instructions: COACH_SYSTEM_INSTRUCTIONS,
      previous_response_id: params.previousResponseId,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: `<context>\nConversation ID: ${params.supabaseConversationId}\nRecent chat:\n${history || "(none)"}\n</context>` }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: params.userMessage }]
        }
      ],
      tools: coachTools,
      tool_choice: "auto"
    },
    signal: params.signal,
    emitAnswerText: false
  });

  const seededPreviousResponseId = params.previousResponseId;

  for (let i = 0; i < 6; i += 1) {
    const toolCalls = response.toolCalls;

    if (toolCalls.length === 0) {
      break;
    }

    const toolOutputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];

    for (const call of toolCalls) {
      if (!isCoachToolName(call.name)) {
        logCoachAudit("warn", "coach.tool.unknown", {
          ctx: params.toolDeps.ctx,
          route: "POST /api/coach/chat",
          toolName: call.name,
          success: false,
          reason: "Tool name not registered"
        });

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.callId,
          output: JSON.stringify({ error: `Unsupported tool: ${call.name}` })
        });

        continue;
      }

      const toolName: CoachToolName = call.name;
      const parsedArgs = parseToolArgs(call.argumentsJson);

      try {
        const output = await executeCoachTool(toolName, parsedArgs, params.toolDeps);
        toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(output) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown tool error";
        toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ error: message }) });
      }
    }

    response = await collectResponseStream({
      request: {
        model: getCoachModel(),
        previous_response_id: response.responseId,
        input: toolOutputs,
        instructions: COACH_SYSTEM_INSTRUCTIONS
      },
      signal: params.signal,
      emitAnswerText: false
    });
  }

  const finalAnswerResponse = await collectResponseStream({
    request: {
      model: getCoachModel(),
      previous_response_id: response.responseId,
      instructions: COACH_SYSTEM_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Now provide the final athlete-facing answer only. Do not include tool-call traces, function arguments, raw JSON payloads, or internal reasoning." }]
        }
      ]
    },
    signal: params.signal,
    streamWriters: params.streamWriters,
    emitAnswerText: true
  });

  const draftAnswer = extractOutputText({ output_text: finalAnswerResponse.outputText });

  const formatterResponse = await collectResponseStream({
    request: {
      model: getCoachModel(),
      instructions: COACH_STRUCTURING_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: `Return strict JSON only.\n\n${draftAnswer}` }]
        }
      ]
    },
    signal: params.signal,
    emitAnswerText: false
  });

  const structuredJson = extractOutputText({ output_text: formatterResponse.outputText });
  const parsed = z.string().transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Formatter response was not JSON." });
      return z.NEVER;
    }
  }).pipe(coachStructuredResponseSchema).safeParse(structuredJson);

  return {
    answer: draftAnswer,
    structured: parsed.success ? parsed.data : safeStructuredFallback(draftAnswer),
    responseId: finalAnswerResponse.responseId,
    previousResponseId: seededPreviousResponseId
  };
}

export async function GET(request: Request) {
  const { supabase, ctx } = await resolveCoachAuthContext();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");

  if (conversationId) {
    if (!z.string().uuid().safeParse(conversationId).success) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("ai_messages")
      .select("role,content,created_at")
      .eq("user_id", ctx.userId)
      .eq("athlete_id", ctx.athleteId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: (data ?? []) as ConversationMessageRow[] });
  }

  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id,title,updated_at,last_response_id")
    .eq("user_id", ctx.userId)
    .eq("athlete_id", ctx.athleteId)
    .order("updated_at", { ascending: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: (data ?? []) as ConversationRow[] });
}

const conversationMutationSchema = z.object({
  conversationId: z.string().uuid(),
  title: z.string().trim().min(1).max(80).optional()
});

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let payload: z.infer<typeof conversationMutationSchema>;

  try {
    payload = conversationMutationSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid conversation payload." }, { status: 400 });
  }

  if (!payload.title) {
    return NextResponse.json({ error: "A title is required." }, { status: 400 });
  }

  const { supabase, ctx } = await resolveCoachAuthContext();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("ai_conversations")
    .update({ title: payload.title, updated_at: new Date().toISOString() })
    .eq("id", payload.conversationId)
    .eq("user_id", ctx.userId)
    .eq("athlete_id", ctx.athleteId)
    .select("id,title,updated_at,last_response_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json({ conversation: data as ConversationRow });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");

  if (!conversationId || !z.string().uuid().safeParse(conversationId).success) {
    return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
  }

  const { supabase, ctx } = await resolveCoachAuthContext();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error: deleteMessagesError } = await supabase
    .from("ai_messages")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", ctx.userId)
    .eq("athlete_id", ctx.athleteId);

  if (deleteMessagesError) {
    return NextResponse.json({ error: deleteMessagesError.message }, { status: 500 });
  }

  const { error: deleteConversationError } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", ctx.userId)
    .eq("athlete_id", ctx.athleteId);

  if (deleteConversationError) {
    return NextResponse.json({ error: deleteConversationError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipRateLimit = checkRateLimit("chat-ip", ip, { maxRequests: 40, windowMs: 60_000 });

  if (!ipRateLimit.allowed) {
    return NextResponse.json({ error: "Too many chat requests. Please try again shortly." }, {
      status: 429,
      headers: rateLimitHeaders(ipRateLimit)
    });
  }

  let payload: z.infer<typeof coachChatRequestSchema>;

  try {
    payload = coachChatRequestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid chat payload." }, { status: 400 });
  }

  const { supabase, ctx, reason } = await resolveCoachAuthContext();

  if (!ctx) {
    if (reason === "missing-athlete-profile") {
      logCoachAudit("warn", "coach.chat.auth_missing_profile", { route: "POST /api/coach/chat" });
      return NextResponse.json({ error: "Athlete profile is required before using coach chat." }, { status: 403 });
    }

    logCoachAudit("warn", "coach.chat.unauthorized", { route: "POST /api/coach/chat" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRateLimit = checkRateLimit("chat-user", ctx.userId, { maxRequests: 20, windowMs: 60_000 });

  if (!userRateLimit.allowed) {
    return NextResponse.json({ error: "Chat limit reached. Please wait a minute and retry." }, {
      status: 429,
      headers: rateLimitHeaders(userRateLimit)
    });
  }

  let conversationId = payload.conversationId;
  let conversationLastResponseId: string | undefined;

  if (conversationId) {
    if (!z.string().uuid().safeParse(conversationId).success) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }
    const { data: existingConversation } = await supabase
      .from("ai_conversations")
      .select("id,last_response_id")
      .eq("id", conversationId)
      .eq("user_id", ctx.userId)
      .eq("athlete_id", ctx.athleteId)
      .maybeSingle();

    if (!existingConversation) {
      logCoachAudit("warn", "coach.chat.invalid_conversation_access", {
        ctx,
        route: "POST /api/coach/chat",
        success: false,
        reason: "Conversation not owned by athlete"
      });
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    conversationLastResponseId = existingConversation.last_response_id ?? undefined;
  }

  if (!conversationId) {
    const { data: createdConversation, error: conversationError } = await supabase
      .from("ai_conversations")
      .insert({ user_id: ctx.userId, athlete_id: ctx.athleteId, title: payload.message.slice(0, 60) })
      .select("id,last_response_id")
      .single();

    if (conversationError || !createdConversation) {
      return NextResponse.json({ error: conversationError?.message ?? "Failed to create conversation." }, { status: 500 });
    }

    conversationId = createdConversation.id;
    conversationLastResponseId = createdConversation.last_response_id ?? undefined;
  }

  const resolvedConversationId = conversationId;

  if (!resolvedConversationId) {
    return NextResponse.json({ error: "Failed to resolve conversation." }, { status: 500 });
  }

  const { data: recentMessages, error: historyError } = await supabase
    .from("ai_messages")
    .select("role,content,created_at")
    .eq("user_id", ctx.userId)
    .eq("athlete_id", ctx.athleteId)
    .eq("conversation_id", resolvedConversationId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }

  const stream = new ReadableStream({
    start: (controller) => {
      const encoder = new TextEncoder();
      const pushEvent = (event: string, data: Record<string, unknown>) => controller.enqueue(encoder.encode(sseEvent(event, data)));

      pushEvent("message_start", { conversationId: resolvedConversationId });

      void (async () => {
        let result: Awaited<ReturnType<typeof runCoachResponseFlow>> | ReturnType<typeof buildServiceFallback>;

        try {
          result = await runCoachResponseFlow({
            userMessage: payload.message,
            priorMessages: [...((recentMessages ?? []) as ConversationMessageRow[])].reverse(),
            previousResponseId: conversationLastResponseId,
            supabaseConversationId: resolvedConversationId,
            toolDeps: { ctx, supabase },
            signal: request.signal,
            streamWriters: {
              onAnswerDelta: (chunk) => pushEvent("message_delta", { chunk })
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          logCoachAudit("error", "coach.chat.response_failure", {
            ctx,
            route: "POST /api/coach/chat",
            success: false,
            reason: message
          });

          result = buildServiceFallback();
        }

        const { error: insertMessagesError } = await supabase.from("ai_messages").insert([
          {
            conversation_id: resolvedConversationId,
            user_id: ctx.userId,
            athlete_id: ctx.athleteId,
            role: "user",
            content: payload.message,
            previous_response_id: result.previousResponseId ?? null,
            model: getCoachModel()
          },
          {
            conversation_id: resolvedConversationId,
            user_id: ctx.userId,
            athlete_id: ctx.athleteId,
            role: "assistant",
            content: result.answer,
            response_id: result.responseId ?? null,
            previous_response_id: result.previousResponseId ?? null,
            model: getCoachModel()
          }
        ]);

        if (insertMessagesError) {
          pushEvent("error", { error: insertMessagesError.message });
          controller.close();
          return;
        }

        // Update conversation timestamp and improve title from AI headline on first message
        const conversationUpdate: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
          last_response_id: result.responseId ?? null
        };

        // If this is a new conversation (only 1 user message so far), derive a better title
        // from the AI's structured headline rather than just truncating the user's message
        if (recentMessages && recentMessages.length === 0 && result.structured?.headline) {
          const headline = (result.structured.headline as string).slice(0, 80);
          if (headline.length > 0) {
            conversationUpdate.title = headline;
          }
        }

        await supabase
          .from("ai_conversations")
          .update(conversationUpdate)
          .eq("id", resolvedConversationId);

        logCoachAudit("info", "coach.chat.response_success", {
          ctx,
          route: "POST /api/coach/chat",
          success: true
        });

        pushEvent("message_complete", {
          conversationId: resolvedConversationId,
          responseId: result.responseId,
          structured: result.structured
        });
        controller.close();
      })().catch((error) => {
        const message = error instanceof Error ? error.message : "Unexpected streaming failure";
        pushEvent("error", { error: message });
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...rateLimitHeaders(userRateLimit)
    }
  });
}
