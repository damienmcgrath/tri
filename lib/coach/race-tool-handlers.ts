/**
 * Handlers for the race-scoped coach tools (Phase 2 — Interrogation Layer).
 *
 * These tools only make sense when the conversation is scoped to a race
 * bundle. Each handler accepts the conversation's bundleId out-of-band
 * (the model never supplies it) so the model cannot accidentally drill
 * into a different race.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachAuthContext } from "@/lib/coach/types";
import { loadRaceBundleSummary, type RaceBundleSummary } from "@/lib/race/bundle-helpers";
import {
  coachToolSchemas,
  type getRaceSegmentMetricsArgsSchema,
  type getPriorRacesForComparisonArgsSchema,
  type getBestComparableTrainingForSegmentArgsSchema
} from "@/lib/coach/tools";
import { getAthleteContextSnapshot } from "@/lib/athlete-context";
import type { z } from "zod";

export type RaceToolDeps = {
  supabase: SupabaseClient;
  ctx: CoachAuthContext;
  /** The conversation's race scope. Required for every tool here. */
  bundleId: string;
};

const NO_SCOPE_ERROR = "Race scope is required for this tool. Open the coach from a race review page.";

function ensureScope(deps: RaceToolDeps) {
  if (!deps.bundleId) {
    throw new Error(NO_SCOPE_ERROR);
  }
}

async function loadSummaryOrThrow(deps: RaceToolDeps): Promise<RaceBundleSummary> {
  ensureScope(deps);
  const summary = await loadRaceBundleSummary(deps.supabase, deps.ctx.userId, deps.bundleId);
  if (!summary) throw new Error("Race not found.");
  return summary;
}

export async function getRaceObject(deps: RaceToolDeps) {
  const summary = await loadSummaryOrThrow(deps);
  return summary;
}

export async function getRaceSegmentMetrics(
  args: z.infer<typeof getRaceSegmentMetricsArgsSchema>,
  deps: RaceToolDeps
) {
  ensureScope(deps);
  const parsed = coachToolSchemas.get_race_segment_metrics.parse(args);

  // Find the segment activity for the requested role.
  const { data: segmentRow } = await deps.supabase
    .from("completed_activities")
    .select(
      "id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,race_segment_role,race_segment_index,metrics_v2,moving_duration_sec,elapsed_duration_sec,avg_pace_per_100m_sec"
    )
    .eq("user_id", deps.ctx.userId)
    .eq("race_bundle_id", deps.bundleId)
    .eq("race_segment_role", parsed.role)
    .maybeSingle();

  if (!segmentRow) {
    return { role: parsed.role, found: false } as const;
  }

  return {
    role: parsed.role,
    found: true,
    activityId: segmentRow.id,
    sport: segmentRow.sport_type,
    startTimeUtc: segmentRow.start_time_utc,
    durationSec: Number(segmentRow.duration_sec ?? 0),
    distanceM: segmentRow.distance_m != null ? Number(segmentRow.distance_m) : null,
    avgHr: segmentRow.avg_hr != null ? Number(segmentRow.avg_hr) : null,
    avgPower: segmentRow.avg_power != null ? Number(segmentRow.avg_power) : null,
    movingDurationSec: segmentRow.moving_duration_sec != null ? Number(segmentRow.moving_duration_sec) : null,
    elapsedDurationSec: segmentRow.elapsed_duration_sec != null ? Number(segmentRow.elapsed_duration_sec) : null,
    avgPacePer100mSec: segmentRow.avg_pace_per_100m_sec != null ? Number(segmentRow.avg_pace_per_100m_sec) : null,
    metricsV2: segmentRow.metrics_v2 ?? null
  };
}

export async function getPriorRacesForComparison(
  args: z.infer<typeof getPriorRacesForComparisonArgsSchema>,
  deps: RaceToolDeps
) {
  ensureScope(deps);
  const parsed = coachToolSchemas.get_prior_races_for_comparison.parse(args);

  // Resolve this race's distance type so we can filter when sameDistanceOnly.
  const summary = await loadSummaryOrThrow(deps);
  const thisDistance = summary.raceProfile?.distance_type ?? null;
  const thisDate = summary.bundle.started_at;

  // Pull recent prior bundles for this user.
  const { data: bundleRows } = await deps.supabase
    .from("race_bundles")
    .select("id,started_at,total_duration_sec,goal_time_sec,race_profile_id")
    .eq("user_id", deps.ctx.userId)
    .neq("id", deps.bundleId)
    .lt("started_at", thisDate)
    .order("started_at", { ascending: false })
    .limit(parsed.limit * 3);

  const bundles = (bundleRows ?? []) as Array<{
    id: string;
    started_at: string;
    total_duration_sec: number;
    goal_time_sec: number | null;
    race_profile_id: string | null;
  }>;
  if (bundles.length === 0) return { priorRaces: [] as const };

  // Hydrate race profile names + distance types in one shot.
  const profileIds = Array.from(
    new Set(bundles.map((b) => b.race_profile_id).filter((id): id is string => Boolean(id)))
  );
  const profileMap = new Map<string, { name: string | null; distanceType: string | null }>();
  if (profileIds.length > 0) {
    const { data: profiles } = await deps.supabase
      .from("race_profiles")
      .select("id,name,distance_type")
      .eq("user_id", deps.ctx.userId)
      .in("id", profileIds);
    for (const p of profiles ?? []) {
      profileMap.set((p as { id: string }).id, {
        name: ((p as { name: string | null }).name) ?? null,
        distanceType: ((p as { distance_type: string | null }).distance_type) ?? null
      });
    }
  }

  // Pull verdicts + leg status for selected bundles.
  const bundleIds = bundles.map((b) => b.id);
  const { data: reviews } = await deps.supabase
    .from("race_reviews")
    .select("race_bundle_id,verdict,leg_status")
    .eq("user_id", deps.ctx.userId)
    .in("race_bundle_id", bundleIds);
  const reviewMap = new Map<string, { verdict: unknown; legStatus: unknown }>();
  for (const r of reviews ?? []) {
    const row = r as { race_bundle_id: string; verdict: unknown; leg_status: unknown };
    reviewMap.set(row.race_bundle_id, { verdict: row.verdict, legStatus: row.leg_status });
  }

  const priorRaces = bundles
    .map((b) => {
      const profile = b.race_profile_id ? profileMap.get(b.race_profile_id) : null;
      const distance = profile?.distanceType ?? null;
      if (parsed.sameDistanceOnly && thisDistance && distance !== thisDistance) return null;
      const review = reviewMap.get(b.id);
      const finishSec = Number(b.total_duration_sec ?? 0);
      const goalSec = b.goal_time_sec != null ? Number(b.goal_time_sec) : null;
      return {
        bundleId: b.id,
        date: b.started_at.slice(0, 10),
        name: profile?.name ?? null,
        distanceType: distance,
        finishSec,
        goalSec,
        goalDeltaSec: goalSec != null ? finishSec - goalSec : null,
        verdict: review?.verdict ?? null,
        legStatus: review?.legStatus ?? null
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .slice(0, parsed.limit);

  return { priorRaces };
}

export async function getBestComparableTrainingForSegment(
  args: z.infer<typeof getBestComparableTrainingForSegmentArgsSchema>,
  deps: RaceToolDeps
) {
  ensureScope(deps);
  const parsed = coachToolSchemas.get_best_comparable_training_for_segment.parse(args);

  const summary = await loadSummaryOrThrow(deps);
  const diagnostics = Array.isArray(summary.review?.segment_diagnostics)
    ? (summary.review.segment_diagnostics as unknown[])
    : [];
  const match = diagnostics.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as Record<string, unknown>).discipline === parsed.role;
  }) as Record<string, unknown> | undefined;
  const refs = (match?.referenceFrames as Record<string, unknown> | undefined) ?? {};
  const vsBest = refs.vsBestComparableTraining as Record<string, unknown> | undefined;

  if (!vsBest || typeof vsBest.sessionId !== "string") {
    return { role: parsed.role, found: false } as const;
  }

  // Pull the activity row so the model can do IF/pace math.
  const { data: activity } = await deps.supabase
    .from("completed_activities")
    .select(
      "id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,moving_duration_sec,avg_pace_per_100m_sec,metrics_v2"
    )
    .eq("user_id", deps.ctx.userId)
    .eq("id", vsBest.sessionId)
    .maybeSingle();

  return {
    role: parsed.role,
    found: true,
    sessionId: vsBest.sessionId,
    sessionDate: typeof vsBest.sessionDate === "string" ? vsBest.sessionDate : null,
    sessionName: typeof vsBest.sessionName === "string" ? vsBest.sessionName : null,
    comparison: typeof vsBest.comparison === "string" ? vsBest.comparison : null,
    activity: activity
      ? {
          id: activity.id,
          sport: activity.sport_type,
          startTimeUtc: activity.start_time_utc,
          durationSec: Number(activity.duration_sec ?? 0),
          distanceM: activity.distance_m != null ? Number(activity.distance_m) : null,
          avgHr: activity.avg_hr != null ? Number(activity.avg_hr) : null,
          avgPower: activity.avg_power != null ? Number(activity.avg_power) : null,
          movingDurationSec: activity.moving_duration_sec != null ? Number(activity.moving_duration_sec) : null,
          avgPacePer100mSec: activity.avg_pace_per_100m_sec != null ? Number(activity.avg_pace_per_100m_sec) : null,
          metricsV2: activity.metrics_v2 ?? null
        }
      : null
  };
}

export async function getAthleteThresholds(deps: RaceToolDeps) {
  const snapshot = await getAthleteContextSnapshot(deps.supabase, deps.ctx.athleteId);

  return {
    ftp: snapshot.ftp ? { value: snapshot.ftp.value, source: snapshot.ftp.source, recordedAt: snapshot.ftp.recordedAt } : null,
    fitness: snapshot.fitness ?? null,
    declaredStrongest: snapshot.declared.strongestDisciplines,
    declaredLimiters: snapshot.declared.limiters.map((d) => d.value),
    priorityRace: snapshot.goals.priorityEventName ?? null,
    priorityRaceDate: snapshot.goals.priorityEventDate ?? null
  };
}
