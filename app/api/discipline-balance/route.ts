import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  computeRollingDisciplineBalance,
  generateRebalancingRecommendations,
  persistBalanceSnapshot,
} from "@/lib/training/discipline-tradeoff";
import { getPrimaryRace } from "@/lib/training/race-profile";

/**
 * GET /api/discipline-balance — Return current snapshot + active recommendations.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Latest snapshot
  const { data: snapshot } = await supabase
    .from("discipline_balance_snapshots")
    .select("*")
    .eq("user_id", user.id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Active recommendations
  const { data: recs } = await supabase
    .from("rebalancing_recommendations")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("priority", { ascending: false })
    .limit(5);

  return NextResponse.json({ snapshot, recommendations: recs ?? [] });
}

/**
 * POST /api/discipline-balance — Compute fresh snapshot + recommendations.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const snapshot = await computeRollingDisciplineBalance(supabase, user.id);
    const recommendations = generateRebalancingRecommendations(snapshot);
    const primaryRace = await getPrimaryRace(supabase, user.id);

    const snapshotId = await persistBalanceSnapshot(
      supabase,
      user.id,
      snapshot,
      recommendations,
      primaryRace?.id ?? null
    );

    return NextResponse.json({ snapshotId, snapshot, recommendations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute balance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
