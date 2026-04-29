import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { snapshotPreRaceState } from "@/lib/race/snapshot-pre-race-state";

/**
 * Dev-only: resets `pre_race_snapshot_status = 'pending'` and re-runs the
 * snapshot. Useful when fitness backfill changes after a race has already
 * been ingested. Disabled in production.
 */
export async function POST(request: Request, context: { params: Promise<{ bundleId: string }> }) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production." }, { status: 404 });
  }
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
    .select("id, started_at")
    .eq("id", bundleId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!bundleRow) {
    return NextResponse.json({ error: "Race bundle not found." }, { status: 404 });
  }

  await supabase
    .from("race_bundles")
    .update({
      pre_race_snapshot_status: "pending",
      pre_race_ctl: null,
      pre_race_atl: null,
      pre_race_tsb: null,
      pre_race_tsb_state: null,
      pre_race_ramp_rate: null,
      pre_race_snapshot_at: null,
      taper_compliance_score: null,
      taper_compliance_summary: null
    })
    .eq("id", bundleId)
    .eq("user_id", user.id);

  const raceDate = (bundleRow.started_at as string).slice(0, 10);
  const result = await snapshotPreRaceState({ supabase, userId: user.id, bundleId, raceDate });

  revalidatePath(`/races/${bundleId}`);
  return NextResponse.json({ ok: true, result });
}
