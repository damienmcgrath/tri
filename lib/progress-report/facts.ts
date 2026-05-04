import type { SupabaseClient } from "@supabase/supabase-js";
import {
  progressReportFactsSchema,
  type ProgressReportFacts,
  type ProgressReportPaceAtHr
} from "./types";
import {
  formatBlockRange,
  formatShortDate,
  type ActivityRow,
  type FitnessRow,
  type SessionRow
} from "./facts-helpers";
import {
  buildDurabilityBlock,
  buildFitnessTrajectory,
  buildPaceAtHr,
  buildPeakPerformances,
  buildVolumeBlock,
  inferDurabilityDirection
} from "./facts-categories";
import { buildConfidenceNote, buildFactualBullets } from "./facts-synthesis";

// ---------------------------------------------------------------------------
// Block boundaries
// ---------------------------------------------------------------------------

/** Block is 28 days inclusive, ending on `blockEnd`. */
export function computeBlockBoundaries(blockEnd: string): {
  blockStart: string;
  blockEnd: string;
  priorBlockStart: string;
  priorBlockEnd: string;
} {
  const endMs = new Date(`${blockEnd}T00:00:00.000Z`).getTime();
  const blockStartMs = endMs - 27 * 86400000;
  const priorEndMs = blockStartMs - 86400000;
  const priorStartMs = priorEndMs - 27 * 86400000;
  return {
    blockStart: new Date(blockStartMs).toISOString().slice(0, 10),
    blockEnd,
    priorBlockStart: new Date(priorStartMs).toISOString().slice(0, 10),
    priorBlockEnd: new Date(priorEndMs).toISOString().slice(0, 10)
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

type BlockBoundaries = {
  blockStart: string;
  blockEnd: string;
  priorBlockStart: string;
  priorBlockEnd: string;
};

async function loadBlockBoundariesFromIds(
  supabase: SupabaseClient,
  blockId: string,
  priorBlockId?: string | null
): Promise<BlockBoundaries | null> {
  const { data: block, error } = await supabase
    .from("training_blocks")
    .select("id,start_date,end_date,plan_id,sort_order")
    .eq("id", blockId)
    .maybeSingle();
  if (error || !block) return null;

  let prior: { start_date: string; end_date: string } | null = null;
  if (priorBlockId) {
    const { data: priorRow } = await supabase
      .from("training_blocks")
      .select("start_date,end_date")
      .eq("id", priorBlockId)
      .maybeSingle();
    prior = (priorRow as { start_date: string; end_date: string } | null) ?? null;
  } else if (block.plan_id != null && block.sort_order != null) {
    const { data: priorRow } = await supabase
      .from("training_blocks")
      .select("start_date,end_date")
      .eq("plan_id", block.plan_id)
      .lt("sort_order", block.sort_order)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    prior = (priorRow as { start_date: string; end_date: string } | null) ?? null;
  }

  const fallback = computeBlockBoundaries(block.end_date);
  return {
    blockStart: block.start_date,
    blockEnd: block.end_date,
    priorBlockStart: prior?.start_date ?? fallback.priorBlockStart,
    priorBlockEnd: prior?.end_date ?? fallback.priorBlockEnd,
  };
}

export async function buildProgressReportFactsForBlock(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockId: string;
  priorBlockId?: string | null;
}): Promise<ProgressReportFacts> {
  const bounds = await loadBlockBoundariesFromIds(args.supabase, args.blockId, args.priorBlockId);
  if (!bounds) {
    throw new Error(`progress-report: block ${args.blockId} not found`);
  }
  return buildFactsForBounds(args.supabase, args.athleteId, bounds);
}

export async function buildProgressReportFacts(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockEnd: string;
}): Promise<ProgressReportFacts> {
  const bounds = computeBlockBoundaries(args.blockEnd);
  return buildFactsForBounds(args.supabase, args.athleteId, bounds);
}

async function buildFactsForBounds(
  supabase: SupabaseClient,
  athleteId: string,
  bounds: BlockBoundaries
): Promise<ProgressReportFacts> {
  const [currentActivitiesRes, priorActivitiesRes, fitnessRes, sessionsRes] =
    await Promise.all([
      supabase
        .from("completed_activities")
        .select(
          "id,user_id,sport_type,start_time_utc,duration_sec,moving_duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,metrics_v2"
        )
        .eq("user_id", athleteId)
        .gte("start_time_utc", `${bounds.blockStart}T00:00:00.000Z`)
        .lte("start_time_utc", `${bounds.blockEnd}T23:59:59.999Z`)
        .order("start_time_utc", { ascending: true }),
      supabase
        .from("completed_activities")
        .select(
          "id,user_id,sport_type,start_time_utc,duration_sec,moving_duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,metrics_v2"
        )
        .eq("user_id", athleteId)
        .gte("start_time_utc", `${bounds.priorBlockStart}T00:00:00.000Z`)
        .lte("start_time_utc", `${bounds.priorBlockEnd}T23:59:59.999Z`)
        .order("start_time_utc", { ascending: true }),
      supabase
        .from("athlete_fitness")
        .select("date,sport,ctl,atl,tsb,ramp_rate")
        .eq("user_id", athleteId)
        .in("sport", ["run", "bike", "swim", "total"])
        .gte("date", bounds.priorBlockStart)
        .lte("date", bounds.blockEnd)
        .order("date", { ascending: true }),
      supabase
        .from("sessions")
        .select("id,date,sport,duration_minutes,status,is_key,session_role")
        .eq("user_id", athleteId)
        .gte("date", bounds.priorBlockStart)
        .lte("date", bounds.blockEnd)
    ]);

  if (currentActivitiesRes.error) {
    throw new Error(
      `progress-report current activities: ${currentActivitiesRes.error.message}`
    );
  }
  if (priorActivitiesRes.error) {
    throw new Error(
      `progress-report prior activities: ${priorActivitiesRes.error.message}`
    );
  }
  if (fitnessRes.error) {
    throw new Error(`progress-report athlete_fitness: ${fitnessRes.error.message}`);
  }
  if (sessionsRes.error) {
    throw new Error(`progress-report sessions: ${sessionsRes.error.message}`);
  }

  const currentActivities = (currentActivitiesRes.data ?? []) as ActivityRow[];
  const priorActivities = (priorActivitiesRes.data ?? []) as ActivityRow[];
  const fitness = (fitnessRes.data ?? []) as FitnessRow[];
  const allSessions = (sessionsRes.data ?? []) as SessionRow[];

  const currentSessions = allSessions.filter(
    (s) => s.date >= bounds.blockStart && s.date <= bounds.blockEnd
  );
  const priorSessions = allSessions.filter(
    (s) => s.date >= bounds.priorBlockStart && s.date <= bounds.priorBlockEnd
  );

  const currentVolume = buildVolumeBlock(currentActivities, currentSessions);
  const priorVolume = buildVolumeBlock(priorActivities, priorSessions);

  const fitnessTrajectory = buildFitnessTrajectory(
    bounds.blockStart,
    bounds.blockEnd,
    bounds.priorBlockEnd,
    fitness
  );

  const paceAtHrByDiscipline: ProgressReportPaceAtHr[] = [];
  for (const sport of ["run", "bike", "swim"] as const) {
    const row = buildPaceAtHr(sport, currentActivities, priorActivities);
    if (row) paceAtHrByDiscipline.push(row);
  }

  const durabilityCurrent = buildDurabilityBlock(currentActivities);
  const durabilityPrior = buildDurabilityBlock(priorActivities);
  const durabilityDirection = inferDurabilityDirection(durabilityCurrent, durabilityPrior);
  const durabilitySummary =
    durabilityDirection === "insufficient"
      ? `Too few ≥45-min endurance sessions with split data to read durability (${durabilityCurrent.decouplingSamples} vs ${durabilityPrior.decouplingSamples}).`
      : `Decoupling avg ${durabilityCurrent.avgDecouplingPct ?? "?"}% vs prior ${durabilityPrior.avgDecouplingPct ?? "?"}% (${durabilityCurrent.decouplingSamples} vs ${durabilityPrior.decouplingSamples} samples) — ${durabilityDirection}.`;

  const peaks = buildPeakPerformances(currentActivities, priorActivities);

  const factualBullets = buildFactualBullets({
    volumeDeltaMinutes: currentVolume.totalMinutes - priorVolume.totalMinutes,
    volumeDeltaSessions: currentVolume.totalSessions - priorVolume.totalSessions,
    fitness: fitnessTrajectory,
    paceAtHr: paceAtHrByDiscipline,
    peaks
  });

  const confidenceNote = buildConfidenceNote({
    currentActivitiesCount: currentActivities.length,
    priorActivitiesCount: priorActivities.length,
    fitnessPoints: fitnessTrajectory,
    paceAtHr: paceAtHrByDiscipline
  });

  const raw = {
    blockStart: bounds.blockStart,
    blockEnd: bounds.blockEnd,
    priorBlockStart: bounds.priorBlockStart,
    priorBlockEnd: bounds.priorBlockEnd,
    blockLabel: `Block ending ${formatShortDate(bounds.blockEnd)}`,
    blockRange: formatBlockRange(bounds.blockStart, bounds.blockEnd),
    priorBlockRange: formatBlockRange(bounds.priorBlockStart, bounds.priorBlockEnd),
    volume: {
      current: currentVolume,
      prior: priorVolume,
      deltaMinutes: currentVolume.totalMinutes - priorVolume.totalMinutes,
      deltaSessions: currentVolume.totalSessions - priorVolume.totalSessions
    },
    fitnessTrajectory,
    paceAtHrByDiscipline,
    durability: {
      current: durabilityCurrent,
      prior: durabilityPrior,
      direction: durabilityDirection,
      summary: durabilitySummary
    },
    peakPerformances: peaks,
    factualBullets:
      factualBullets.length >= 2
        ? factualBullets
        : [
            ...factualBullets,
            "Sample size too small for block-over-block comparison.",
            "Upload more activities to unlock trend detection."
          ].slice(0, 6),
    confidenceNote,
    narrativeSource: "legacy_unknown" as const
  };

  return progressReportFactsSchema.parse(raw);
}
