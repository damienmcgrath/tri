import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadRaceBundleSummary } from "@/lib/race/bundle-helpers";

export async function GET(_request: Request, context: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await loadRaceBundleSummary(supabase, user.id, bundleId);
  if (!summary) {
    return NextResponse.json({ error: "Race bundle not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...summary });
}
