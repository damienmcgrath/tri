import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { generateRaceReview } from "@/lib/race-review";

export async function POST(request: Request, context: { params: Promise<{ bundleId: string }> }) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const { bundleId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: bundleRow } = await supabase
    .from("race_bundles")
    .select("id")
    .eq("id", bundleId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!bundleRow) {
    return NextResponse.json({ error: "Race bundle not found." }, { status: 404 });
  }

  try {
    const result = await generateRaceReview({ supabase, userId: user.id, bundleId });

    if (result.status === "skipped") {
      return NextResponse.json({ error: `Could not regenerate race review: ${result.reason}` }, { status: 409 });
    }

    if (result.plannedSessionId) {
      revalidatePath(`/sessions/${result.plannedSessionId}`);
    }
    revalidatePath("/dashboard");

    return NextResponse.json({ ok: true, source: result.source });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not regenerate race review." },
      { status: 500 }
    );
  }
}
