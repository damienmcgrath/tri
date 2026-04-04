import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin, getClientIp } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { backfillPendingSessionExecutions } from "@/lib/workouts/session-execution";

function isMissingSessionReviewSchema(message: string) {
  return /schema cache|42703|column .* does not exist|sessions\.(session_name|discipline|subtype|workout_type|intent_category|session_role|source_metadata|execution_result)/i.test(
    message
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("review-backfill-ip", ip, { maxRequests: 10, windowMs: 60_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let runAll = false;
  try {
    const body = (await request.json()) as { all?: boolean };
    runAll = body.all === true;
  } catch {
    runAll = false;
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await backfillPendingSessionExecutions({
      supabase,
      userId: user.id,
      limit: runAll ? undefined : 20,
      force: runAll
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not backfill session reviews.";
    if (isMissingSessionReviewSchema(message)) {
      return NextResponse.json(
        { error: "Session review columns are missing in the database. Run the latest Supabase migrations, then retry review backfill." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
