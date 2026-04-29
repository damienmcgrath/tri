/**
 * AI race review pipeline.
 *
 * Given a race_bundle (a multi-segment race made of swim/T1/bike/T2/run
 * activities), load the bundle + segments + planned session + race profile,
 * compute deterministic facts (per-leg pacing halves, transitions, discipline
 * distribution vs ideal), then synthesize an AI narrative on top.
 *
 * Mirrors lib/weekly-debrief/narrative.ts: deterministic fallback computed
 * first, callOpenAIWithFallback handles the OpenAI call with graceful
 * degradation, persisted via upsert keyed on race_bundle_id.
 *
 * Triggers: fire-and-forget after persistMultisportBundle / attemptRaceBundle
 * via triggerRaceReviewBackground; manual via POST /api/race-reviews/[bundleId]/regenerate.
 */

import "openai/shims/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import { getCoachModel } from "@/lib/openai";
import { getMetricsV2Laps } from "@/lib/workouts/metrics-v2";

// ─── Types ──────────────────────────────────────────────────────────────────

export type RaceSegmentRole = "swim" | "t1" | "bike" | "t2" | "run";

export type RaceSegmentData = {
  activityId: string;
  role: RaceSegmentRole;
  segmentIndex: number;
  sportType: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  avgPower: number | null;
  metricsV2: Record<string, unknown> | null;
};

export type RaceBundleData = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  totalDurationSec: number;
  totalDistanceM: number | null;
  source: "garmin_multisport" | "strava_reconstructed" | "manual";
};

export type RaceProfileForReview = {
  id: string;
  name: string;
  date: string;
  distanceType: string;
  idealDisciplineDistribution: { swim: number; bike: number; run: number; strength?: number } | null;
};

export type DisciplineDistribution = Partial<Record<RaceSegmentRole, number>>;

export type LegPacing =
  | { halvesAvailable: false }
  | {
      halvesAvailable: true;
      firstHalf: number;
      lastHalf: number;
      deltaPct: number;
      unit: "watts" | "sec_per_km" | "sec_per_100m";
    };

export type RaceFacts = {
  bundle: RaceBundleData;
  segments: RaceSegmentData[];
  plannedSession: { id: string; type: string | null; sessionName: string | null; target: string | null } | null;
  raceProfile: RaceProfileForReview | null;
  disciplineDistributionActual: DisciplineDistribution;
  disciplineDistributionDelta: { swim?: number; bike?: number; run?: number } | null;
  pacing: { swim?: LegPacing; bike?: LegPacing; run?: LegPacing };
  transitions: { t1DurationSec: number | null; t2DurationSec: number | null };
};

export type RaceReviewNarrative = {
  headline: string;
  narrative: string;
  coachTake: string;
  transitionNotes: string | null;
  pacingNotes: {
    swim: { note: string } | null;
    bike: { note: string } | null;
    run: { note: string } | null;
  };
};

// ─── Zod schema for AI output ───────────────────────────────────────────────

export const raceReviewNarrativeSchema = z.object({
  headline: z.string().min(1).max(120),
  // Story not data dump — keep tight so the AI doesn't restate per-leg numbers
  // already shown in the segment list and per-leg pacing block.
  narrative: z.string().min(1).max(420),
  coachTake: z.string().min(1).max(220),
  transitionNotes: z.string().max(220).nullable(),
  pacingNotes: z.object({
    swim: z.object({ note: z.string().min(1).max(220) }).nullable(),
    bike: z.object({ note: z.string().min(1).max(220) }).nullable(),
    run: z.object({ note: z.string().min(1).max(220) }).nullable()
  })
});

// ─── Public surface ─────────────────────────────────────────────────────────

export type GenerateRaceReviewArgs = {
  supabase: SupabaseClient;
  userId: string;
  bundleId: string;
};

export type GenerateRaceReviewResult =
  | { status: "ok"; reviewId: string; source: "ai" | "fallback"; plannedSessionId: string | null }
  | { status: "skipped"; reason: string };

// ─── Loaders ────────────────────────────────────────────────────────────────

async function loadBundle(supabase: SupabaseClient, userId: string, bundleId: string): Promise<RaceBundleData | null> {
  const { data } = await supabase
    .from("race_bundles")
    .select("id,user_id,started_at,ended_at,total_duration_sec,total_distance_m,source")
    .eq("id", bundleId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    startedAt: data.started_at as string,
    endedAt: (data.ended_at as string | null) ?? null,
    totalDurationSec: Number(data.total_duration_sec ?? 0),
    totalDistanceM: data.total_distance_m === null || data.total_distance_m === undefined ? null : Number(data.total_distance_m),
    source: data.source as RaceBundleData["source"]
  };
}

async function loadSegments(supabase: SupabaseClient, userId: string, bundleId: string): Promise<RaceSegmentData[]> {
  const { data } = await supabase
    .from("completed_activities")
    .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,race_segment_role,race_segment_index,metrics_v2")
    .eq("user_id", userId)
    .eq("race_bundle_id", bundleId)
    .order("race_segment_index", { ascending: true });

  return (data ?? [])
    .filter((row: any) => row.race_segment_role && row.race_segment_index !== null)
    .map((row: any) => ({
      activityId: row.id as string,
      role: row.race_segment_role as RaceSegmentRole,
      segmentIndex: Number(row.race_segment_index),
      sportType: row.sport_type as string,
      durationSec: Number(row.duration_sec ?? 0),
      distanceM: row.distance_m === null || row.distance_m === undefined ? null : Number(row.distance_m),
      avgHr: row.avg_hr === null || row.avg_hr === undefined ? null : Number(row.avg_hr),
      avgPower: row.avg_power === null || row.avg_power === undefined ? null : Number(row.avg_power),
      metricsV2: (row.metrics_v2 ?? null) as Record<string, unknown> | null
    }));
}

async function loadPlannedSession(supabase: SupabaseClient, userId: string, plannedSessionId: string | null) {
  if (!plannedSessionId) return null;
  const { data } = await supabase
    .from("sessions")
    .select("id,type,session_name,target")
    .eq("id", plannedSessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    type: (data.type as string | null) ?? null,
    sessionName: (data.session_name as string | null) ?? null,
    target: (data.target as string | null) ?? null
  };
}

async function loadRaceProfile(supabase: SupabaseClient, userId: string, bundleDateIso: string): Promise<RaceProfileForReview | null> {
  const date = bundleDateIso.slice(0, 10);
  const { data } = await supabase
    .from("race_profiles")
    .select("id,name,date,distance_type,ideal_discipline_distribution")
    .eq("user_id", userId)
    .eq("date", date)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    date: data.date as string,
    distanceType: data.distance_type as string,
    idealDisciplineDistribution: (data.ideal_discipline_distribution ?? null) as RaceProfileForReview["idealDisciplineDistribution"]
  };
}

async function resolvePlannedSessionId(supabase: SupabaseClient, userId: string, segmentIds: string[]): Promise<string | null> {
  if (segmentIds.length === 0) return null;
  const { data } = await supabase
    .from("session_activity_links")
    .select("planned_session_id,confirmation_status")
    .eq("user_id", userId)
    .eq("match_method", "race_bundle")
    .in("completed_activity_id", segmentIds);
  const confirmed = (data ?? []).filter(
    (row: any) => row.confirmation_status === "confirmed" || row.confirmation_status === null
  );
  const ids = new Set(confirmed.map((row: any) => row.planned_session_id as string));
  if (ids.size !== 1) return null;
  return [...ids][0];
}

// ─── Deterministic facts builder ────────────────────────────────────────────

/**
 * Compute halves split for a leg from its laps array. Returns null if the laps
 * data isn't present or doesn't carry a usable metric (power for bike, pace
 * for run/swim).
 */
function computeLegHalvesFromLaps(segment: RaceSegmentData): LegPacing {
  // Prefer the explicit `halves` block if present (bike power case).
  const halvesBlock = segment.metricsV2 && typeof segment.metricsV2 === "object"
    ? (segment.metricsV2 as Record<string, unknown>).halves
    : null;
  if (segment.role === "bike" && halvesBlock && typeof halvesBlock === "object") {
    const h = halvesBlock as Record<string, unknown>;
    const first = typeof h.firstHalfAvgPower === "number" ? h.firstHalfAvgPower : null;
    const last = typeof h.lastHalfAvgPower === "number" ? h.lastHalfAvgPower : null;
    if (first !== null && last !== null && first > 0) {
      return {
        halvesAvailable: true,
        firstHalf: Math.round(first),
        lastHalf: Math.round(last),
        deltaPct: round2(((last - first) / first) * 100),
        unit: "watts"
      };
    }
  }

  // Otherwise compute from laps. Need ≥2 laps with the right metric.
  const laps = getMetricsV2Laps(segment.metricsV2);
  if (laps.length < 2) return { halvesAvailable: false };

  const totalDuration = laps.reduce((sum, lap) => sum + (lap.durationSec ?? 0), 0);
  if (totalDuration <= 0) return { halvesAvailable: false };

  const half = totalDuration / 2;
  let acc = 0;
  let splitIdx = 0;
  for (let i = 0; i < laps.length; i++) {
    acc += laps[i].durationSec ?? 0;
    if (acc >= half) {
      splitIdx = i + 1;
      break;
    }
  }
  splitIdx = Math.max(1, Math.min(splitIdx, laps.length - 1));
  const firstLaps = laps.slice(0, splitIdx);
  const lastLaps = laps.slice(splitIdx);
  if (firstLaps.length === 0 || lastLaps.length === 0) return { halvesAvailable: false };

  const weightedAvg = (
    pickMetric: (lap: typeof laps[number]) => number | null | undefined,
    chunk: typeof laps
  ): number | null => {
    let weighted = 0;
    let weight = 0;
    for (const lap of chunk) {
      const value = pickMetric(lap);
      const dur = lap.durationSec ?? 0;
      if (typeof value === "number" && Number.isFinite(value) && dur > 0) {
        weighted += value * dur;
        weight += dur;
      }
    }
    return weight > 0 ? weighted / weight : null;
  };

  if (segment.role === "bike") {
    const first = weightedAvg((lap) => lap.avgPower, firstLaps);
    const last = weightedAvg((lap) => lap.avgPower, lastLaps);
    if (first !== null && last !== null && first > 0) {
      return {
        halvesAvailable: true,
        firstHalf: Math.round(first),
        lastHalf: Math.round(last),
        deltaPct: round2(((last - first) / first) * 100),
        unit: "watts"
      };
    }
  }

  if (segment.role === "run") {
    const first = weightedAvg((lap) => lap.avgPaceSecPerKm ?? null, firstLaps);
    const last = weightedAvg((lap) => lap.avgPaceSecPerKm ?? null, lastLaps);
    if (first !== null && last !== null && first > 0) {
      return {
        halvesAvailable: true,
        firstHalf: Math.round(first),
        lastHalf: Math.round(last),
        deltaPct: round2(((last - first) / first) * 100),
        unit: "sec_per_km"
      };
    }
  }

  if (segment.role === "swim") {
    const first = weightedAvg((lap) => lap.avgPacePer100mSec ?? null, firstLaps);
    const last = weightedAvg((lap) => lap.avgPacePer100mSec ?? null, lastLaps);
    if (first !== null && last !== null && first > 0) {
      return {
        halvesAvailable: true,
        firstHalf: Math.round(first),
        lastHalf: Math.round(last),
        deltaPct: round2(((last - first) / first) * 100),
        unit: "sec_per_100m"
      };
    }
  }

  return { halvesAvailable: false };
}

export function buildRaceFacts(args: {
  bundle: RaceBundleData;
  segments: RaceSegmentData[];
  plannedSession: RaceFacts["plannedSession"];
  raceProfile: RaceProfileForReview | null;
}): RaceFacts {
  const { bundle, segments, plannedSession, raceProfile } = args;

  const totalDurationSec = bundle.totalDurationSec > 0
    ? bundle.totalDurationSec
    : segments.reduce((sum, s) => sum + s.durationSec, 0);

  const disciplineDistributionActual: DisciplineDistribution = {};
  for (const segment of segments) {
    const share = totalDurationSec > 0 ? segment.durationSec / totalDurationSec : 0;
    disciplineDistributionActual[segment.role] = round4(share);
  }

  let disciplineDistributionDelta: RaceFacts["disciplineDistributionDelta"] = null;
  const ideal = raceProfile?.idealDisciplineDistribution;
  if (ideal) {
    // Fold T1 into bike, T2 into run (ideal shape only carries swim/bike/run).
    const actualSwim = disciplineDistributionActual.swim ?? 0;
    const actualBike = (disciplineDistributionActual.bike ?? 0) + (disciplineDistributionActual.t1 ?? 0);
    const actualRun = (disciplineDistributionActual.run ?? 0) + (disciplineDistributionActual.t2 ?? 0);
    disciplineDistributionDelta = {
      swim: round4(actualSwim - ideal.swim),
      bike: round4(actualBike - ideal.bike),
      run: round4(actualRun - ideal.run)
    };
  }

  const pacing: RaceFacts["pacing"] = {};
  for (const segment of segments) {
    if (segment.role === "swim" || segment.role === "bike" || segment.role === "run") {
      pacing[segment.role] = computeLegHalvesFromLaps(segment);
    }
  }

  const t1Segment = segments.find((s) => s.role === "t1");
  const t2Segment = segments.find((s) => s.role === "t2");
  const transitions = {
    t1DurationSec: t1Segment ? t1Segment.durationSec : null,
    t2DurationSec: t2Segment ? t2Segment.durationSec : null
  };

  return {
    bundle: { ...bundle, totalDurationSec },
    segments,
    plannedSession,
    raceProfile,
    disciplineDistributionActual,
    disciplineDistributionDelta,
    pacing,
    transitions
  };
}

// ─── Deterministic fallback narrative ───────────────────────────────────────

export function buildDeterministicRaceReview(facts: RaceFacts): RaceReviewNarrative {
  const totalLabel = formatDuration(facts.bundle.totalDurationSec);
  const sportsPresent = facts.segments
    .filter((s) => s.role === "swim" || s.role === "bike" || s.role === "run")
    .map((s) => s.role);
  const sportsLabel = sportsPresent.join("/") || "race";

  const headline = `Race completed in ${totalLabel} across ${sportsLabel}.`;

  const narrativeParts: string[] = [
    `${capitalize(sportsLabel)} race completed in ${totalLabel}.`
  ];
  if (facts.pacing.bike?.halvesAvailable) {
    const dir = facts.pacing.bike.deltaPct >= 0 ? "rose" : "fell";
    narrativeParts.push(
      `Bike power ${dir} ${Math.abs(facts.pacing.bike.deltaPct).toFixed(1)}% second half (${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W).`
    );
  }
  if (facts.pacing.run?.halvesAvailable) {
    const dir = facts.pacing.run.deltaPct > 0 ? "slowed" : "held";
    narrativeParts.push(
      `Run pace ${dir} ${Math.abs(facts.pacing.run.deltaPct).toFixed(1)}% second half (${formatPaceSecPerKm(facts.pacing.run.firstHalf)} → ${formatPaceSecPerKm(facts.pacing.run.lastHalf)} /km).`
    );
  }
  if (facts.transitions.t1DurationSec !== null || facts.transitions.t2DurationSec !== null) {
    const parts: string[] = [];
    if (facts.transitions.t1DurationSec !== null) parts.push(`T1 ${formatDuration(facts.transitions.t1DurationSec)}`);
    if (facts.transitions.t2DurationSec !== null) parts.push(`T2 ${formatDuration(facts.transitions.t2DurationSec)}`);
    narrativeParts.push(`Transitions: ${parts.join(" / ")}.`);
  }
  const narrative = narrativeParts.join(" ");

  const coachTake = facts.pacing.bike?.halvesAvailable && Math.abs(facts.pacing.bike.deltaPct) <= 2
    ? "Bike pacing held steady — repeat that controlled effort on the next race-pace ride."
    : facts.pacing.run?.halvesAvailable && facts.pacing.run.deltaPct > 5
      ? "Second-half run faded — practice negative-split runs at race pace before the next event."
      : "Race executed. Review the segment-by-segment splits to identify the next focus area.";

  const transitionNotes = facts.transitions.t1DurationSec !== null || facts.transitions.t2DurationSec !== null
    ? `Transitions: ${[
        facts.transitions.t1DurationSec !== null ? `T1 ${formatDuration(facts.transitions.t1DurationSec)}` : null,
        facts.transitions.t2DurationSec !== null ? `T2 ${formatDuration(facts.transitions.t2DurationSec)}` : null
      ].filter(Boolean).join(", ")}.`
    : null;

  const pacingNotes = {
    swim: facts.pacing.swim?.halvesAvailable
      ? { note: `${formatPacePer100m(facts.pacing.swim.firstHalf)} → ${formatPacePer100m(facts.pacing.swim.lastHalf)} per 100m (${formatDeltaPct(facts.pacing.swim.deltaPct)}).` }
      : null,
    bike: facts.pacing.bike?.halvesAvailable
      ? { note: `${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W (${formatDeltaPct(facts.pacing.bike.deltaPct)}).` }
      : null,
    run: facts.pacing.run?.halvesAvailable
      ? { note: `${formatPaceSecPerKm(facts.pacing.run.firstHalf)} → ${formatPaceSecPerKm(facts.pacing.run.lastHalf)} /km (${formatDeltaPct(facts.pacing.run.deltaPct)}).` }
      : null
  };

  return {
    headline: clip(headline, 120),
    narrative: clip(narrative, 420),
    coachTake: clip(coachTake, 220),
    transitionNotes: transitionNotes ? clip(transitionNotes, 220) : null,
    pacingNotes
  };
}

// ─── Prompt builders ────────────────────────────────────────────────────────

export function buildRaceReviewInstructions(): string {
  return [
    "You are TriCoach AI, debriefing an athlete on a multi-segment race (triathlon or duathlon).",
    "",
    "Voice rules:",
    "- Be concise, direct, supportive. Coach voice — terse and authoritative, no hedging ('appears', 'seems', 'might').",
    "- Use only the metrics provided. Never invent splits, power numbers, or paces.",
    "- Evaluate intensity compliance first, pacing second, duration third.",
    "- If halves data is missing for a leg, set its pacingNotes entry to null. Do not fabricate a number.",
    "- The coachTake must be a single concrete next-step in NEXT-format: name a target (pace/power/structure) and a progression trigger.",
    "",
    "Formatting rules — CRITICAL, never break these:",
    "- ALWAYS use the pre-formatted *Label fields when writing prose ('durationLabel', 'distanceLabel', 'paceLabel', 'firstHalfLabel', etc.). They are already in the right unit/format.",
    "- NEVER write raw seconds (no '1601 s', '4634 s', '131 s', '96 s') — these read as alien numbers to athletes.",
    "- NEVER write raw meters when the value is ≥1000 (no '9357 m'); the *Label field uses km.",
    "- Durations: 'mm:ss' for under an hour, 'h:mm:ss' for over.",
    "- Pace: 'M:SS /km' for run, 'M:SS /100m' for swim.",
    "- Power: 'XXXW' (no decimals, no space).",
    "- Percentages: one decimal place, with sign for deltas (+1.5%, −2.3%).",
    "",
    "Output shape:",
    "- headline (≤120 chars): one-line execution summary using *Label values. Example: 'Even-split Olympic; bike held 220→216W (−1.8%) across halves.'",
    "- narrative (≤420 chars, 2–3 sentences): the STORY, not a data dump. The segment durations + distances are already shown in the segment list below — DO NOT restate them. Instead, describe HOW the race was executed (controlled / aggressive / faded), what the halves data reveals, and what the discipline distribution suggests if a race profile was provided. Numbers should feature only when load-bearing for the story.",
    "- coachTake (≤220 chars): one prescriptive takeaway. Single NEXT-format prescription using *Label values.",
    "- transitionNotes (≤220 chars or null): one short observation on T1/T2 using durationLabel ('T1 2:11, T2 1:36 — both efficient'). Null when both transitions are missing.",
    "- pacingNotes.{swim,bike,run}: one short observation per leg grounded in the halves data, using *Label values. Null when halves data for that leg is unavailable.",
    "",
    "Inputs you receive (JSON). Each leg has both raw machine fields AND human *Label strings — always quote the *Label strings in prose:",
    "- bundle: { totalDurationLabel: 'h:mm:ss', totalDistanceLabel: 'NN.NN km', source }",
    "- segments[]: { role, durationLabel, distanceLabel, avgHr, avgPowerLabel? }",
    "- plannedSession: { type, target } or null.",
    "- raceProfile: { name, distanceType, idealDisciplineDistribution } or null.",
    "- disciplineDistributionActual: { swim: 0.18, bike: 0.51, run: 0.29, ... } (use as percentages).",
    "- disciplineDistributionDelta: { swim, bike, run } or null when no race profile.",
    "- pacing.{swim,bike,run}: { firstHalfLabel, lastHalfLabel, deltaPctLabel, unit } or { halvesAvailable: false }.",
    "- transitions: { t1Label, t2Label } (already mm:ss or null when missing)."
  ].join("\n");
}

function formatDurationLabel(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return null;
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDistanceLabel(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function formatHalvesUnitLabel(value: number, unit: "watts" | "sec_per_km" | "sec_per_100m"): string {
  if (unit === "watts") return `${Math.round(value)}W`;
  return formatPaceFromSeconds(value, unit);
}

function formatPaceFromSeconds(sec: number, unit: "sec_per_km" | "sec_per_100m"): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  const suffix = unit === "sec_per_km" ? " /km" : " /100m";
  return `${m}:${String(s).padStart(2, "0")}${suffix}`;
}

function formatDeltaPctLabel(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function buildRaceReviewInput(facts: RaceFacts): unknown {
  return {
    bundle: {
      totalDurationLabel: formatDurationLabel(facts.bundle.totalDurationSec),
      totalDistanceLabel: formatDistanceLabel(facts.bundle.totalDistanceM),
      source: facts.bundle.source
    },
    segments: facts.segments.map((s) => ({
      role: s.role,
      durationLabel: formatDurationLabel(s.durationSec),
      distanceLabel: formatDistanceLabel(s.distanceM),
      avgHr: s.avgHr,
      avgPowerLabel: typeof s.avgPower === "number" ? `${Math.round(s.avgPower)}W` : null
    })),
    plannedSession: facts.plannedSession,
    raceProfile: facts.raceProfile
      ? {
          name: facts.raceProfile.name,
          distanceType: facts.raceProfile.distanceType,
          idealDisciplineDistribution: facts.raceProfile.idealDisciplineDistribution
        }
      : null,
    disciplineDistributionActual: facts.disciplineDistributionActual,
    disciplineDistributionDelta: facts.disciplineDistributionDelta,
    pacing: {
      swim: facts.pacing.swim?.halvesAvailable
        ? {
            firstHalfLabel: formatHalvesUnitLabel(facts.pacing.swim.firstHalf, facts.pacing.swim.unit),
            lastHalfLabel: formatHalvesUnitLabel(facts.pacing.swim.lastHalf, facts.pacing.swim.unit),
            deltaPctLabel: formatDeltaPctLabel(facts.pacing.swim.deltaPct),
            unit: facts.pacing.swim.unit
          }
        : { halvesAvailable: false },
      bike: facts.pacing.bike?.halvesAvailable
        ? {
            firstHalfLabel: formatHalvesUnitLabel(facts.pacing.bike.firstHalf, facts.pacing.bike.unit),
            lastHalfLabel: formatHalvesUnitLabel(facts.pacing.bike.lastHalf, facts.pacing.bike.unit),
            deltaPctLabel: formatDeltaPctLabel(facts.pacing.bike.deltaPct),
            unit: facts.pacing.bike.unit
          }
        : { halvesAvailable: false },
      run: facts.pacing.run?.halvesAvailable
        ? {
            firstHalfLabel: formatHalvesUnitLabel(facts.pacing.run.firstHalf, facts.pacing.run.unit),
            lastHalfLabel: formatHalvesUnitLabel(facts.pacing.run.lastHalf, facts.pacing.run.unit),
            deltaPctLabel: formatDeltaPctLabel(facts.pacing.run.deltaPct),
            unit: facts.pacing.run.unit
          }
        : { halvesAvailable: false }
    },
    transitions: {
      t1Label: formatDurationLabel(facts.transitions.t1DurationSec),
      t2Label: formatDurationLabel(facts.transitions.t2DurationSec)
    }
  };
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function generateRaceReview(args: GenerateRaceReviewArgs): Promise<GenerateRaceReviewResult> {
  const { supabase, userId, bundleId } = args;

  const bundle = await loadBundle(supabase, userId, bundleId);
  if (!bundle) return { status: "skipped", reason: "bundle_not_found" };

  const segments = await loadSegments(supabase, userId, bundleId);
  if (segments.length < 3) return { status: "skipped", reason: "insufficient_segments" };

  const segmentIds = segments.map((s) => s.activityId);
  const plannedSessionId = await resolvePlannedSessionId(supabase, userId, segmentIds);
  const plannedSession = await loadPlannedSession(supabase, userId, plannedSessionId);
  const raceProfile = await loadRaceProfile(supabase, userId, bundle.startedAt);

  const facts = buildRaceFacts({ bundle, segments, plannedSession, raceProfile });
  const fallback = buildDeterministicRaceReview(facts);

  const result = await callOpenAIWithFallback<RaceReviewNarrative>({
    logTag: "race-review",
    fallback,
    buildRequest: () => ({
      instructions: buildRaceReviewInstructions(),
      reasoning: { effort: "low" },
      max_output_tokens: 3000,
      text: {
        format: zodTextFormat(raceReviewNarrativeSchema, "race_review_narrative", {
          description: "Structured race review narrative."
        })
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify(buildRaceReviewInput(facts))
            }
          ]
        }
      ]
    }),
    schema: raceReviewNarrativeSchema,
    logContext: { bundleId, plannedSessionId }
  });

  const narrative = result.value;
  const isProvisional = result.source === "fallback";
  const modelUsed = result.source === "ai" ? getCoachModel() : "fallback";

  // Merge AI's per-leg notes with our deterministic numerics. Prefer the AI
  // note when present; otherwise fall back to the deterministic note we
  // computed.
  const pacingNotesPersisted: Record<string, unknown> = {};
  for (const leg of ["swim", "bike", "run"] as const) {
    const ai = narrative.pacingNotes[leg];
    const deterministicLeg = fallback.pacingNotes[leg];
    const halves = facts.pacing[leg];
    if (halves?.halvesAvailable) {
      pacingNotesPersisted[leg] = {
        firstHalf: halves.firstHalf,
        lastHalf: halves.lastHalf,
        deltaPct: halves.deltaPct,
        unit: halves.unit,
        note: ai?.note ?? deterministicLeg?.note ?? null
      };
    } else if (ai?.note) {
      pacingNotesPersisted[leg] = { note: ai.note };
    }
  }

  const { data: upsertData, error: upsertError } = await supabase
    .from("race_reviews")
    .upsert(
      {
        user_id: userId,
        race_bundle_id: bundleId,
        planned_session_id: plannedSessionId,
        headline: narrative.headline,
        narrative: narrative.narrative,
        coach_take: narrative.coachTake,
        transition_notes: narrative.transitionNotes,
        pacing_notes: pacingNotesPersisted,
        discipline_distribution_actual: facts.disciplineDistributionActual,
        discipline_distribution_delta: facts.disciplineDistributionDelta,
        model_used: modelUsed,
        is_provisional: isProvisional,
        generated_at: new Date().toISOString()
      },
      { onConflict: "race_bundle_id" }
    )
    .select("id")
    .single();

  if (upsertError || !upsertData) {
    console.error("[race-review] upsert failed", { bundleId, error: upsertError?.message });
    return { status: "skipped", reason: `upsert_failed:${upsertError?.message ?? "unknown"}` };
  }

  return {
    status: "ok",
    reviewId: upsertData.id as string,
    source: result.source,
    plannedSessionId
  };
}

export function triggerRaceReviewBackground(args: GenerateRaceReviewArgs): void {
  void generateRaceReview(args).catch((err) => {
    console.error("[race-review] background generation failed", {
      bundleId: args.bundleId,
      error: err instanceof Error ? err.message : String(err)
    });
  });
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPaceSecPerKm(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPacePer100m(secPer100: number): string {
  const m = Math.floor(secPer100 / 60);
  const s = Math.round(secPer100 % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDeltaPct(deltaPct: number): string {
  const sign = deltaPct >= 0 ? "+" : "−";
  return `${sign}${Math.abs(deltaPct).toFixed(1)}% second half`;
}
