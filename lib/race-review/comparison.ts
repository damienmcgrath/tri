/**
 * Phase 3.1 — Race-to-Race Comparison orchestrator.
 *
 * Loads two race bundles + their segments + race profiles + pre-race
 * snapshots, computes per-leg / finish / IF deltas deterministically,
 * then asks the AI for a progression narrative.
 *
 * The picks (per-leg metrics, deltas, transitions) are deterministic.
 * Only the narrative is AI-generated. The AI is grounded in the
 * deterministic payload — it cannot invent numbers.
 *
 * Compatibility check: refuses to produce a comparison when the two races
 * have differing `distance_type` on their race_profiles.
 */

import "openai/shims/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import {
  comparisonPayloadSchema,
  progressionNarrativeSchema,
  type ComparisonPayload,
  type LegDelta,
  type ProgressionNarrative,
  type RaceLite
} from "@/lib/race-review/comparison-schemas";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ComparisonDiscipline = "swim" | "bike" | "run";

type SegmentRow = {
  id: string;
  race_segment_role: string | null;
  duration_sec: number;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  metrics_v2: Record<string, unknown> | null;
};

type BundleRow = {
  id: string;
  user_id: string;
  started_at: string;
  total_duration_sec: number;
  goal_time_sec: number | null;
  race_profile_id: string | null;
  pre_race_ctl: number | null;
  pre_race_atl: number | null;
  pre_race_tsb: number | null;
  taper_compliance_score: number | null;
};

type ProfileRow = {
  id: string;
  name: string | null;
  date: string;
  distance_type: string | null;
};

export type GenerateComparisonArgs = {
  supabase: SupabaseClient;
  userId: string;
  /** "This" race (the one being viewed). */
  bundleId: string;
  /** Prior race we're comparing against. Must be a different bundle. */
  priorBundleId: string;
  /** When true, skips the OpenAI call and persists the deterministic narrative. */
  skipAi?: boolean;
};

export type GenerateComparisonResult =
  | {
      status: "ok";
      payload: ComparisonPayload;
      narrative: ProgressionNarrative;
      source: "ai" | "fallback";
    }
  | { status: "skipped"; reason: string };

// ─── Pure helpers (exported for testing) ────────────────────────────────────

export function deriveLegSummary(seg: SegmentRow | null): {
  durationSec: number;
  np: number | null;
  pace: number | null;
  avgHr: number | null;
} | null {
  if (!seg) return null;
  const role = seg.race_segment_role;
  const durationSec = Number(seg.duration_sec ?? 0);
  if (durationSec <= 0) return null;
  const avgHr = seg.avg_hr != null ? Number(seg.avg_hr) : null;
  const distanceM = seg.distance_m != null ? Number(seg.distance_m) : null;

  let np: number | null = null;
  let pace: number | null = null;

  if (role === "bike") {
    const m = seg.metrics_v2;
    if (m && typeof m === "object") {
      const npVal = (m as Record<string, unknown>).normalizedPower;
      if (typeof npVal === "number" && npVal > 0) np = npVal;
      if (np == null) {
        const halves = (m as Record<string, unknown>).halves;
        if (halves && typeof halves === "object") {
          const hh = halves as Record<string, unknown>;
          const f = typeof hh.firstHalfAvgPower === "number" ? hh.firstHalfAvgPower : null;
          const l = typeof hh.lastHalfAvgPower === "number" ? hh.lastHalfAvgPower : null;
          if (f != null && l != null) np = Math.round((f + l) / 2);
        }
      }
    }
    if (np == null && seg.avg_power != null) np = Number(seg.avg_power);
  } else if (role === "swim") {
    if (distanceM && distanceM > 0) pace = Math.round(durationSec / (distanceM / 100));
  } else if (role === "run") {
    if (distanceM && distanceM > 0) pace = Math.round(durationSec / (distanceM / 1000));
  }

  return { durationSec, np, pace, avgHr };
}

export function buildLegDelta(
  thisSeg: SegmentRow | null,
  priorSeg: SegmentRow | null
): LegDelta | null {
  const thisL = deriveLegSummary(thisSeg);
  const priorL = deriveLegSummary(priorSeg);
  if (!thisL || !priorL) return null;
  const durationDeltaSec = thisL.durationSec - priorL.durationSec;
  const npDelta = thisL.np != null && priorL.np != null ? round1(thisL.np - priorL.np) : null;
  const paceDelta = thisL.pace != null && priorL.pace != null ? thisL.pace - priorL.pace : null;
  const avgHrDelta = thisL.avgHr != null && priorL.avgHr != null ? round1(thisL.avgHr - priorL.avgHr) : null;
  return {
    durationDeltaSec,
    npDelta,
    paceDelta,
    avgHrDelta,
    thisDurationSec: thisL.durationSec,
    priorDurationSec: priorL.durationSec
  };
}

export function buildTransitionsDelta(
  thisSegments: SegmentRow[],
  priorSegments: SegmentRow[]
): { t1Sec: number | null; t2Sec: number | null } {
  return {
    t1Sec: deltaSegmentDuration(thisSegments, priorSegments, "t1"),
    t2Sec: deltaSegmentDuration(thisSegments, priorSegments, "t2")
  };
}

function deltaSegmentDuration(
  thisSegments: SegmentRow[],
  priorSegments: SegmentRow[],
  role: "t1" | "t2"
): number | null {
  const t = thisSegments.find((s) => s.race_segment_role === role);
  const p = priorSegments.find((s) => s.race_segment_role === role);
  if (!t || !p) return null;
  return Number(t.duration_sec ?? 0) - Number(p.duration_sec ?? 0);
}

export function buildDeterministicProgressionNarrative(payload: ComparisonPayload): ProgressionNarrative {
  const { thisRace, priorRace, finishDeltaSec, perLeg } = payload;
  const improved = finishDeltaSec < 0;
  const absDelta = formatDuration(Math.abs(finishDeltaSec));
  const sign = improved ? "improvement" : "regression";
  const priorLabel = priorRace.name ?? `prior ${priorRace.distanceType ?? "race"}`;
  const headline = `From ${priorLabel} to today: ${absDelta} ${sign}.`;

  const perDiscipline = {
    swim: legSentence("Swim", perLeg.swim, "pace"),
    bike: legSentence("Bike", perLeg.bike, "np"),
    run: legSentence("Run", perLeg.run, "pace")
  };

  const totalThis = thisRace.finishSec;
  const totalPrior = priorRace.finishSec;
  const pct = totalPrior > 0 ? Math.abs(finishDeltaSec) / totalPrior : 0;
  const pctLabel = (pct * 100).toFixed(1);
  const netDelta = improved
    ? `Net ${absDelta} faster (${pctLabel}%) over the same distance.`
    : `Net ${absDelta} slower (${pctLabel}%) over the same distance.`;

  return { headline, perDiscipline, netDelta, emergedThemes: [] };
}

function legSentence(
  label: string,
  delta: LegDelta | null,
  preferAxis: "np" | "pace"
): string | null {
  if (!delta) return null;
  const dur = delta.durationDeltaSec;
  const durLabel = dur === 0
    ? "held even"
    : dur < 0
    ? `${formatDuration(Math.abs(dur))} faster`
    : `${formatDuration(Math.abs(dur))} slower`;

  if (preferAxis === "np" && delta.npDelta != null) {
    const npLabel = delta.npDelta === 0
      ? "NP held within 1W"
      : delta.npDelta > 0
      ? `${Math.abs(delta.npDelta)}W higher NP`
      : `${Math.abs(delta.npDelta)}W lower NP`;
    return `${label}: ${durLabel}, ${npLabel}.`;
  }
  if (preferAxis === "pace" && delta.paceDelta != null) {
    const paceSec = Math.abs(delta.paceDelta);
    const paceLabel = delta.paceDelta === 0
      ? "pace held"
      : delta.paceDelta < 0
      ? `${Math.round(paceSec)}s/unit faster`
      : `${Math.round(paceSec)}s/unit slower`;
    return `${label}: ${durLabel}, ${paceLabel}.`;
  }
  return `${label}: ${durLabel}.`;
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Loaders ────────────────────────────────────────────────────────────────

async function loadBundleRow(supabase: SupabaseClient, userId: string, bundleId: string): Promise<BundleRow | null> {
  const { data } = await supabase
    .from("race_bundles")
    .select(
      "id,user_id,started_at,total_duration_sec,goal_time_sec,race_profile_id,pre_race_ctl,pre_race_atl,pre_race_tsb,taper_compliance_score"
    )
    .eq("user_id", userId)
    .eq("id", bundleId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    started_at: r.started_at as string,
    total_duration_sec: Number(r.total_duration_sec ?? 0),
    goal_time_sec: r.goal_time_sec != null ? Number(r.goal_time_sec) : null,
    race_profile_id: (r.race_profile_id as string | null) ?? null,
    pre_race_ctl: r.pre_race_ctl != null ? Number(r.pre_race_ctl) : null,
    pre_race_atl: r.pre_race_atl != null ? Number(r.pre_race_atl) : null,
    pre_race_tsb: r.pre_race_tsb != null ? Number(r.pre_race_tsb) : null,
    taper_compliance_score: r.taper_compliance_score != null ? Number(r.taper_compliance_score) : null
  };
}

async function loadProfileRow(supabase: SupabaseClient, userId: string, profileId: string | null): Promise<ProfileRow | null> {
  if (!profileId) return null;
  const { data } = await supabase
    .from("race_profiles")
    .select("id,name,date,distance_type")
    .eq("user_id", userId)
    .eq("id", profileId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    name: (r.name as string | null) ?? null,
    date: r.date as string,
    distance_type: (r.distance_type as string | null) ?? null
  };
}

async function loadSegmentRows(supabase: SupabaseClient, userId: string, bundleId: string): Promise<SegmentRow[]> {
  const { data } = await supabase
    .from("completed_activities")
    .select("id,race_segment_role,duration_sec,distance_m,avg_hr,avg_power,metrics_v2")
    .eq("user_id", userId)
    .eq("race_bundle_id", bundleId);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      race_segment_role: (row.race_segment_role as string | null) ?? null,
      duration_sec: Number(row.duration_sec ?? 0),
      distance_m: row.distance_m != null ? Number(row.distance_m) : null,
      avg_hr: row.avg_hr != null ? Number(row.avg_hr) : null,
      avg_power: row.avg_power != null ? Number(row.avg_power) : null,
      metrics_v2: (row.metrics_v2 as Record<string, unknown> | null) ?? null
    };
  });
}

// ─── Public: list candidate prior bundles ───────────────────────────────────

export type PriorRaceCandidate = {
  bundleId: string;
  raceProfileId: string | null;
  name: string | null;
  date: string;
  distanceType: string | null;
  finishSec: number;
  goalSec: number | null;
};

/**
 * Load prior race bundles (older than `bundleId` and at the same
 * `distance_type` as the bundle's race profile) ordered newest-first.
 * Used by the comparison picker.
 */
export async function loadPriorRaceCandidates(
  supabase: SupabaseClient,
  userId: string,
  bundleId: string
): Promise<PriorRaceCandidate[]> {
  const thisBundle = await loadBundleRow(supabase, userId, bundleId);
  if (!thisBundle) return [];
  const thisProfile = await loadProfileRow(supabase, userId, thisBundle.race_profile_id);
  const distanceType = thisProfile?.distance_type ?? null;
  if (!distanceType) return [];

  // Pull all earlier bundles for this user.
  const { data: bundleRows } = await supabase
    .from("race_bundles")
    .select("id,started_at,total_duration_sec,goal_time_sec,race_profile_id")
    .eq("user_id", userId)
    .neq("id", bundleId)
    .lt("started_at", thisBundle.started_at)
    .order("started_at", { ascending: false })
    .limit(20);
  const rows = (bundleRows ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const profileIds = Array.from(
    new Set(rows.map((r) => r.race_profile_id as string | null).filter((id): id is string => Boolean(id)))
  );
  const profileMap = new Map<string, ProfileRow>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("race_profiles")
      .select("id,name,date,distance_type")
      .eq("user_id", userId)
      .in("id", profileIds);
    for (const p of profiles ?? []) {
      const pr = p as Record<string, unknown>;
      profileMap.set(pr.id as string, {
        id: pr.id as string,
        name: (pr.name as string | null) ?? null,
        date: pr.date as string,
        distance_type: (pr.distance_type as string | null) ?? null
      });
    }
  }

  const out: PriorRaceCandidate[] = [];
  for (const row of rows) {
    const profileId = (row.race_profile_id as string | null) ?? null;
    const profile = profileId ? profileMap.get(profileId) ?? null : null;
    if (!profile || profile.distance_type !== distanceType) continue;
    out.push({
      bundleId: row.id as string,
      raceProfileId: profileId,
      name: profile.name,
      date: (row.started_at as string).slice(0, 10),
      distanceType: profile.distance_type,
      finishSec: Number(row.total_duration_sec ?? 0),
      goalSec: row.goal_time_sec != null ? Number(row.goal_time_sec) : null
    });
  }
  return out;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export async function buildRaceComparison(args: GenerateComparisonArgs): Promise<GenerateComparisonResult> {
  const { supabase, userId, bundleId, priorBundleId, skipAi } = args;
  if (bundleId === priorBundleId) {
    return { status: "skipped", reason: "same_bundle" };
  }

  const [thisBundle, priorBundle] = await Promise.all([
    loadBundleRow(supabase, userId, bundleId),
    loadBundleRow(supabase, userId, priorBundleId)
  ]);
  if (!thisBundle || !priorBundle) {
    return { status: "skipped", reason: "bundle_not_found" };
  }

  const [thisProfile, priorProfile] = await Promise.all([
    loadProfileRow(supabase, userId, thisBundle.race_profile_id),
    loadProfileRow(supabase, userId, priorBundle.race_profile_id)
  ]);

  if (!thisProfile || !priorProfile) {
    return { status: "skipped", reason: "race_profile_missing" };
  }
  if (thisProfile.distance_type !== priorProfile.distance_type) {
    return { status: "skipped", reason: "incompatible_distance" };
  }

  const [thisSegments, priorSegments] = await Promise.all([
    loadSegmentRows(supabase, userId, bundleId),
    loadSegmentRows(supabase, userId, priorBundleId)
  ]);

  const findSeg = (segs: SegmentRow[], role: string) => segs.find((s) => s.race_segment_role === role) ?? null;

  const payload: ComparisonPayload = {
    thisRace: bundleToLite(thisBundle, thisProfile),
    priorRace: bundleToLite(priorBundle, priorProfile),
    finishDeltaSec: thisBundle.total_duration_sec - priorBundle.total_duration_sec,
    perLeg: {
      swim: buildLegDelta(findSeg(thisSegments, "swim"), findSeg(priorSegments, "swim")),
      bike: buildLegDelta(findSeg(thisSegments, "bike"), findSeg(priorSegments, "bike")),
      run: buildLegDelta(findSeg(thisSegments, "run"), findSeg(priorSegments, "run"))
    },
    transitionsDelta: buildTransitionsDelta(thisSegments, priorSegments),
    preRaceStateDelta: {
      ctl: deltaOrNull(thisBundle.pre_race_ctl, priorBundle.pre_race_ctl),
      atl: deltaOrNull(thisBundle.pre_race_atl, priorBundle.pre_race_atl),
      tsb: deltaOrNull(thisBundle.pre_race_tsb, priorBundle.pre_race_tsb),
      taperCompliance: deltaOrNull(thisBundle.taper_compliance_score, priorBundle.taper_compliance_score)
    }
  };

  // Validate the deterministic payload before persistence so we never
  // store a misshapen jsonb.
  comparisonPayloadSchema.parse(payload);

  const fallbackNarrative = buildDeterministicProgressionNarrative(payload);

  let narrative: ProgressionNarrative;
  let source: "ai" | "fallback";

  if (skipAi) {
    narrative = fallbackNarrative;
    source = "fallback";
  } else {
    const aiAttempt = await callOpenAIWithFallback({
      logTag: "race-review-comparison",
      fallback: fallbackNarrative,
      buildRequest: () => ({
        instructions: buildComparisonInstructions(),
        reasoning: { effort: "low" },
        max_output_tokens: 800,
        text: {
          format: zodTextFormat(progressionNarrativeSchema, "progression_narrative", {
            description: "Two-race progression narrative grounded in deterministic per-leg + finish deltas."
          })
        },
        input: [
          {
            role: "user" as const,
            content: [
              {
                type: "input_text" as const,
                text: JSON.stringify({ payload })
              }
            ]
          }
        ]
      }),
      schema: progressionNarrativeSchema,
      logContext: { bundleId, priorBundleId }
    });
    narrative = aiAttempt.value;
    source = aiAttempt.source;
  }

  return { status: "ok", payload, narrative, source };
}

function bundleToLite(b: BundleRow, p: ProfileRow): RaceLite {
  return {
    bundleId: b.id,
    raceProfileId: p.id,
    name: p.name,
    date: b.started_at.slice(0, 10),
    distanceType: p.distance_type,
    finishSec: b.total_duration_sec,
    goalSec: b.goal_time_sec
  };
}

function deltaOrNull(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return Math.round((a - b) * 100) / 100;
}

// ─── Persistence helpers ────────────────────────────────────────────────────

/**
 * Look up a cached comparison row (race_comparisons) for the pair.
 * Returns null when no row exists.
 */
export async function loadCachedComparison(
  supabase: SupabaseClient,
  userId: string,
  bundleId: string,
  priorBundleId: string
): Promise<{
  payload: ComparisonPayload;
  narrative: ProgressionNarrative | null;
  generatedAt: string;
} | null> {
  const { data } = await supabase
    .from("race_comparisons")
    .select("comparison_payload,progression_narrative,generated_at")
    .eq("user_id", userId)
    .eq("race_bundle_id", bundleId)
    .eq("prior_bundle_id", priorBundleId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const parsedPayload = comparisonPayloadSchema.safeParse(r.comparison_payload);
  if (!parsedPayload.success) return null;
  const parsedNarrative = r.progression_narrative
    ? progressionNarrativeSchema.safeParse(r.progression_narrative)
    : null;
  return {
    payload: parsedPayload.data,
    narrative: parsedNarrative && parsedNarrative.success ? parsedNarrative.data : null,
    generatedAt: r.generated_at as string
  };
}

/**
 * Generate-if-missing helper. If a cached row exists, returns it. Otherwise
 * runs the orchestrator and persists. Used by the API route + coach tool.
 */
export async function getOrGenerateRaceComparison(args: GenerateComparisonArgs): Promise<GenerateComparisonResult> {
  const cached = await loadCachedComparison(args.supabase, args.userId, args.bundleId, args.priorBundleId);
  if (cached && cached.narrative) {
    return {
      status: "ok",
      payload: cached.payload,
      narrative: cached.narrative,
      source: "ai" // we trust whatever was stored; UI may show source from race_comparisons.model_used if needed
    };
  }
  const result = await buildRaceComparison(args);
  if (result.status !== "ok") return result;

  await args.supabase.from("race_comparisons").upsert(
    {
      user_id: args.userId,
      race_bundle_id: args.bundleId,
      prior_bundle_id: args.priorBundleId,
      comparison_payload: result.payload,
      progression_narrative: result.narrative,
      model_used: result.source === "ai" ? "ai" : "fallback",
      is_provisional: result.source === "fallback",
      generated_at: new Date().toISOString()
    },
    { onConflict: "race_bundle_id,prior_bundle_id" }
  );

  return result;
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function buildComparisonInstructions(): string {
  return [
    "You are writing a race-to-race progression narrative for two races of identical distance type.",
    "Input: deterministic ComparisonPayload — per-leg / finish / IF deltas, pre-race state delta.",
    "",
    "Write JSON with: headline, perDiscipline:{swim,bike,run}, netDelta, emergedThemes (≤3).",
    "",
    "Tone rules (HARD):",
    "- Never use 'should have', 'failed', 'missed' as moralising verbs.",
    "- Cite at least one specific number per non-null perDiscipline sentence.",
    "- If a leg's delta is null on the input, that perDiscipline field must also be null — do not invent.",
    "- Improvements get direct framing ('the bike held within 5W'). Regressions get diagnostic framing ('bike came in 3% slower at similar HR').",
    "",
    "Length budgets: headline ≤140, netDelta ≤220, each perDiscipline sentence ≤200, each emergedThemes entry ≤160."
  ].join("\n");
}
