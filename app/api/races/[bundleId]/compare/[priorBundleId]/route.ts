import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getOrGenerateRaceComparison,
  loadCachedComparison
} from "@/lib/race-review/comparison";

type Params = { bundleId: string; priorBundleId: string };

export async function GET(_request: Request, context: { params: Promise<Params> }) {
  const { bundleId, priorBundleId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cached = await loadCachedComparison(supabase, user.id, bundleId, priorBundleId);
  if (!cached) {
    return NextResponse.json({ error: "Comparison not generated yet." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...cached });
}

export async function POST(_request: Request, context: { params: Promise<Params> }) {
  const { bundleId, priorBundleId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await getOrGenerateRaceComparison({
    supabase,
    userId: user.id,
    bundleId,
    priorBundleId
  });

  if (result.status === "skipped") {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    payload: result.payload,
    narrative: result.narrative,
    source: result.source
  });
}
