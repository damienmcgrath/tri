/**
 * Tail-of-pipeline persistence helpers for the race-review generator.
 *
 * After the orchestrator (`generateRaceReview` in `lib/race-review.ts`)
 * persists the layered narrative, two follow-up writes happen:
 *
 * 1. `persistTrainingToRaceLinks` — Phase 3.2: links the recent training
 *    sessions that mirrored race-day capability and writes them onto the
 *    race_reviews row.
 * 2. `persistPreRaceRetrospective` — Phase 3.3: computes the CTL/ATL/TSB
 *    trajectory + taper read-out for the lead-up and writes that onto
 *    the same row.
 *
 * Extracted from race-review.ts so the orchestrator file doesn't carry
 * the projection helpers and the row-update glue.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RaceBundleData, RaceSegmentData } from "@/lib/race-review";
import {
  buildTrainingToRaceLinks,
  type RaceLegSummary as TrainingLinksRaceLegSummary,
  type TrainingLinksDiscipline
} from "@/lib/race-review/training-links";
import { buildPreRaceRetrospective } from "@/lib/race-review/retrospective";

export async function persistTrainingToRaceLinks(args: {
  supabase: SupabaseClient;
  userId: string;
  bundleId: string;
  segments: RaceSegmentData[];
  raceDateIso: string;
}): Promise<void> {
  const legs = buildTrainingLinksLegs(args.segments);
  if (legs.length === 0) return;
  const result = await buildTrainingToRaceLinks({
    supabase: args.supabase,
    userId: args.userId,
    bundleId: args.bundleId,
    raceDateIso: args.raceDateIso,
    legs
  });
  if (result.status !== "ok") return;
  const { error } = await args.supabase
    .from("race_reviews")
    .update({ training_to_race_links: result.payload })
    .eq("user_id", args.userId)
    .eq("race_bundle_id", args.bundleId);
  if (error) {
    console.warn("[race-review] training-links persist failed", {
      bundleId: args.bundleId,
      error: error.message
    });
  }
}

/**
 * Project the loaded race segments into the RaceLegSummary input shape
 * required by buildTrainingToRaceLinks. Segments that aren't swim/bike/run
 * (transitions) are skipped.
 */
function buildTrainingLinksLegs(segments: RaceSegmentData[]): TrainingLinksRaceLegSummary[] {
  const out: TrainingLinksRaceLegSummary[] = [];
  for (const seg of segments) {
    if (seg.role !== "swim" && seg.role !== "bike" && seg.role !== "run") continue;
    out.push(buildTrainingLinksLegFromSegment(seg));
  }
  return out;
}

/**
 * Phase 3.3 tail call. Computes the pre-race retrospective from the
 * existing snapshot columns + athlete_fitness time series and writes it
 * to race_reviews.
 */
export async function persistPreRaceRetrospective(args: {
  supabase: SupabaseClient;
  userId: string;
  bundleId: string;
  bundle: RaceBundleData;
  raceDateIso: string;
}): Promise<void> {
  const result = await buildPreRaceRetrospective({
    supabase: args.supabase,
    userId: args.userId,
    bundleId: args.bundleId,
    raceDateIso: args.raceDateIso,
    bundle: {
      pre_race_ctl: args.bundle.preRaceCtl,
      pre_race_atl: args.bundle.preRaceAtl,
      pre_race_tsb: args.bundle.preRaceTsb,
      taper_compliance_score: args.bundle.taperComplianceScore,
      taper_compliance_summary: args.bundle.taperComplianceSummary
    }
  });
  if (result.status !== "ok") return;
  const { error } = await args.supabase
    .from("race_reviews")
    .update({ pre_race_retrospective: result.payload })
    .eq("user_id", args.userId)
    .eq("race_bundle_id", args.bundleId);
  if (error) {
    console.warn("[race-review] retrospective persist failed", {
      bundleId: args.bundleId,
      error: error.message
    });
  }
}

function buildTrainingLinksLegFromSegment(seg: RaceSegmentData): TrainingLinksRaceLegSummary {
  const role = seg.role as TrainingLinksDiscipline;
  let avgPace: number | null = null;
  let normalizedPower: number | null = null;
  if (role === "swim") {
    if (seg.distanceM && seg.distanceM > 0 && seg.durationSec > 0) {
      avgPace = Math.round(seg.durationSec / (seg.distanceM / 100));
    }
  } else if (role === "run") {
    if (seg.distanceM && seg.distanceM > 0 && seg.durationSec > 0) {
      avgPace = Math.round(seg.durationSec / (seg.distanceM / 1000));
    }
  } else if (role === "bike") {
    const m = seg.metricsV2;
    if (m && typeof m === "object") {
      const np = (m as Record<string, unknown>).normalizedPower;
      if (typeof np === "number" && np > 0) normalizedPower = np;
      if (normalizedPower == null) {
        const halves = (m as Record<string, unknown>).halves;
        if (halves && typeof halves === "object") {
          const hh = halves as Record<string, unknown>;
          const f = typeof hh.firstHalfAvgPower === "number" ? hh.firstHalfAvgPower : null;
          const l = typeof hh.lastHalfAvgPower === "number" ? hh.lastHalfAvgPower : null;
          if (f != null && l != null) normalizedPower = Math.round((f + l) / 2);
        }
      }
    }
    if (normalizedPower == null && seg.avgPower != null) normalizedPower = seg.avgPower;
  }
  return {
    role,
    durationSec: seg.durationSec,
    avgPower: seg.avgPower,
    avgHr: seg.avgHr,
    avgPace,
    normalizedPower
  };
}
