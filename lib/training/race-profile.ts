/**
 * Race profile data access and ideal distribution computation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { RACE_TYPE_DISTRIBUTIONS } from "./scoring-constants";

// ─── Types ──────────────────────────────────────────────────────────────────

export type RaceProfile = {
  id: string;
  userId: string;
  name: string;
  date: string;
  distanceType: "sprint" | "olympic" | "70.3" | "ironman" | "custom";
  priority: "A" | "B" | "C";
  courseProfile: Record<string, unknown>;
  idealDisciplineDistribution: { swim: number; bike: number; run: number; strength?: number } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Season = {
  id: string;
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  primaryGoal: string | null;
  secondaryGoals: string[];
  status: "planning" | "active" | "completed";
};

export type TrainingBlock = {
  id: string;
  seasonId: string | null;
  planId: string | null;
  userId: string;
  name: string;
  blockType: "Base" | "Build" | "Peak" | "Taper" | "Race" | "Recovery" | "Transition";
  startDate: string;
  endDate: string;
  targetRaceId: string | null;
  emphasis: Record<string, unknown>;
  notes: string | null;
  sortOrder: number;
};

// ─── Data access ──────────────────────────────────────────────────────────

export async function getRaceProfiles(supabase: SupabaseClient, userId: string): Promise<RaceProfile[]> {
  const { data, error } = await supabase
    .from("race_profiles")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map(mapRaceProfileRow);
}

export async function getPrimaryRace(supabase: SupabaseClient, userId: string): Promise<RaceProfile | null> {
  const { data } = await supabase
    .from("race_profiles")
    .select("*")
    .eq("user_id", userId)
    .eq("priority", "A")
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ? mapRaceProfileRow(data) : null;
}

/**
 * Get the training block that covers a specific date.
 * Falls back to null if no block covers the date.
 */
export async function getBlockForDate(supabase: SupabaseClient, userId: string, dateIso: string): Promise<TrainingBlock | null> {
  const { data } = await supabase
    .from("training_blocks")
    .select("*")
    .eq("user_id", userId)
    .lte("start_date", dateIso)
    .gte("end_date", dateIso)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ? mapTrainingBlockRow(data) : null;
}

// ─── Distribution logic ───────────────────────────────────────────────────

/**
 * Get the ideal training distribution for a race profile.
 * Uses the profile's custom distribution if set, otherwise falls back
 * to the standard distribution for the race type.
 */
function getIdealDistribution(profile: RaceProfile): { swim: number; bike: number; run: number } {
  if (profile.idealDisciplineDistribution) {
    const { swim, bike, run } = profile.idealDisciplineDistribution;
    return { swim, bike, run };
  }

  return RACE_TYPE_DISTRIBUTIONS[profile.distanceType] ?? RACE_TYPE_DISTRIBUTIONS.general!;
}

/**
 * Get the target distribution for a user, based on their primary A-race.
 * Falls back to general distribution if no race profiles exist.
 */
export async function getTargetDistribution(
  supabase: SupabaseClient,
  userId: string
): Promise<{ swim: number; bike: number; run: number }> {
  const primary = await getPrimaryRace(supabase, userId);
  if (primary) {
    return getIdealDistribution(primary);
  }
  return RACE_TYPE_DISTRIBUTIONS.general!;
}

// ─── Row mappers ──────────────────────────────────────────────────────────

function mapRaceProfileRow(row: any): RaceProfile {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    date: row.date,
    distanceType: row.distance_type,
    priority: row.priority,
    courseProfile: row.course_profile ?? {},
    idealDisciplineDistribution: row.ideal_discipline_distribution ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingBlockRow(row: any): TrainingBlock {
  return {
    id: row.id,
    seasonId: row.season_id ?? null,
    planId: row.plan_id ?? null,
    userId: row.user_id,
    name: row.name,
    blockType: row.block_type,
    startDate: row.start_date,
    endDate: row.end_date,
    targetRaceId: row.target_race_id ?? null,
    emphasis: row.emphasis ?? {},
    notes: row.notes ?? null,
    sortOrder: row.sort_order ?? 0,
  };
}
