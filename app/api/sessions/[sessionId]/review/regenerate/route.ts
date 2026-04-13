import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { syncExtraActivityExecution, syncSessionExecutionFromActivityLink } from "@/lib/workouts/session-execution";
import { EXTRA_INTENT_OPTIONS } from "@/lib/workouts/infer-extra-intent";

const VALID_INTENT_VALUES = new Set(EXTRA_INTENT_OPTIONS.map((o) => o.value));

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const { sessionId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Handle extra (unplanned) activities accessed via the synthetic activity-${activityId} session ID
  const activityIdMatch = sessionId.match(/^activity-(.+)$/);
  if (activityIdMatch) {
    const activityId = activityIdMatch[1];

    // Parse optional intent override from request body
    let intentOverride: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.intentOverride === "string" && body.intentOverride) {
        if (!VALID_INTENT_VALUES.has(body.intentOverride)) {
          return NextResponse.json({ error: "Invalid intent category." }, { status: 400 });
        }
        intentOverride = body.intentOverride;
      }
    } catch {
      // No body or invalid JSON — proceed without override
    }

    try {
      const executionResult = await syncExtraActivityExecution({ supabase, userId: user.id, activityId, intentOverride });
      revalidatePath(`/sessions/${sessionId}`);
      revalidatePath(`/sessions/activity/${activityId}`);
      revalidatePath(`/sessions/activity-${activityId}`);
      revalidatePath("/dashboard");
      return NextResponse.json({ ok: true, narrativeSource: executionResult.narrativeSource });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not regenerate session review." },
        { status: 500 }
      );
    }
  }

  const { data: links, error: linkError } = await supabase
    .from("session_activity_links")
    .select("completed_activity_id,confirmation_status,created_at")
    .eq("planned_session_id", sessionId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  const confirmedLink = (links ?? []).find(
    (link: any) => link.completed_activity_id && (link.confirmation_status === "confirmed" || link.confirmation_status === null)
  );

  if (!confirmedLink?.completed_activity_id) {
    return NextResponse.json({ error: "No confirmed linked activity found for this session." }, { status: 409 });
  }

  try {
    const executionResult = await syncSessionExecutionFromActivityLink({
      supabase,
      userId: user.id,
      sessionId,
      activityId: confirmedLink.completed_activity_id
    });

    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath(`/sessions/activity-${confirmedLink.completed_activity_id}`);
    revalidatePath("/dashboard");

    return NextResponse.json({
      ok: true,
      narrativeSource: executionResult.narrativeSource
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not regenerate session review." },
      { status: 500 }
    );
  }
}
