/**
 * AI race review — Layer 4: Lessons.
 *
 * Forward-looking artifacts that turn a single race into permanent training
 * intelligence. Loads the just-generated race review for this bundle plus
 * the most-recent prior reviews for the same athlete (optionally filtered
 * to the same distance type), then produces:
 *
 *   1. Athlete-profile takeaways (1–3, generalisable patterns).
 *   2. Training implications (1–3, concrete next-block changes).
 *   3. A single carry-forward insight surfaced during next race-week prep.
 *
 * Confidence on each takeaway is computed deterministically from how many
 * prior races the lesson references — the AI does not get to overstate
 * certainty.
 *
 * After persistence, mark all prior race_lessons rows for the athlete
 * superseded_by_race_id = this bundle so consumers know which reading is
 * current.
 *
 * Triggered as a fire-and-forget tail call from generateRaceReview after
 * the race_reviews row is upserted; also re-runs on manual regenerate.
 */

import "openai/shims/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import { getCoachModel } from "@/lib/openai";
import {
  raceLessonsAiSchema,
  TAKEAWAY_CONFIDENCE_LABELS,
  IMPLICATION_PRIORITY_LABELS,
  type RaceLessons,
  type AthleteProfileTakeaway,
  type TrainingImplication,
  type CarryForward
} from "./lessons-schemas";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GenerateRaceLessonsArgs = {
  supabase: SupabaseClient;
  userId: string;
  bundleId: string;
};

export type GenerateRaceLessonsResult =
  | { status: "ok"; lessonsId: string; source: "ai" | "fallback"; supersededCount: number }
  | { status: "skipped"; reason: string };

type ThisRaceContext = {
  bundleId: string;
  raceName: string | null;
  raceDate: string;
  distanceType: string | null;
  finishSec: number;
  goalSec: number | null;
  goalDeltaSec: number | null;
  verdict: unknown;
  raceStory: unknown;
  legStatus: unknown;
  segmentDiagnostics: unknown;
  athleteRating: number | null;
  athleteNotes: string | null;
  issuesFlagged: string[];
  emotionalFrame: string | null;
  crossDisciplineInsight: string | null;
};

type PriorRaceContext = {
  bundleId: string;
  raceName: string | null;
  raceDate: string;
  distanceType: string | null;
  finishSec: number;
  goalSec: number | null;
  goalDeltaSec: number | null;
  verdict: unknown;
  legStatus: unknown;
  primaryFinding: string | null;
};

// ─── Loaders ────────────────────────────────────────────────────────────────

const REVIEW_COLUMNS_FOR_LESSONS =
  "id,race_bundle_id,verdict,race_story,leg_status,segment_diagnostics," +
  "emotional_frame,cross_discipline_insight,headline,coach_take,generated_at";

const BUNDLE_COLUMNS_FOR_LESSONS =
  "id,user_id,started_at,total_duration_sec,goal_time_sec," +
  "race_profile_id,athlete_rating,athlete_notes,issues_flagged";

async function loadThisRace(
  supabase: SupabaseClient,
  userId: string,
  bundleId: string
): Promise<{ ctx: ThisRaceContext; reviewId: string } | null> {
  const { data: bundleRow, error: bundleErr } = await supabase
    .from("race_bundles")
    .select(BUNDLE_COLUMNS_FOR_LESSONS)
    .eq("id", bundleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (bundleErr) throw new Error(`race_bundles select failed: ${bundleErr.message}`);
  if (!bundleRow) return null;

  const bundle = bundleRow as unknown as Record<string, unknown>;
  const raceProfileId = (bundle.race_profile_id as string | null) ?? null;
  const startedAt = bundle.started_at as string;

  let raceName: string | null = null;
  let distanceType: string | null = null;
  if (raceProfileId) {
    const { data: profile } = await supabase
      .from("race_profiles")
      .select("name,distance_type")
      .eq("id", raceProfileId)
      .eq("user_id", userId)
      .maybeSingle();
    if (profile) {
      raceName = (profile.name as string | null) ?? null;
      distanceType = (profile.distance_type as string | null) ?? null;
    }
  }

  const { data: reviewRow } = await supabase
    .from("race_reviews")
    .select(REVIEW_COLUMNS_FOR_LESSONS)
    .eq("race_bundle_id", bundleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!reviewRow) return null;
  const review = reviewRow as unknown as Record<string, unknown>;

  const finishSec = Number(bundle.total_duration_sec ?? 0);
  const goalSec = bundle.goal_time_sec != null ? Number(bundle.goal_time_sec) : null;
  const goalDeltaSec = goalSec !== null ? finishSec - goalSec : null;

  return {
    ctx: {
      bundleId,
      raceName,
      raceDate: startedAt.slice(0, 10),
      distanceType,
      finishSec,
      goalSec,
      goalDeltaSec,
      verdict: review.verdict ?? null,
      raceStory: review.race_story ?? null,
      legStatus: review.leg_status ?? null,
      segmentDiagnostics: review.segment_diagnostics ?? null,
      athleteRating: bundle.athlete_rating != null ? Number(bundle.athlete_rating) : null,
      athleteNotes: (bundle.athlete_notes as string | null) ?? null,
      issuesFlagged: Array.isArray(bundle.issues_flagged) ? (bundle.issues_flagged as string[]) : [],
      emotionalFrame: (review.emotional_frame as string | null) ?? null,
      crossDisciplineInsight: (review.cross_discipline_insight as string | null) ?? null
    },
    reviewId: review.id as string
  };
}

/**
 * Newest-first prior race contexts for this athlete. By default we filter
 * to the same distance type — cross-distance comparisons risk inventing
 * patterns that don't generalise. When fewer than 2 same-distance priors
 * exist we still let the AI see them; we just don't widen the search.
 *
 * Returns an empty array when this is the athlete's first race.
 */
async function loadPriorRaces(
  supabase: SupabaseClient,
  userId: string,
  thisBundleId: string,
  thisRaceDate: string,
  distanceType: string | null,
  limit = 5
): Promise<PriorRaceContext[]> {
  const { data: bundles } = await supabase
    .from("race_bundles")
    .select("id,started_at,total_duration_sec,goal_time_sec,race_profile_id")
    .eq("user_id", userId)
    .neq("id", thisBundleId)
    .lt("started_at", `${thisRaceDate}T23:59:59.999Z`)
    .order("started_at", { ascending: false })
    .limit(limit * 3);

  if (!bundles || bundles.length === 0) return [];

  const profileIds = Array.from(
    new Set(
      bundles
        .map((b: any) => b.race_profile_id as string | null)
        .filter((id): id is string => typeof id === "string")
    )
  );
  const profileMap = new Map<string, { name: string | null; distanceType: string | null }>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("race_profiles")
      .select("id,name,distance_type")
      .eq("user_id", userId)
      .in("id", profileIds);
    for (const p of profiles ?? []) {
      profileMap.set((p as any).id as string, {
        name: ((p as any).name as string | null) ?? null,
        distanceType: ((p as any).distance_type as string | null) ?? null
      });
    }
  }

  const candidateBundleIds = bundles.map((b: any) => b.id as string);
  const { data: reviews } = await supabase
    .from("race_reviews")
    .select("race_bundle_id,verdict,leg_status,coach_take,headline")
    .eq("user_id", userId)
    .in("race_bundle_id", candidateBundleIds);
  const reviewMap = new Map<string, Record<string, unknown>>();
  for (const r of reviews ?? []) {
    reviewMap.set((r as any).race_bundle_id as string, r as unknown as Record<string, unknown>);
  }

  const out: PriorRaceContext[] = [];
  for (const b of bundles) {
    const bundleId = (b as any).id as string;
    const profile = ((b as any).race_profile_id as string | null) != null
      ? profileMap.get((b as any).race_profile_id as string)
      : undefined;
    const priorDistance = profile?.distanceType ?? null;
    if (distanceType && priorDistance && priorDistance !== distanceType) continue;
    const review = reviewMap.get(bundleId);
    if (!review) continue;
    const finishSec = Number((b as any).total_duration_sec ?? 0);
    const goalSec = (b as any).goal_time_sec != null ? Number((b as any).goal_time_sec) : null;
    out.push({
      bundleId,
      raceName: profile?.name ?? null,
      raceDate: ((b as any).started_at as string).slice(0, 10),
      distanceType: priorDistance,
      finishSec,
      goalSec,
      goalDeltaSec: goalSec !== null ? finishSec - goalSec : null,
      verdict: review.verdict ?? null,
      legStatus: review.leg_status ?? null,
      primaryFinding:
        typeof review.coach_take === "string"
          ? review.coach_take
          : typeof review.headline === "string"
            ? review.headline
            : null
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Confidence calibration ─────────────────────────────────────────────────

/**
 * Per the spec:
 *   low — this race only (0 prior races)
 *   medium — 2 races (1 prior)
 *   high — 3+ races (≥2 priors)
 */
function calibrateConfidence(priorCount: number): "low" | "medium" | "high" {
  if (priorCount >= 2) return "high";
  if (priorCount === 1) return "medium";
  return "low";
}

// ─── Prompt builders ────────────────────────────────────────────────────────

export function buildLessonsInstructions(): string {
  return [
    "You are TriCoach AI, writing AI Layer 4 — Lessons. This is the forward-looking layer of the race review. The athlete will read this DURING THE NEXT TRAINING BLOCK and AGAIN ON THE NEXT RACE MORNING. Treat it as advice you have to stand behind.",
    "",
    "OUTPUT three artifacts:",
    "",
    "1. athleteProfileTakeaways (1–3 entries)",
    "   - Each is a GENERALISABLE pattern about who the athlete is as a racer.",
    "   - 'You went too hard on the bike today' is a finding, NOT a lesson.",
    "   - 'You go too hard on the bike at A-priority races but pace correctly for B races' is a lesson.",
    "   - Set confidence to one of: " + TAKEAWAY_CONFIDENCE_LABELS.join(", ") + ". Use 'high' ONLY when the input contains 2+ prior races AND the takeaway cites at least two of them. Use 'medium' with 1 prior race. Use 'low' for first-race-only patterns.",
    "   - referencesCount: integer — how many prior races the takeaway draws on (0 if none).",
    "   - body must cite specific numbers from the input.",
    "",
    "2. trainingImplications (1–3 entries)",
    "   - Each is a CONCRETE numbered change for the next training block.",
    "   - priority: " + IMPLICATION_PRIORITY_LABELS.join(", ") + ". Use 'high' for the change that addresses the primary loss segment from this race. 'medium' for secondary findings, 'low' for refinements.",
    "   - change MUST contain a specific number (watts, pace, weeks, % volume, etc.).",
    "   - rationale ties the change back to a finding from this race (verdict, segment_diagnostics, etc.).",
    "",
    "3. carryForward (single object OR null)",
    "   - One portable insight the athlete sees on the morning of their NEXT race.",
    "   - headline: ≤120 chars, written as if speaking to the athlete on race morning.",
    "   - instruction: MUST contain a digit. 'Open the bike at 155W not 165W' — yes. 'Trust your taper' — no.",
    "   - successCriterion: one objective line — what 'good' looks like.",
    "   - expiresAfterRaceId: pass through the placeholder string 'THIS_BUNDLE_ID' — the orchestrator will replace it.",
    "   - Return null ONLY when there is no specific, numerical instruction worth carrying forward.",
    "",
    "QUALITY RULES — HARD:",
    "- Prefer FEWER high-quality entries over filling slots. 1 strong takeaway > 3 weak ones.",
    "- Do NOT invent cross-race patterns. If priorRaces is empty, every takeaway is confidence='low' and referencesCount=0.",
    "- Do NOT moralise. Use 'tend to', 'come in at', 'open at', 'eased', 'held'. Avoid 'should have', 'must', 'failed'.",
    "- HONOR the athlete's account. If notes mention illness/mechanical/GI, do not turn that into a fitness pattern.",
    "- Numbers cited MUST be present in the input.",
    "",
    "Inputs (JSON):",
    "- thisRace: this race's verdict + race story + leg status + segment diagnostics + subjective state.",
    "- priorRaces[]: most-recent-first prior races (same distance type) with verdict + leg status + primary finding.",
    "- raceCount: total number of races including this one.",
    "- distanceType: the race distance type (sprint/olympic/70.3/ironman/...) — null when unknown."
  ].join("\n");
}

export function buildLessonsInput(thisRace: ThisRaceContext, priorRaces: PriorRaceContext[]): unknown {
  return {
    thisRace: {
      bundleId: thisRace.bundleId,
      raceName: thisRace.raceName,
      raceDate: thisRace.raceDate,
      distanceType: thisRace.distanceType,
      finishSec: thisRace.finishSec,
      goalSec: thisRace.goalSec,
      goalDeltaSec: thisRace.goalDeltaSec,
      verdict: thisRace.verdict,
      raceStory: thisRace.raceStory,
      legStatus: thisRace.legStatus,
      segmentDiagnostics: thisRace.segmentDiagnostics,
      athleteRating: thisRace.athleteRating,
      athleteNotes: thisRace.athleteNotes,
      issuesFlagged: thisRace.issuesFlagged,
      emotionalFrame: thisRace.emotionalFrame,
      crossDisciplineInsight: thisRace.crossDisciplineInsight
    },
    priorRaces: priorRaces.map((r) => ({
      bundleId: r.bundleId,
      raceName: r.raceName,
      raceDate: r.raceDate,
      distanceType: r.distanceType,
      finishSec: r.finishSec,
      goalSec: r.goalSec,
      goalDeltaSec: r.goalDeltaSec,
      verdict: r.verdict,
      legStatus: r.legStatus,
      primaryFinding: r.primaryFinding
    })),
    raceCount: priorRaces.length + 1,
    distanceType: thisRace.distanceType
  };
}

// ─── Deterministic fallback ─────────────────────────────────────────────────

export function buildDeterministicLessons(
  thisRace: ThisRaceContext,
  priorRaces: PriorRaceContext[]
): RaceLessons {
  const confidence = calibrateConfidence(priorRaces.length);
  const referencesCount = priorRaces.length;

  // Pick a primary loss segment from leg_status if available.
  const legStatus = (thisRace.legStatus ?? {}) as Record<
    string,
    { label?: string; evidence?: string[] } | null
  >;
  const order = ["bike", "run", "swim"] as const;
  let lossLeg: "bike" | "run" | "swim" | null = null;
  for (const leg of order) {
    const entry = legStatus[leg];
    if (!entry) continue;
    const label = entry.label;
    if (label === "faded" || label === "cooked" || label === "over") {
      lossLeg = leg;
      break;
    }
  }

  const goalDeltaLabel = thisRace.goalDeltaSec !== null
    ? formatSignedDuration(thisRace.goalDeltaSec)
    : null;
  const finishLabel = formatDuration(thisRace.finishSec);
  const goalLabel = thisRace.goalSec !== null ? formatDuration(thisRace.goalSec) : null;

  const takeaways: AthleteProfileTakeaway[] = [
    {
      headline:
        priorRaces.length === 0
          ? `First ${thisRace.distanceType ?? "race"} on record — single-race read only`
          : `Across ${priorRaces.length + 1} ${thisRace.distanceType ?? "race"}${priorRaces.length + 1 === 1 ? "" : "s"}, current read holds`,
      body:
        priorRaces.length === 0
          ? `Finish ${finishLabel}${goalLabel ? ` vs goal ${goalLabel} (${goalDeltaLabel})` : ""}. One race is too few to call a pattern — the next race will calibrate confidence.`
          : `Current race finish ${finishLabel}${goalLabel ? ` vs goal ${goalLabel} (${goalDeltaLabel})` : ""}. Reading reflects ${priorRaces.length + 1} race${priorRaces.length + 1 === 1 ? "" : "s"} on file.`,
      confidence,
      referencesCount
    }
  ];

  const trainingImplications: TrainingImplication[] = [
    {
      headline: lossLeg
        ? `Tighten ${lossLeg} pacing in the next block`
        : "Hold the structure that produced this race",
      change: lossLeg
        ? `Add 1 ${lossLeg}-pace session per week for the next 4 weeks at the pacing target this race exposed.`
        : `Repeat 1 race-pace session per week for the next 4 weeks; hold current load.`,
      priority: lossLeg ? "high" : "medium",
      rationale: lossLeg
        ? `Leg status flagged ${lossLeg} as the primary loss segment.`
        : `No discipline flagged a clear loss; the work is to consolidate.`
    }
  ];

  // Carry-forward only when we have a numerical hook.
  let carryForward: CarryForward | null = null;
  if (lossLeg && thisRace.goalSec !== null) {
    carryForward = {
      headline: `Open the ${lossLeg} controlled, not chasing pace`,
      instruction: `Open ${lossLeg} 1–2% under your race-pace target for the first 5 minutes; only let HR/power rise after that window.`,
      successCriterion: `Halves move <2% on ${lossLeg}; no fade in the second half.`,
      expiresAfterRaceId: thisRace.bundleId
    };
  }

  return {
    athleteProfileTakeaways: takeaways,
    trainingImplications,
    carryForward
  };
}

// ─── Deterministic gate enforcement ─────────────────────────────────────────

/**
 * Force the values the AI does not get to decide:
 *   - confidence on every takeaway = calibration from prior race count
 *   - referencesCount = priorRaces.length (the AI cannot inflate this)
 *   - carryForward.expiresAfterRaceId = this bundle id (the AI sees a
 *     placeholder)
 */
function enforceLessonGates(
  raw: RaceLessons,
  thisRace: ThisRaceContext,
  priorRaces: PriorRaceContext[]
): RaceLessons {
  const calibrated = calibrateConfidence(priorRaces.length);
  const ref = priorRaces.length;
  return {
    athleteProfileTakeaways: raw.athleteProfileTakeaways.map((t) => ({
      ...t,
      confidence: calibrated,
      referencesCount: Math.min(t.referencesCount ?? ref, ref)
    })),
    trainingImplications: raw.trainingImplications,
    carryForward: raw.carryForward
      ? {
          ...raw.carryForward,
          expiresAfterRaceId: thisRace.bundleId
        }
      : null
  };
}

/**
 * Sanity check. Returns a string reason to reject the AI output (so we fall
 * back to deterministic), or undefined to accept. Spec rule: "Carry-forward
 * must be actionable on race morning" — we enforce that the instruction
 * contains at least one digit, mirroring "must contain a specific number".
 */
export function lessonsSanityCheck(parsed: RaceLessons): string | undefined {
  if (parsed.carryForward && !/\d/.test(parsed.carryForward.instruction)) {
    return "carry-forward instruction missing a number";
  }
  for (const t of parsed.athleteProfileTakeaways) {
    if (!t.body.trim()) return "empty takeaway body";
  }
  for (const i of parsed.trainingImplications) {
    if (!/\d/.test(i.change)) return `training implication missing a number: ${i.headline}`;
  }
  return undefined;
}

// ─── Persistence ────────────────────────────────────────────────────────────

/**
 * Recompute supersession for every race_lessons row owned by `userId` from
 * race chronology — NOT lesson generation timestamps. The active reading
 * is whichever race (by race_bundles.started_at) is most recent. Every
 * other row is superseded by that race's bundle id.
 *
 * This is called after every upsert. Doing a full recompute (instead of a
 * differential sweep) keeps the invariant correct even when the athlete
 * regenerates an older race: the older row gets re-superseded by the
 * already-existing newer race instead of becoming "current" again.
 *
 * Returns the number of rows updated to a different supersession value.
 */
export async function recomputeSupersession(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { data: lessons, error: lessonsErr } = await supabase
    .from("race_lessons")
    .select("id,race_bundle_id,superseded_by_race_id")
    .eq("user_id", userId);
  if (lessonsErr || !lessons || lessons.length === 0) return 0;

  const bundleIds = Array.from(
    new Set(lessons.map((row) => (row as any).race_bundle_id as string))
  );

  const { data: bundles, error: bundlesErr } = await supabase
    .from("race_bundles")
    .select("id,started_at")
    .eq("user_id", userId)
    .in("id", bundleIds);
  if (bundlesErr || !bundles) return 0;

  const startedAtByBundle = new Map<string, string>();
  for (const b of bundles) {
    startedAtByBundle.set((b as any).id as string, (b as any).started_at as string);
  }

  // Identify the most-recent race that has lessons. That's the active row;
  // all others become superseded by it.
  let latestBundleId: string | null = null;
  let latestStartedAt: string | null = null;
  for (const row of lessons) {
    const bundleId = (row as any).race_bundle_id as string;
    const startedAt = startedAtByBundle.get(bundleId);
    if (!startedAt) continue;
    if (latestStartedAt === null || startedAt > latestStartedAt) {
      latestStartedAt = startedAt;
      latestBundleId = bundleId;
    }
  }
  if (!latestBundleId) return 0;

  let changed = 0;
  for (const row of lessons) {
    const id = (row as any).id as string;
    const bundleId = (row as any).race_bundle_id as string;
    const current = ((row as any).superseded_by_race_id as string | null) ?? null;
    const desired = bundleId === latestBundleId ? null : latestBundleId;
    if (current === desired) continue;
    const { error: updateErr } = await supabase
      .from("race_lessons")
      .update({ superseded_by_race_id: desired })
      .eq("id", id)
      .eq("user_id", userId);
    if (updateErr) {
      console.warn("[race-lessons] supersession update failed", {
        id,
        error: updateErr.message
      });
      continue;
    }
    changed += 1;
  }
  return changed;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function generateRaceLessons(
  args: GenerateRaceLessonsArgs
): Promise<GenerateRaceLessonsResult> {
  const { supabase, userId, bundleId } = args;

  const loaded = await loadThisRace(supabase, userId, bundleId);
  if (!loaded) return { status: "skipped", reason: "review_not_found" };
  const { ctx: thisRace, reviewId } = loaded;

  const priorRaces = await loadPriorRaces(
    supabase,
    userId,
    bundleId,
    thisRace.raceDate,
    thisRace.distanceType
  );

  const fallback = buildDeterministicLessons(thisRace, priorRaces);

  const attempt = await callOpenAIWithFallback<RaceLessons>({
    logTag: "race-lessons",
    fallback,
    buildRequest: () => ({
      instructions: buildLessonsInstructions(),
      reasoning: { effort: "low" },
      max_output_tokens: 2400,
      text: {
        format: zodTextFormat(raceLessonsAiSchema, "race_lessons", {
          description: "Layer 4 — Lessons: takeaways, training implications, and carry-forward."
        })
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify(buildLessonsInput(thisRace, priorRaces))
            }
          ]
        }
      ]
    }),
    schema: raceLessonsAiSchema,
    sanityCheck: lessonsSanityCheck,
    logContext: { bundleId, priorRaceCount: priorRaces.length }
  });

  const lessons = enforceLessonGates(attempt.value, thisRace, priorRaces);
  const isProvisional = attempt.source === "fallback";
  const modelUsed = attempt.source === "ai" ? getCoachModel() : "fallback";

  const referencesRaceIds = priorRaces.map((r) => r.bundleId);

  // Note: we deliberately do NOT write superseded_by_race_id in the upsert
  // payload. recomputeSupersession runs after the row lands and assigns
  // every row's supersession from race chronology — so regenerating an
  // older race doesn't accidentally make it "current" again.
  const { data: upsertData, error: upsertError } = await supabase
    .from("race_lessons")
    .upsert(
      {
        user_id: userId,
        race_bundle_id: bundleId,
        race_review_id: reviewId,
        athlete_profile_takeaways: lessons.athleteProfileTakeaways,
        training_implications: lessons.trainingImplications,
        carry_forward: lessons.carryForward,
        references_race_ids: referencesRaceIds,
        model_used: modelUsed,
        is_provisional: isProvisional,
        generated_at: new Date().toISOString()
      },
      { onConflict: "race_bundle_id" }
    )
    .select("id")
    .single();

  if (upsertError || !upsertData) {
    console.error("[race-lessons] upsert failed", { bundleId, error: upsertError?.message });
    return { status: "skipped", reason: `upsert_failed:${upsertError?.message ?? "unknown"}` };
  }

  const supersededCount = await recomputeSupersession(supabase, userId);

  return {
    status: "ok",
    lessonsId: upsertData.id as string,
    source: attempt.source,
    supersededCount
  };
}

export function triggerRaceLessonsBackground(args: GenerateRaceLessonsArgs): void {
  void generateRaceLessons(args).catch((err) => {
    console.error("[race-lessons] background generation failed", {
      bundleId: args.bundleId,
      error: err instanceof Error ? err.message : String(err)
    });
  });
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSignedDuration(sec: number): string {
  const sign = sec < 0 ? "−" : sec > 0 ? "+" : "";
  return `${sign}${formatDuration(Math.abs(sec))}`;
}
