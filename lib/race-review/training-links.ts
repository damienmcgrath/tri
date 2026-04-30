/**
 * Phase 3.2 — Training-to-Race Linking orchestrator.
 *
 * For each race leg, identifies the build-cycle sessions whose execution
 * mirrored the race-day capability (top 3 per discipline), plus a separate
 * list of key-paced sessions where the athlete attempted race-pace effort
 * but fell short — warning signs that, in hindsight, predicted race issues.
 *
 * The picks are deterministic — only the closing one-paragraph verdict is
 * AI-generated. If the AI call fails we persist a deterministic stub.
 */

import "openai/shims/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import { getCoachModel } from "@/lib/openai";
import {
  findBestComparableTrainingTopN,
  type ComparableCandidate,
  type ComparableMatch
} from "@/lib/race-review/best-comparable";
import {
  trainingLinksAiSchema,
  type MatchedAxis,
  type TrainingLink,
  type TrainingToRaceLinks,
  type WarningLink
} from "@/lib/race-review/training-links-schemas";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TrainingLinksDiscipline = "swim" | "bike" | "run";

export type RaceLegSummary = {
  role: TrainingLinksDiscipline;
  durationSec: number;
  avgPower: number | null;
  avgHr: number | null;
  /** sec per 100m for swim, sec per km for run, null otherwise. */
  avgPace: number | null;
  /** Bike normalized power, when present in metrics_v2 or top-level. */
  normalizedPower: number | null;
};

/** Compressed metrics shape persisted on each TrainingLink. */
export type TrainingLinkMetrics = {
  avgPower: number | null;
  normalizedPower: number | null;
  avgPace: number | null;
  avgHr: number | null;
};

export type ActivityMetricsRow = {
  sessionId: string;
  activityId: string | null;
  avgPower: number | null;
  normalizedPower: number | null;
  avgPace: number | null;
  avgHr: number | null;
};

export type GenerateTrainingLinksArgs = {
  supabase: SupabaseClient;
  userId: string;
  bundleId: string;
  raceDateIso: string;
  legs: RaceLegSummary[];
  /** Default 8 (build window). */
  windowWeeks?: number;
};

export type GenerateTrainingLinksResult =
  | { status: "ok"; payload: TrainingToRaceLinks }
  | { status: "skipped"; reason: string };

const DEFAULT_WINDOW_WEEKS = 8;
const TOP_N_PER_LEG = 3;
const MAX_WARNINGS = 3;

// ─── Pure helpers (exported for testing) ────────────────────────────────────

/**
 * Pick the best comparison axis given the race leg's available metrics and
 * the candidate session's. Bike prefers NP > avgPower > duration; swim/run
 * prefer pace > HR > duration.
 */
export function pickMatchedAxis(
  role: TrainingLinksDiscipline,
  raceLeg: RaceLegSummary,
  activity: TrainingLinkMetrics
): MatchedAxis {
  if (role === "bike") {
    if (raceLeg.normalizedPower != null && activity.normalizedPower != null) return "np";
    if (raceLeg.avgHr != null && raceLeg.avgPower != null && activity.avgHr != null && activity.avgPower != null) {
      return "hr_at_power";
    }
    return "duration";
  }
  // swim, run
  if (raceLeg.avgPace != null && activity.avgPace != null) return "pace";
  if (raceLeg.avgHr != null && activity.avgHr != null) return "hr_at_power";
  return "duration";
}

/**
 * One-line deterministic narrative for a matched session. Used as a
 * fallback at the per-link level (the AI verdict is separate).
 */
export function buildDeterministicLinkNarrative(
  role: TrainingLinksDiscipline,
  axis: MatchedAxis,
  raceLeg: RaceLegSummary,
  activity: TrainingLinkMetrics,
  sessionName: string,
  sessionDate: string
): string {
  const dateLabel = sessionDate.slice(0, 10);
  if (axis === "np" && raceLeg.normalizedPower != null && activity.normalizedPower != null) {
    return `Race bike NP of ${Math.round(raceLeg.normalizedPower)}W tracked closely against “${sessionName}” (${Math.round(activity.normalizedPower)}W NP, ${dateLabel}).`;
  }
  if (axis === "pace" && raceLeg.avgPace != null && activity.avgPace != null) {
    return `Race ${role} pace of ${formatPace(raceLeg.avgPace, role)} matched “${sessionName}” (${formatPace(activity.avgPace, role)}, ${dateLabel}).`;
  }
  if (axis === "hr_at_power" && raceLeg.avgHr != null && activity.avgHr != null) {
    const raceHr = Math.round(raceLeg.avgHr);
    const sessHr = Math.round(activity.avgHr);
    return `${capitalize(role)} HR ran at ${raceHr}bpm on race day; “${sessionName}” held ${sessHr}bpm at comparable load (${dateLabel}).`;
  }
  return `Closest comparable ${role} effort by duration: “${sessionName}” on ${dateLabel}.`;
}

function formatPace(secPerUnit: number, role: TrainingLinksDiscipline): string {
  // swim is per 100m; run is per km.
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  const ss = s < 10 ? `0${s}` : `${s}`;
  const unit = role === "swim" ? "/100m" : "/km";
  return `${m}:${ss}${unit}`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function buildDeterministicAiFallback(
  perLeg: TrainingToRaceLinks["perLeg"],
  warnings: WarningLink[]
): string {
  const counts = (["swim", "bike", "run"] as const).map((leg) => `${perLeg[leg].length} ${leg}`);
  const matchedClause = counts.filter((c) => !c.startsWith("0 ")).join(", ");
  const warnClause = warnings.length > 0 ? ` ${warnings.length} warning sign(s) flagged.` : "";
  if (!matchedClause) return `No comparable build sessions in the 8-week window.${warnClause}`.trim();
  return `Build cycle linked: ${matchedClause}.${warnClause}`.trim();
}

// ─── DB loaders ─────────────────────────────────────────────────────────────

/**
 * Reusable build-window pool loader. Returns the same shape used by the
 * Layer-3 best-comparable finder, so it can be passed directly to
 * findBestComparableTrainingTopN.
 *
 * Exported so callers can pre-load and reuse across orchestrators.
 */
export async function loadBuildWindowPool(
  supabase: SupabaseClient,
  userId: string,
  raceDateIso: string,
  windowWeeks = DEFAULT_WINDOW_WEEKS
): Promise<ComparableCandidate[]> {
  const raceDate = new Date(raceDateIso);
  const windowStart = new Date(raceDate.getTime() - windowWeeks * 7 * 24 * 60 * 60 * 1000);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const raceDateOnly = raceDateIso.slice(0, 10);

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,session_role,duration_minutes,status")
    .eq("user_id", userId)
    .gte("date", windowStartIso)
    .lt("date", raceDateOnly)
    .eq("status", "completed");

  const out: ComparableCandidate[] = [];
  for (const row of sessions ?? []) {
    const sport = (row as { sport: string }).sport;
    if (sport !== "swim" && sport !== "bike" && sport !== "run") continue;
    const minutes = Number((row as { duration_minutes: number | null }).duration_minutes ?? 0);
    if (minutes <= 0) continue;
    out.push({
      sessionId: (row as { id: string }).id,
      date: (row as { date: string }).date,
      sport,
      durationSec: Math.round(minutes * 60),
      sessionName: ((row as { session_name: string | null }).session_name) ?? null,
      type: ((row as { type: string | null }).type) ?? null,
      sessionRole: ((row as { session_role: string | null }).session_role) ?? null
    });
  }
  return out;
}

/**
 * Pull metrics for the matched sessions' linked completed activities.
 * Returns a Map keyed by sessionId.
 */
async function loadActivityMetricsForSessions(
  supabase: SupabaseClient,
  userId: string,
  sessionIds: string[]
): Promise<Map<string, ActivityMetricsRow>> {
  const out = new Map<string, ActivityMetricsRow>();
  if (sessionIds.length === 0) return out;

  const { data: links } = await supabase
    .from("session_activity_links")
    .select("planned_session_id,completed_activity_id,confirmation_status")
    .eq("user_id", userId)
    .in("planned_session_id", sessionIds);

  const sessionToActivity = new Map<string, string>();
  for (const link of links ?? []) {
    const l = link as { planned_session_id: string; completed_activity_id: string | null; confirmation_status: string | null };
    if (!l.completed_activity_id) continue;
    if (l.confirmation_status === "rejected") continue;
    if (!sessionToActivity.has(l.planned_session_id)) {
      sessionToActivity.set(l.planned_session_id, l.completed_activity_id);
    }
  }

  const activityIds = [...new Set(sessionToActivity.values())];
  if (activityIds.length === 0) {
    for (const id of sessionIds) {
      out.set(id, { sessionId: id, activityId: null, avgPower: null, normalizedPower: null, avgPace: null, avgHr: null });
    }
    return out;
  }

  const { data: activities } = await supabase
    .from("completed_activities")
    .select("id,sport_type,avg_power,avg_hr,avg_pace_per_100m_sec,duration_sec,distance_m,metrics_v2")
    .eq("user_id", userId)
    .in("id", activityIds);

  const activityMap = new Map<string, Record<string, unknown>>();
  for (const a of activities ?? []) {
    activityMap.set((a as { id: string }).id, a as Record<string, unknown>);
  }

  for (const sessionId of sessionIds) {
    const activityId = sessionToActivity.get(sessionId) ?? null;
    if (!activityId) {
      out.set(sessionId, { sessionId, activityId: null, avgPower: null, normalizedPower: null, avgPace: null, avgHr: null });
      continue;
    }
    const a = activityMap.get(activityId);
    if (!a) {
      out.set(sessionId, { sessionId, activityId, avgPower: null, normalizedPower: null, avgPace: null, avgHr: null });
      continue;
    }
    out.set(sessionId, extractMetrics(sessionId, activityId, a));
  }
  return out;
}

function extractMetrics(sessionId: string, activityId: string, a: Record<string, unknown>): ActivityMetricsRow {
  const sport = a.sport_type as string;
  const avgPower = a.avg_power != null ? Number(a.avg_power) : null;
  const avgHr = a.avg_hr != null ? Number(a.avg_hr) : null;
  let avgPace: number | null = null;
  if (sport === "swim" && a.avg_pace_per_100m_sec != null) {
    avgPace = Number(a.avg_pace_per_100m_sec);
  } else if (sport === "run") {
    const distM = a.distance_m != null ? Number(a.distance_m) : null;
    const durSec = a.duration_sec != null ? Number(a.duration_sec) : null;
    if (distM && durSec && distM > 0) {
      avgPace = Math.round(durSec / (distM / 1000));
    }
  }
  // Normalized power: prefer metrics_v2.normalizedPower, fallback to top-level if present.
  let normalizedPower: number | null = null;
  const m = a.metrics_v2;
  if (m && typeof m === "object") {
    const np = (m as Record<string, unknown>).normalizedPower;
    if (typeof np === "number" && np > 0) normalizedPower = np;
    if (normalizedPower == null) {
      const halves = (m as Record<string, unknown>).halves;
      if (halves && typeof halves === "object") {
        const hh = halves as Record<string, unknown>;
        const f = typeof hh.firstHalfAvgPower === "number" ? hh.firstHalfAvgPower : null;
        const l = typeof hh.lastHalfAvgPower === "number" ? hh.lastHalfAvgPower : null;
        // Last-resort proxy: average of halves.
        if (f != null && l != null) normalizedPower = Math.round((f + l) / 2);
      }
    }
  }
  return { sessionId, activityId, avgPower, normalizedPower, avgPace, avgHr };
}

/**
 * Load 'key' sessions in the build window where the persisted execution_result
 * shows the athlete fell short of intent (intentMatch missed/partial).
 */
async function loadWarningSessions(
  supabase: SupabaseClient,
  userId: string,
  raceDateIso: string,
  windowWeeks: number,
  limit: number
): Promise<WarningLink[]> {
  const raceDate = new Date(raceDateIso);
  const windowStart = new Date(raceDate.getTime() - windowWeeks * 7 * 24 * 60 * 60 * 1000);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const raceDateOnly = raceDateIso.slice(0, 10);

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id,date,session_name,sport,type,session_role,execution_result")
    .eq("user_id", userId)
    .eq("session_role", "key")
    .eq("status", "completed")
    .gte("date", windowStartIso)
    .lt("date", raceDateOnly)
    .order("date", { ascending: false });

  const out: WarningLink[] = [];
  for (const row of sessions ?? []) {
    if (out.length >= limit) break;
    const r = row as { id: string; date: string; session_name: string | null; sport: string; type: string | null; execution_result: unknown };
    const result = r.execution_result;
    if (!result || typeof result !== "object") continue;
    const verdict = (result as Record<string, unknown>).coach_verdict
      ?? (result as Record<string, unknown>).coachVerdict
      ?? (result as Record<string, unknown>).verdict
      ?? null;
    const sessionVerdict = verdict && typeof verdict === "object"
      ? ((verdict as Record<string, unknown>).sessionVerdict as Record<string, unknown> | undefined)
      : undefined;
    const intentMatch = sessionVerdict?.intentMatch as string | undefined;
    if (intentMatch !== "missed" && intentMatch !== "partial") continue;
    const headlineRaw = sessionVerdict?.headline;
    const observation = typeof headlineRaw === "string" && headlineRaw.length > 0
      ? headlineRaw.slice(0, 320)
      : `Key ${r.sport} session on ${r.date.slice(0, 10)} fell short of intent (${intentMatch}).`;
    out.push({
      sessionId: r.id,
      date: r.date,
      sessionName: r.session_name ?? r.type ?? `Key ${r.sport} session`,
      observation
    });
  }
  return out;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export async function buildTrainingToRaceLinks(
  args: GenerateTrainingLinksArgs
): Promise<GenerateTrainingLinksResult> {
  const { supabase, userId, raceDateIso, legs } = args;
  const windowWeeks = args.windowWeeks ?? DEFAULT_WINDOW_WEEKS;

  if (legs.length === 0) {
    return { status: "skipped", reason: "no_legs" };
  }

  const pool = await loadBuildWindowPool(supabase, userId, raceDateIso, windowWeeks);

  // Score per leg, gather candidate sessionIds, then hydrate metrics in one shot.
  const matchesPerLeg: Record<TrainingLinksDiscipline, ComparableMatch[]> = {
    swim: [],
    bike: [],
    run: []
  };
  for (const leg of legs) {
    if (leg.durationSec <= 0) continue;
    matchesPerLeg[leg.role] = findBestComparableTrainingTopN({
      discipline: leg.role,
      raceLegDurationSec: leg.durationSec,
      candidates: pool,
      limit: TOP_N_PER_LEG
    });
  }

  const allSessionIds = Array.from(
    new Set(
      (["swim", "bike", "run"] as const).flatMap((leg) => matchesPerLeg[leg].map((m) => m.sessionId))
    )
  );

  const metricsMap = await loadActivityMetricsForSessions(supabase, userId, allSessionIds);

  const perLeg: TrainingToRaceLinks["perLeg"] = { swim: [], bike: [], run: [] };
  for (const leg of legs) {
    const matches = matchesPerLeg[leg.role];
    perLeg[leg.role] = matches.map((match): TrainingLink => {
      const metricsRow = metricsMap.get(match.sessionId);
      const metrics: TrainingLinkMetrics = {
        avgPower: metricsRow?.avgPower ?? null,
        normalizedPower: metricsRow?.normalizedPower ?? null,
        avgPace: metricsRow?.avgPace ?? null,
        avgHr: metricsRow?.avgHr ?? null
      };
      const matchedAxis = pickMatchedAxis(leg.role, leg, metrics);
      const narrative = buildDeterministicLinkNarrative(
        leg.role,
        matchedAxis,
        leg,
        metrics,
        match.sessionName,
        match.date
      );
      return {
        sessionId: match.sessionId,
        date: match.date,
        sessionName: match.sessionName,
        durationSec: match.durationSec,
        matchedAxis,
        matchScore: round3(match.score),
        metricsV2: metrics,
        narrative
      };
    });
  }

  const warningsMissed = await loadWarningSessions(supabase, userId, raceDateIso, windowWeeks, MAX_WARNINGS);

  const fallbackNarrative = buildDeterministicAiFallback(perLeg, warningsMissed);

  // Single AI round-trip for the verdict paragraph.
  const aiAttempt = await callOpenAIWithFallback({
    logTag: "race-review-training-links",
    fallback: { narrative: fallbackNarrative },
    buildRequest: () => ({
      instructions: buildTrainingLinksInstructions(),
      reasoning: { effort: "low" },
      max_output_tokens: 800,
      text: {
        format: zodTextFormat(trainingLinksAiSchema, "training_links_ai", {
          description: "Single-paragraph verdict tying race-day capability to build-cycle training."
        })
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify({
                windowWeeks,
                perLeg,
                warningsMissed
              })
            }
          ]
        }
      ]
    }),
    schema: trainingLinksAiSchema,
    logContext: { bundleId: args.bundleId }
  });

  const aiNarrative = aiAttempt.source === "ai" ? aiAttempt.value.narrative : null;
  const source = aiAttempt.source;

  const payload: TrainingToRaceLinks = {
    windowWeeks,
    perLeg,
    warningsMissed,
    aiNarrative,
    source,
    generatedAt: new Date().toISOString()
  };

  return { status: "ok", payload };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function buildTrainingLinksInstructions(): string {
  return [
    "You are writing the closing verdict for a race's Training-to-Race Linking section.",
    "Input: deterministic per-leg matches (sessions whose execution mirrored race-day capability) and",
    "warningsMissed (key-paced sessions where intent was missed or partial).",
    "",
    "Write ONE paragraph (3–5 sentences, ≤ 700 chars).",
    "",
    "Tone rules (HARD):",
    "- Never use 'should have', 'failed', 'missed' as moralising verbs. Use 'fell short of plan', 'came in below target'.",
    "- Diagnose, don't judge.",
    "- Cite at least one specific session by date or name.",
    "- If perLeg is empty for every leg, do not invent — say the build window had no clear analogues.",
    "- If warningsMissed is non-empty, mention the pattern; do not list every entry.",
    "",
    "Frame: 'your training had it in you' when warningsMissed is empty AND perLeg has matches across ≥2 legs.",
    "Frame: 'capacity was there but distribution undershot' when perLeg has matches AND warningsMissed is non-empty.",
    "Frame: 'the build window did not produce a clear race analogue' when perLeg is mostly empty.",
    "",
    "Return JSON: { \"narrative\": \"...\" }"
  ].join("\n");
}
