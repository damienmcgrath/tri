import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/security/request";
import { backfillActivityMetrics } from "@/lib/workouts/activity-metrics-backfill";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
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
    const result = await backfillActivityMetrics({
      supabase,
      userId: user.id,
      limit: runAll ? undefined : 20,
      force: runAll
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not backfill activity metrics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
