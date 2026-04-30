import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveCoachAuthContext } from "@/lib/coach/auth";
import { runCoachResponseFlow, buildServiceFallback, type ConversationMessageRow } from "@/lib/coach/chat-flow";
import { coachChatRequestSchema } from "@/lib/coach/types";
import { getCoachModel } from "@/lib/openai";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";
import { logCoachAudit } from "@/lib/coach/audit";
import { detectPromptInjection } from "@/lib/security/prompt-guard";

type ConversationRow = {
  id: string;
  title: string;
  updated_at: string;
  last_response_id: string | null;
};

function sseEvent(event: string, data: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const conversationMutationSchema = z.object({
  conversationId: z.string().uuid(),
  title: z.string().trim().min(1).max(80).optional()
});

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
      .select("role,content,created_at,citations")
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
  const ipRateLimit = await checkRateLimit("chat-ip", ip, { maxRequests: 40, windowMs: 60_000 });

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

  const injection = detectPromptInjection(payload.message);
  if (injection.suspicious) {
    logCoachAudit("warn", "coach.chat.prompt_injection_detected", {
      reason: `Matched pattern: ${injection.matchedPattern}`,
    });
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

  const userRateLimit = await checkRateLimit("chat-user", ctx.userId, { maxRequests: 20, windowMs: 60_000 });

  if (!userRateLimit.allowed) {
    return NextResponse.json({ error: "Chat limit reached. Please wait a minute and retry." }, {
      status: 429,
      headers: rateLimitHeaders(userRateLimit)
    });
  }

  let conversationId = payload.conversationId;
  let conversationLastResponseId: string | undefined;
  let conversationRaceBundleId: string | undefined;

  if (conversationId) {
    if (!z.string().uuid().safeParse(conversationId).success) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }
    const { data: existingConversation } = await supabase
      .from("ai_conversations")
      .select("id,last_response_id,race_bundle_id")
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
    conversationRaceBundleId = (existingConversation.race_bundle_id as string | null) ?? undefined;

    // Reject mid-conversation scope changes. The scope is a property of the
    // conversation, not the request — it determines which system prompt and
    // tools the model sees.
    if (payload.raceBundleId && payload.raceBundleId !== conversationRaceBundleId) {
      return NextResponse.json(
        { error: "Cannot change race scope on an existing conversation." },
        { status: 400 }
      );
    }
  }

  if (!conversationId) {
    // Validate the requested race scope belongs to this user before creating
    // the conversation row. Without this an unauthorised UUID would silently
    // get persisted (FK passes, RLS doesn't apply to FK targets).
    if (payload.raceBundleId) {
      const { data: bundleRow } = await supabase
        .from("race_bundles")
        .select("id")
        .eq("id", payload.raceBundleId)
        .eq("user_id", ctx.userId)
        .maybeSingle();

      if (!bundleRow) {
        logCoachAudit("warn", "coach.chat.invalid_race_scope", {
          ctx,
          route: "POST /api/coach/chat",
          success: false,
          reason: "Race bundle not owned by athlete"
        });
        return NextResponse.json({ error: "Race not found." }, { status: 404 });
      }
    }

    const { data: createdConversation, error: conversationError } = await supabase
      .from("ai_conversations")
      .insert({
        user_id: ctx.userId,
        athlete_id: ctx.athleteId,
        title: payload.message.slice(0, 60),
        race_bundle_id: payload.raceBundleId ?? null
      })
      .select("id,last_response_id,race_bundle_id")
      .single();

    if (conversationError || !createdConversation) {
      return NextResponse.json({ error: conversationError?.message ?? "Failed to create conversation." }, { status: 500 });
    }

    conversationId = createdConversation.id;
    conversationLastResponseId = createdConversation.last_response_id ?? undefined;
    conversationRaceBundleId = (createdConversation.race_bundle_id as string | null) ?? undefined;
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
            raceBundleId: conversationRaceBundleId,
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
            model: getCoachModel(),
            citations: result.structured?.citations ?? []
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
