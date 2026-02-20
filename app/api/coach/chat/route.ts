import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildWorkoutSummary, CompletedSessionLite, PlannedSessionLite } from "@/lib/coach/workout-summary";

type ChatRequestBody = {
  message?: string;
  conversationId?: string;
};

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

function getDateDaysAgo(daysAgo: number) {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - daysAgo);
  return utc.toISOString().slice(0, 10);
}

function buildFallbackCoachResponse(input: { message: string; summary: ReturnType<typeof buildWorkoutSummary> }) {
  const intro = `You asked: "${input.message}".`;
  const overview = `In the recent window, you completed ${input.summary.completedMinutes} min out of ${input.summary.plannedMinutes} planned (${input.summary.completionPct}%).`;
  const focus =
    input.summary.dominantSport === "none"
      ? "There is not enough completed workout data to detect a dominant sport yet."
      : `Your biggest completed load is ${input.summary.dominantSport}.`;

  const recommendations = [
    "Prioritize 2-3 key sessions this week and protect them in your calendar.",
    "Keep one easy recovery day after your highest-load workout.",
    "If fatigue feels high, reduce duration by 15-20% before reducing frequency."
  ];

  return [intro, overview, focus, ...input.summary.insights, "", "Suggested next actions:", ...recommendations].join("\n");
}

async function getModelResponse(params: {
  message: string;
  summary: ReturnType<typeof buildWorkoutSummary>;
  history: ConversationMessageRow[];
  apiKey: string;
}) {
  const systemPrompt = `You are TriCoach AI, a concise triathlon coach.

Rules:
- Keep responses practical and actionable.
- Avoid medical diagnosis.
- Use supportive language.
- If the user asks for schedule changes, suggest changes as proposals, not automatic directives.`;

  const summaryContext = `Recent workload summary:
- Planned minutes: ${params.summary.plannedMinutes}
- Completed minutes: ${params.summary.completedMinutes}
- Completion: ${params.summary.completionPct}%
- Dominant sport: ${params.summary.dominantSport}
- Insights: ${params.summary.insights.join(" | ")}`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "system", content: summaryContext },
    ...params.history.map((item) => ({ role: item.role, content: item.content }))
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() ?? "I could not generate a response right now.";
}

async function getUserAndClient() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function GET(request: Request) {
  const { supabase, user } = await getUserAndClient();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");

  if (conversationId) {
    const { data, error } = await supabase
      .from("ai_messages")
      .select("role,content,created_at")
      .eq("user_id", user.id)
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
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: (data ?? []) as ConversationRow[] });
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequestBody;

  if (!body.message || body.message.trim().length < 3) {
    return NextResponse.json({ error: "Please enter a longer message." }, { status: 400 });
  }

  if (body.message.length > 2000) {
    return NextResponse.json({ error: "Please keep messages under 2000 characters." }, { status: 400 });
  }

  const { supabase, user } = await getUserAndClient();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sinceDate = getDateDaysAgo(14);
  const today = getDateDaysAgo(0);

  const { data: plannedData, error: plannedError } = await supabase
    .from("planned_sessions")
    .select("sport,duration")
    .gte("date", sinceDate)
    .lte("date", today)
    .order("date", { ascending: false });

  const { data: completedData, error: completedError } = await supabase
    .from("completed_sessions")
    .select("sport,metrics")
    .gte("date", sinceDate)
    .lte("date", today)
    .order("date", { ascending: false });

  if (plannedError || completedError) {
    return NextResponse.json(
      {
        error: plannedError?.message ?? completedError?.message ?? "Failed to load workout data."
      },
      { status: 500 }
    );
  }

  const summary = buildWorkoutSummary(
    (plannedData ?? []) as PlannedSessionLite[],
    (completedData ?? []) as CompletedSessionLite[]
  );

  let conversationId = body.conversationId;

  if (conversationId) {
    const { data: existingConversation, error: lookupError } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (lookupError || !existingConversation) {
      conversationId = undefined;
    }
  }

  if (!conversationId) {
    const title = body.message.trim().slice(0, 60);
    const { data: createdConversation, error: conversationError } = await supabase
      .from("ai_conversations")
      .insert({ user_id: user.id, title })
      .select("id")
      .single();

    if (conversationError || !createdConversation) {
      return NextResponse.json({ error: conversationError?.message ?? "Failed to create conversation." }, { status: 500 });
    }

    conversationId = createdConversation.id;
  }

  const userMessage = body.message.trim();

  const { data: recentMessages, error: historyError } = await supabase
    .from("ai_messages")
    .select("role,content,created_at")
    .eq("user_id", user.id)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }

  const orderedHistory = [...((recentMessages ?? []) as ConversationMessageRow[])].reverse();
  const apiKey = process.env.OPENAI_API_KEY;

  let answer = "";

  try {
    answer = apiKey
      ? await getModelResponse({ message: userMessage, summary, history: [...orderedHistory, { role: "user", content: userMessage, created_at: new Date().toISOString() }], apiKey })
      : buildFallbackCoachResponse({ message: userMessage, summary });
  } catch {
    answer = buildFallbackCoachResponse({ message: userMessage, summary });
  }

  const { error: insertMessagesError } = await supabase.from("ai_messages").insert([
    {
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: userMessage
    },
    {
      conversation_id: conversationId,
      user_id: user.id,
      role: "assistant",
      content: answer
    }
  ]);

  if (insertMessagesError) {
    return NextResponse.json({ error: insertMessagesError.message }, { status: 500 });
  }

  await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

  return NextResponse.json({ answer, summary, conversationId });
}
