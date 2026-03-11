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

async function runCoachResponseFlow(params: {
  userMessage: string;
  priorMessages: ConversationMessageRow[];
  previousResponseId?: string;
  supabaseConversationId: string;
  toolDeps: Parameters<typeof executeCoachTool>[2];
}) {
  const client = getOpenAIClient();
  const history = params.priorMessages.slice(-10).map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n");

  let response = await client.responses.create({
    model: getCoachModel(),
    instructions: COACH_SYSTEM_INSTRUCTIONS,
    previous_response_id: params.previousResponseId,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: `Conversation ID: ${params.supabaseConversationId}\nRecent chat:\n${history || "(none)"}\n\nAthlete message: ${params.userMessage}` }]
      }
    ],
    tools: coachTools,
    tool_choice: "auto",
    stream: false
  });

  for (let i = 0; i < 6; i += 1) {
    const toolCalls = response.output.filter((item): item is { type: "function_call"; call_id: string; name: string; arguments: string } => item.type === "function_call");

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
          call_id: call.call_id,
          output: JSON.stringify({ error: `Unsupported tool: ${call.name}` })
        });

        continue;
      }

      const toolName: CoachToolName = call.name;
      const parsedArgs = parseToolArgs(call.arguments);

      try {
        const output = await executeCoachTool(toolName, parsedArgs, params.toolDeps);
        toolOutputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown tool error";
        toolOutputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: message }) });
      }
    }

    response = await client.responses.create({
      model: getCoachModel(),
      previous_response_id: response.id,
      input: toolOutputs,
      instructions: COACH_SYSTEM_INSTRUCTIONS,
      stream: false
    });
  }

  const draftAnswer = extractOutputText(response);

  const formatterResponse = await client.responses.create({
    model: getCoachModel(),
    instructions: COACH_STRUCTURING_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: `Return strict JSON only.\n\n${draftAnswer}` }]
      }
    ],
    stream: false
  });

  const structuredJson = extractOutputText(formatterResponse);
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
    responseId: response.id
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
    .select("id,title,updated_at")
    .eq("user_id", ctx.userId)
    .eq("athlete_id", ctx.athleteId)
    .order("updated_at", { ascending: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: (data ?? []) as ConversationRow[] });
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

  if (conversationId) {
    if (!z.string().uuid().safeParse(conversationId).success) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }
    const { data: existingConversation } = await supabase
      .from("ai_conversations")
      .select("id")
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
  }

  if (!conversationId) {
    const { data: createdConversation, error: conversationError } = await supabase
      .from("ai_conversations")
      .insert({ user_id: ctx.userId, athlete_id: ctx.athleteId, title: payload.message.slice(0, 60) })
      .select("id")
      .single();

    if (conversationError || !createdConversation) {
      return NextResponse.json({ error: conversationError?.message ?? "Failed to create conversation." }, { status: 500 });
    }

    conversationId = createdConversation.id;
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

  try {
    const result = await runCoachResponseFlow({
      userMessage: payload.message,
      priorMessages: [...((recentMessages ?? []) as ConversationMessageRow[])].reverse(),
      previousResponseId: payload.previousResponseId,
      supabaseConversationId: resolvedConversationId,
      toolDeps: { ctx, supabase }
    });

    const { error: insertMessagesError } = await supabase.from("ai_messages").insert([
      {
        conversation_id: resolvedConversationId,
        user_id: ctx.userId,
        athlete_id: ctx.athleteId,
        role: "user",
        content: payload.message
      },
      {
        conversation_id: resolvedConversationId,
        user_id: ctx.userId,
        athlete_id: ctx.athleteId,
        role: "assistant",
        content: result.answer
      }
    ]);

    if (insertMessagesError) {
      return NextResponse.json({ error: insertMessagesError.message }, { status: 500 });
    }

    await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", resolvedConversationId);

    logCoachAudit("info", "coach.chat.response_success", {
      ctx,
      route: "POST /api/coach/chat",
      success: true
    });

    return NextResponse.json({
      conversationId: resolvedConversationId,
      responseId: result.responseId,
      ...result.structured
    }, {
      headers: rateLimitHeaders(userRateLimit)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logCoachAudit("error", "coach.chat.response_failure", {
      ctx,
      route: "POST /api/coach/chat",
      success: false,
      reason: message
    });
    return NextResponse.json({ error: "Coach response unavailable right now." }, { status: 502 });
  }
}
