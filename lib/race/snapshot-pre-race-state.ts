import type { SupabaseClient } from "@supabase/supabase-js";
import { getReadinessState } from "@/lib/training/fitness-model";
import { getFitnessOnDate } from "@/lib/training/fitness-on-date";
import { computeTaperCompliance } from "@/lib/race/taper-compliance";

export type SnapshotPreRaceStateArgs = {
  supabase: SupabaseClient;
  userId: string;
  bundleId: string;
  /** Local race date (YYYY-MM-DD). Pre-race snapshot is read AS OF this date. */
  raceDate: string;
};

export type SnapshotPreRaceStateResult =
  | { status: "noop"; reason: string }
  | { status: "captured" | "partial" | "unavailable"; bundleId: string };

/**
 * Idempotent: returns `{ status: 'noop' }` when the bundle's snapshot status is
 * already anything other than 'pending'. Reads `athlete_fitness` for the most
 * recent row at or before `raceDate`, derives readiness state via
 * `getReadinessState`, computes taper compliance from the prior 14 days, and
 * writes the snapshot row in a single update.
 *
 * Status transitions:
 *   pending → captured   — fitness row found AND taper compliance non-null
 *   pending → partial    — fitness row found, taper compliance null
 *   pending → unavailable — no fitness row on or before raceDate
 */
export async function snapshotPreRaceState(
  args: SnapshotPreRaceStateArgs
): Promise<SnapshotPreRaceStateResult> {
  const { supabase, userId, bundleId, raceDate } = args;

  const { data: bundleRow, error: bundleError } = await supabase
    .from("race_bundles")
    .select("id, pre_race_snapshot_status")
    .eq("id", bundleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (bundleError || !bundleRow) {
    return { status: "noop", reason: `bundle_not_found:${bundleError?.message ?? ""}` };
  }
  if (bundleRow.pre_race_snapshot_status && bundleRow.pre_race_snapshot_status !== "pending") {
    return { status: "noop", reason: `already_${bundleRow.pre_race_snapshot_status}` };
  }

  const fitness = await getFitnessOnDate(supabase, userId, raceDate, "total");

  if (!fitness) {
    const { error: updateError } = await supabase
      .from("race_bundles")
      .update({
        pre_race_snapshot_status: "unavailable",
        pre_race_snapshot_at: new Date().toISOString()
      })
      .eq("id", bundleId)
      .eq("user_id", userId);

    if (updateError) {
      return { status: "noop", reason: `update_failed:${updateError.message}` };
    }
    return { status: "unavailable", bundleId };
  }

  const taper = await computeTaperCompliance(supabase, userId, raceDate);
  const tsbState = getReadinessState(fitness.tsb);
  const finalStatus: "captured" | "partial" = taper.score === null ? "partial" : "captured";

  const { error: updateError } = await supabase
    .from("race_bundles")
    .update({
      pre_race_ctl: round2(fitness.ctl),
      pre_race_atl: round2(fitness.atl),
      pre_race_tsb: round2(fitness.tsb),
      pre_race_tsb_state: tsbState,
      pre_race_ramp_rate: fitness.rampRate != null ? round2(fitness.rampRate) : null,
      pre_race_snapshot_at: new Date().toISOString(),
      pre_race_snapshot_status: finalStatus,
      taper_compliance_score: taper.score,
      taper_compliance_summary: taper.summary
    })
    .eq("id", bundleId)
    .eq("user_id", userId);

  if (updateError) {
    return { status: "noop", reason: `update_failed:${updateError.message}` };
  }

  return { status: finalStatus, bundleId };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
