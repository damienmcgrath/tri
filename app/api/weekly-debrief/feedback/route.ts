import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { saveWeeklyDebriefFeedback, type WeeklyDebriefFeedbackInput } from "@/lib/weekly-debrief";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = (await request.json()) as WeeklyDebriefFeedbackInput;
    const artifact = await saveWeeklyDebriefFeedback({
      supabase,
      athleteId: user.id,
      input
    });
    return NextResponse.json({ ok: true, artifact });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save Weekly Debrief feedback." },
      { status: 400 }
    );
  }
}
