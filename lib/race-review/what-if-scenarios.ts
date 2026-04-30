/**
 * What-if scenario sketches for race-review interrogation.
 *
 * These are deterministic, athlete-history-driven sketches — never LLM
 * predictions. The model wraps the output in qualifying language and
 * cites the historical sessions or prior races that anchored the
 * estimate. The single allowed place for hedging in race-coach mode.
 *
 * Three scenario kinds:
 *   - pace_at_target: given a target HR or power, what pace did the
 *     athlete sustain in comparable training?
 *   - run_off_bike_at_if: given a bike intensity factor (IF), what run
 *     pace did the athlete produce in matching brick sessions?
 *   - sustainable_load: given a pre-race state, what training load did
 *     the athlete carry in their best-feeling races?
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getNestedNumber } from "@/lib/workouts/metrics-v2";

// ─── Types ────────────────────────────────────────────────────────────────

export type SessionRef = {
  type: "training_session" | "prior_race";
  id: string;
  label: string;
};

export type WhatIfScenario =
  | {
      kind: "pace_at_target";
      role: "swim" | "bike" | "run";
      target: { type: "hr" | "power"; value: number };
    }
  | {
      kind: "run_off_bike_at_if";
      bikeIF: number; // e.g. 0.78
    }
  | {
      kind: "sustainable_load";
      preRaceTsbState?: "fresh" | "absorbing" | "fatigued" | "overreaching";
    };

export type WhatIfSketch = {
  kind: WhatIfScenario["kind"];
  /** Empty when there's no historical evidence — the model must say so. */
  basedOn: SessionRef[];
  /** Pre-formatted sketch sentence the model can quote back; never invents numbers. */
  sketch: string;
  /** Quantitative estimate the model can present with hedging. */
  estimate?: {
    label: string;
    value: number;
    unit: string;
  };
  confidence: "low" | "medium" | "high";
  caveat: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const HR_TOLERANCE_BPM = 4;
const POWER_TOLERANCE_PCT = 0.05;
const BIKE_IF_TOLERANCE = 0.05;
const BRICK_GAP_MAX_MIN = 30;

function paceLabel(role: "swim" | "bike" | "run"): string {
  return role === "swim" ? "sec/100m" : role === "run" ? "sec/km" : "sec/km";
}

// ─── pace_at_target ──────────────────────────────────────────────────────

async function fetchActivitiesForRole(
  supabase: SupabaseClient,
  userId: string,
  sport: string,
  limit: number
) {
  const { data } = await supabase
    .from("completed_activities")
    .select(
      "id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,metrics_v2"
    )
    .eq("user_id", userId)
    .eq("sport_type", sport)
    .order("start_time_utc", { ascending: false })
    .limit(limit);

  return (data ?? []) as Array<{
    id: string;
    sport_type: string;
    start_time_utc: string;
    duration_sec: number | null;
    distance_m: number | null;
    avg_hr: number | null;
    avg_power: number | null;
    avg_pace_per_100m_sec: number | null;
    metrics_v2: unknown;
  }>;
}

function paceSecPerKm(durationSec: number | null, distanceM: number | null): number | null {
  if (!durationSec || !distanceM || distanceM <= 0) return null;
  return durationSec / (distanceM / 1000);
}

async function paceAtTarget(
  supabase: SupabaseClient,
  userId: string,
  scenario: Extract<WhatIfScenario, { kind: "pace_at_target" }>
): Promise<WhatIfSketch> {
  const sport = scenario.role === "bike" ? "cycling" : scenario.role === "run" ? "running" : "swim";
  const activities = await fetchActivitiesForRole(supabase, userId, sport, 40);

  const matches = activities.filter((act) => {
    if (scenario.target.type === "hr") {
      return act.avg_hr != null && Math.abs(act.avg_hr - scenario.target.value) <= HR_TOLERANCE_BPM;
    }
    if (act.avg_power == null) return false;
    const tol = scenario.target.value * POWER_TOLERANCE_PCT;
    return Math.abs(act.avg_power - scenario.target.value) <= tol;
  });

  if (matches.length === 0) {
    return {
      kind: scenario.kind,
      basedOn: [],
      sketch: `No ${sport} sessions in your recent history matched ${scenario.target.type === "hr" ? `${scenario.target.value} bpm` : `${scenario.target.value} W`} closely enough to anchor a sketch.`,
      confidence: "low",
      caveat: "No comparable historical data."
    };
  }

  const paces: number[] = [];
  for (const act of matches) {
    if (scenario.role === "swim" && act.avg_pace_per_100m_sec != null) {
      paces.push(Number(act.avg_pace_per_100m_sec));
    } else {
      const p = paceSecPerKm(act.duration_sec, act.distance_m);
      if (p) paces.push(p);
    }
  }

  if (paces.length === 0) {
    return {
      kind: scenario.kind,
      basedOn: [],
      sketch: `Your matching ${sport} sessions don't have pace data resolved.`,
      confidence: "low",
      caveat: "Pace metrics missing on candidate sessions."
    };
  }

  const median = [...paces].sort((a, b) => a - b)[Math.floor(paces.length / 2)];
  const basedOn: SessionRef[] = matches.slice(0, 3).map((act) => ({
    type: "training_session",
    id: act.id,
    label: `${sport} session on ${act.start_time_utc.slice(0, 10)}`
  }));

  const confidence: WhatIfSketch["confidence"] = matches.length >= 4 ? "high" : matches.length >= 2 ? "medium" : "low";

  return {
    kind: scenario.kind,
    basedOn,
    sketch: `In ${matches.length} historical ${sport} session${matches.length > 1 ? "s" : ""} at ~${scenario.target.value}${scenario.target.type === "hr" ? " bpm" : " W"} you held a median pace around the estimate.`,
    estimate: {
      label: `median ${scenario.role} pace at target`,
      value: Math.round(median),
      unit: paceLabel(scenario.role)
    },
    confidence,
    caveat: matches.length < 3 ? "Few comparable sessions; the median may not generalise." : null
  };
}

// ─── run_off_bike_at_if ──────────────────────────────────────────────────

async function runOffBikeAtIf(
  supabase: SupabaseClient,
  userId: string,
  scenario: Extract<WhatIfScenario, { kind: "run_off_bike_at_if" }>
): Promise<WhatIfSketch> {
  // Fetch a wide window of recent activities for the brick scan.
  const { data } = await supabase
    .from("completed_activities")
    .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,metrics_v2")
    .eq("user_id", userId)
    .in("sport_type", ["cycling", "running"])
    .order("start_time_utc", { ascending: false })
    .limit(120);

  const activities = (data ?? []) as Array<{
    id: string;
    sport_type: "cycling" | "running";
    start_time_utc: string;
    duration_sec: number | null;
    distance_m: number | null;
    avg_hr: number | null;
    avg_power: number | null;
    metrics_v2: unknown;
  }>;

  // Group as bike-then-run pairs within 30 minutes.
  const sortedAsc = [...activities].sort((a, b) => a.start_time_utc.localeCompare(b.start_time_utc));
  const bricks: Array<{ bike: typeof sortedAsc[number]; run: typeof sortedAsc[number]; bikeIF: number }> = [];

  for (let i = 0; i < sortedAsc.length - 1; i += 1) {
    const a = sortedAsc[i];
    const b = sortedAsc[i + 1];
    if (a.sport_type !== "cycling" || b.sport_type !== "running") continue;
    if (!a.duration_sec) continue;
    const bikeEnd = new Date(a.start_time_utc).getTime() + a.duration_sec * 1000;
    const runStart = new Date(b.start_time_utc).getTime();
    const gapMin = (runStart - bikeEnd) / 60_000;
    if (gapMin < 0 || gapMin > BRICK_GAP_MAX_MIN) continue;
    const bikeIF = getNestedNumber(a.metrics_v2, [["power", "intensityFactor"], ["power", "intensity_factor"]]);
    if (bikeIF == null) continue;
    if (Math.abs(bikeIF - scenario.bikeIF) > BIKE_IF_TOLERANCE) continue;
    bricks.push({ bike: a, run: b, bikeIF });
  }

  if (bricks.length === 0) {
    return {
      kind: scenario.kind,
      basedOn: [],
      sketch: `No brick sessions in your history fell within ±${BIKE_IF_TOLERANCE * 100}% of bike IF ${scenario.bikeIF.toFixed(2)}.`,
      confidence: "low",
      caveat: "No comparable brick history."
    };
  }

  const runPaces: number[] = [];
  const basedOn: SessionRef[] = [];
  for (const brick of bricks.slice(0, 5)) {
    const pace = paceSecPerKm(brick.run.duration_sec, brick.run.distance_m);
    if (pace) runPaces.push(pace);
    basedOn.push(
      { type: "training_session", id: brick.bike.id, label: `bike on ${brick.bike.start_time_utc.slice(0, 10)} (IF ${brick.bikeIF.toFixed(2)})` },
      { type: "training_session", id: brick.run.id, label: `run-off-bike on ${brick.run.start_time_utc.slice(0, 10)}` }
    );
  }

  const median = runPaces.length > 0 ? [...runPaces].sort((a, b) => a - b)[Math.floor(runPaces.length / 2)] : null;

  const confidence: WhatIfSketch["confidence"] = bricks.length >= 4 ? "high" : bricks.length >= 2 ? "medium" : "low";

  return {
    kind: scenario.kind,
    basedOn,
    sketch: `Across ${bricks.length} brick session${bricks.length > 1 ? "s" : ""} where bike IF was within ±5% of ${scenario.bikeIF.toFixed(2)}, your run-off-bike pace clustered around the estimate.`,
    estimate: median != null ? { label: "median run pace off the bike", value: Math.round(median), unit: "sec/km" } : undefined,
    confidence,
    caveat: bricks.length < 3 ? "Small brick sample; result may not generalise." : null
  };
}

// ─── sustainable_load ────────────────────────────────────────────────────

async function sustainableLoad(
  supabase: SupabaseClient,
  userId: string,
  _scenario: Extract<WhatIfScenario, { kind: "sustainable_load" }>
): Promise<WhatIfSketch> {
  // Pull prior bundles where the athlete reported a high rating (4-5)
  // and pre-race TSB was fresh — those are the "well-loaded" samples.
  const { data } = await supabase
    .from("race_bundles")
    .select("id,started_at,pre_race_ctl,pre_race_atl,pre_race_tsb,pre_race_tsb_state,athlete_rating,race_profile_id")
    .eq("user_id", userId)
    .eq("pre_race_tsb_state", "fresh")
    .gte("athlete_rating", 4)
    .order("started_at", { ascending: false })
    .limit(5);

  const wellLoaded = (data ?? []) as Array<{
    id: string;
    started_at: string;
    pre_race_ctl: number | null;
    pre_race_atl: number | null;
    pre_race_tsb: number | null;
    athlete_rating: number | null;
  }>;

  if (wellLoaded.length === 0) {
    return {
      kind: "sustainable_load",
      basedOn: [],
      sketch: "No prior race in your history combined a 4+ rating with a fresh pre-race TSB, so a sustainable-load sketch isn't grounded yet.",
      confidence: "low",
      caveat: "No matching prior races."
    };
  }

  const ctls = wellLoaded.map((b) => b.pre_race_ctl).filter((v): v is number => v != null);
  const median = ctls.length > 0 ? [...ctls].sort((a, b) => a - b)[Math.floor(ctls.length / 2)] : null;

  return {
    kind: "sustainable_load",
    basedOn: wellLoaded.map((b) => ({
      type: "prior_race",
      id: b.id,
      label: `prior race on ${b.started_at.slice(0, 10)} (CTL ${b.pre_race_ctl ?? "—"})`
    })),
    sketch: `Across ${wellLoaded.length} prior race${wellLoaded.length > 1 ? "s" : ""} where you arrived fresh AND rated the experience 4+, the median pre-race CTL was the estimate below.`,
    estimate: median != null ? { label: "median CTL before strong races", value: Math.round(median), unit: "ctl" } : undefined,
    confidence: wellLoaded.length >= 3 ? "high" : wellLoaded.length >= 2 ? "medium" : "low",
    caveat: wellLoaded.length < 3 ? "Small race sample; treat the CTL as a rough anchor, not a target." : null
  };
}

// ─── Public dispatcher ───────────────────────────────────────────────────

export async function runWhatIfScenario(
  supabase: SupabaseClient,
  userId: string,
  scenario: WhatIfScenario
): Promise<WhatIfSketch> {
  switch (scenario.kind) {
    case "pace_at_target":
      return paceAtTarget(supabase, userId, scenario);
    case "run_off_bike_at_if":
      return runOffBikeAtIf(supabase, userId, scenario);
    case "sustainable_load":
      return sustainableLoad(supabase, userId, scenario);
  }
}
