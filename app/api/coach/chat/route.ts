import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildWorkoutSummary, CompletedSessionLite, PlannedSessionLite } from "@/lib/coach/workout-summary";

type ChatRequestBody = {
  message?: string;
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
  apiKey: string;
}) {
  const prompt = `You are TriCoach AI, a concise triathlon coach.

User message: ${params.message}

Recent workload summary:
- Planned minutes: ${params.summary.plannedMinutes}
- Completed minutes: ${params.summary.completedMinutes}
- Completion: ${params.summary.completionPct}%
- Dominant sport: ${params.summary.dominantSport}
- Insights: ${params.summary.insights.join(" | ")}

Reply with:
1) Brief assessment (2-3 sentences)
2) Workout analysis and summary
3) 3 practical recommendations for the next 7 days

Avoid medical diagnosis.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "You are a supportive endurance coach for amateur triathletes."
        },
        {
          role: "user",
          content: prompt
        }
      ]
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

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequestBody;

  if (!body.message || body.message.trim().length < 3) {
    return NextResponse.json({ error: "Please enter a longer message." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sinceDate = getDateDaysAgo(14);

  const { data: plannedData } = await supabase
    .from("planned_sessions")
    .select("sport,duration")
    .gte("date", sinceDate)
    .order("date", { ascending: false });

  const { data: completedData } = await supabase
    .from("completed_sessions")
    .select("sport,metrics")
    .gte("date", sinceDate)
    .order("date", { ascending: false });

  const summary = buildWorkoutSummary(
    (plannedData ?? []) as PlannedSessionLite[],
    (completedData ?? []) as CompletedSessionLite[]
  );

  const apiKey = process.env.OPENAI_API_KEY;

  try {
    const answer = apiKey
      ? await getModelResponse({ message: body.message.trim(), summary, apiKey })
      : buildFallbackCoachResponse({ message: body.message.trim(), summary });

    return NextResponse.json({ answer, summary });
  } catch {
    const answer = buildFallbackCoachResponse({ message: body.message.trim(), summary });
    return NextResponse.json({ answer, summary });
  }
}
