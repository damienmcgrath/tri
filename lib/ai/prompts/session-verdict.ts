import "openai/shims/node";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import { normalizeUnitString } from "@/lib/execution-review";
import { getMacroContext } from "@/lib/training/macro-context";
import { buildExtendedSignals, EMPTY_EXTENDED_SIGNALS, type ExtendedSignals } from "@/lib/analytics/extended-signals";
import type { HistoricalComparable } from "@/lib/analytics/historical-comparables";
import {
  fetchSessionVerdictPriorHeadlines,
  SESSION_VARIANCE_PROMPT,
  type SessionPriorHeadline,
} from "@/lib/ai/session-variance-corpus";
import { SESSION_VERDICT_FEW_SHOT_JSON } from "./session-verdict-examples";

export const SESSION_VERDICT_PROMPT_VERSION = "v3";

// --- Zod schema for AI output ---

const metricComparisonSchema = z.object({
  metric: z.string().min(1).max(60),
  target: z.string().min(1).max(100),
  actual: z.string().min(1).max(100),
  assessment: z.enum(["on_target", "above", "below", "missing"])
});

const deviationSchema = z.object({
  metric: z.string().min(1).max(60),
  description: z.string().min(1).max(300),
  severity: z.enum(["minor", "moderate", "significant"])
});

export const sessionVerdictOutputSchema = z.object({
  purpose_statement: z.string().min(1).max(400),
  training_block_context: z.string().min(1).max(200),
  intended_zones: z.string().max(500),
  intended_metrics: z.string().max(500),
  execution_summary: z.string().min(1).max(600),
  verdict_status: z.enum(["achieved", "partial", "missed", "off_target"]),
  metric_comparisons: z.array(metricComparisonSchema).max(6),
  key_deviations: z.array(deviationSchema).max(5),
  /**
   * A single finding that goes beyond restating the session. Must cite a
   * historical comparable, aerobic decoupling, weather-adjusted context, or a
   * cross-session pattern. Required so the model can never fall back to a pure
   * summary of this session's numbers.
   */
  non_obvious_insight: z.string().min(1).max(320),
  /**
   * Optional one-sentence teach moment explaining *why* a metric exposed by
   * this session matters (VI spike, aerobic decoupling, negative-split
   * failure, durability fade, cadence drop, HR↔pace divergence). Null when
   * no mechanism is worth teaching, so the model does not manufacture
   * platitudes. Rotate focus across sessions.
   */
  teach: z.string().min(1).max(200).nullable(),
  /**
   * Concrete citation of at least one prior same-intent session the reader
   * can anchor to (date + metric delta). Required non-null whenever
   * `extendedSignals.historicalComparables` has at least one entry, so the
   * model cannot ignore the comparables that were injected. Null only when
   * no comparables are available.
   */
  comparable_reference: z.string().min(1).max(240).nullable(),
  adaptation_signal: z.string().min(1).max(800),
  adaptation_type: z.enum(["proceed", "flag_review", "modify", "redistribute"]),
  affected_session_ids: z.array(z.string()).max(5)
});

export type SessionVerdictOutput = z.infer<typeof sessionVerdictOutputSchema>;

// --- Context assembly ---

export type SessionVerdictContext = {
  session: {
    id: string;
    sport: string;
    type: string;
    sessionName: string | null;
    intentCategory: string | null;
    target: string | null;
    notes: string | null;
    durationMinutes: number | null;
    isKey: boolean;
    date: string;
  };
  activity: {
    durationSec: number | null;
    distanceM: number | null;
    avgHr: number | null;
    avgPower: number | null;
    /** Duration-weighted average power from work-interval laps only. */
    avgIntervalPower: number | null;
    avgPacePer100mSec: number | null;
    metrics: Record<string, unknown> | null;
  } | null;
  executionResult: Record<string, unknown> | null;
  feel: {
    overallFeel: number | null;
    energyLevel: string | null;
    legsFeel: string | null;
    motivation: string | null;
    sleepQuality: string | null;
    lifeStress: string | null;
    note: string | null;
  } | null;
  trainingBlock: {
    currentBlock: string;
    blockWeek: number;
    blockTotalWeeks: number;
    raceName: string | null;
    daysToRace: number | null;
  };
  upcomingSessions: Array<{
    id: string;
    date: string;
    sport: string;
    type: string;
    isKey: boolean;
  }>;
  recentLoadTrend: {
    last7daysTss: number | null;
    last14daysTss: number | null;
    currentCtl: number | null;
    currentAtl: number | null;
    currentTsb: number | null;
  } | null;
  /**
   * Optional so older test fixtures remain valid. When absent at runtime the
   * fallback verdict still emits a `non_obvious_insight` grounded in whatever
   * evidence is present.
   */
  extendedSignals?: ExtendedSignals;
};

/**
 * Locate a pre-computed `ExtendedSignals` payload inside a persisted
 * `sessions.execution_result` blob. `toPersistedExecutionReview` nests the full
 * evidence under `deterministic`, so that's the canonical path. A top-level
 * `extendedSignals` key is also accepted for tolerance against hand-written or
 * forward-ported payloads. Exported so the read path is unit-testable without
 * a Supabase mock.
 */
export function readPersistedExtendedSignals(executionResult: unknown): ExtendedSignals | null {
  if (!executionResult || typeof executionResult !== "object" || Array.isArray(executionResult)) return null;
  const record = executionResult as Record<string, unknown>;
  const deterministic = record.deterministic as Record<string, unknown> | null | undefined;
  const candidates: unknown[] = [deterministic?.extendedSignals, record.extendedSignals];
  for (const raw of candidates) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const candidate = raw as Partial<ExtendedSignals>;
      if (candidate.historicalComparables !== undefined) return candidate as ExtendedSignals;
    }
  }
  return null;
}

export async function buildSessionVerdictContext(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<SessionVerdictContext | null> {
  // Fetch session
  const { data: session } = await supabase
    .from("sessions")
    .select("id, sport, type, session_name, intent_category, target, notes, duration_minutes, is_key, date, plan_id, week_id, execution_result, status")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!session) return null;

  // Fetch linked activity
  const { data: links } = await supabase
    .from("session_activity_links")
    .select("completed_activity_id")
    .eq("planned_session_id", sessionId);

  let activity: SessionVerdictContext["activity"] = null;
  let activityEnvironment: unknown = null;
  const activityId = links?.[0]?.completed_activity_id;
  if (activityId) {
    const { data: act } = await supabase
      .from("completed_activities")
      .select("duration_sec, distance_m, avg_hr, avg_power, avg_pace_per_100m_sec, metrics_v2, execution_result")
      .eq("id", activityId)
      .maybeSingle();
    if (act) {
      const execResult = act.execution_result as Record<string, unknown> | null | undefined;
      const intervalPower = execResult?.avgIntervalPower;
      const metrics = (act.metrics_v2 as Record<string, unknown>) ?? null;
      activity = {
        durationSec: act.duration_sec,
        distanceM: act.distance_m,
        avgHr: act.avg_hr,
        avgPower: act.avg_power,
        avgIntervalPower: typeof intervalPower === "number" ? intervalPower : null,
        avgPacePer100mSec: act.avg_pace_per_100m_sec ?? null,
        metrics
      };
      activityEnvironment = metrics && typeof metrics === "object" ? (metrics as Record<string, unknown>).environment : null;
    }
  }

  // Fetch feel data
  let feel: SessionVerdictContext["feel"] = null;
  const { data: feelRow } = await supabase
    .from("session_feels")
    .select("overall_feel, energy_level, legs_feel, motivation, sleep_quality, life_stress, note")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (feelRow) {
    feel = {
      overallFeel: feelRow.overall_feel ?? null,
      energyLevel: feelRow.energy_level ?? null,
      legsFeel: feelRow.legs_feel ?? null,
      motivation: feelRow.motivation ?? null,
      sleepQuality: feelRow.sleep_quality ?? null,
      lifeStress: feelRow.life_stress ?? null,
      note: feelRow.note ?? null
    };
  }

  // Fetch macro context
  let trainingBlock: SessionVerdictContext["trainingBlock"] = {
    currentBlock: "Build",
    blockWeek: 1,
    blockTotalWeeks: 1,
    raceName: null,
    daysToRace: null
  };
  try {
    const macro = await getMacroContext(supabase, userId);
    trainingBlock = {
      currentBlock: macro.currentBlock,
      blockWeek: macro.blockWeek,
      blockTotalWeeks: macro.blockTotalWeeks,
      raceName: macro.raceName,
      daysToRace: macro.daysToRace
    };
  } catch {
    // Use defaults
  }

  // Fetch upcoming sessions (next 7 days)
  const sessionDate = session.date as string;
  const endDate = new Date(new Date(sessionDate).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const { data: upcoming } = await supabase
    .from("sessions")
    .select("id, date, sport, type, is_key")
    .eq("user_id", userId)
    .gt("date", sessionDate)
    .lte("date", endDate)
    .eq("status", "planned")
    .order("date")
    .limit(10);

  // Fetch recent training load
  let recentLoadTrend: SessionVerdictContext["recentLoadTrend"] = null;
  try {
    const { data: fitness } = await supabase
      .from("athlete_fitness")
      .select("ctl, atl, tsb")
      .eq("user_id", userId)
      .eq("sport", "total")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const loadStartDate14 = new Date(new Date(sessionDate).getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const loadStartDate7 = new Date(new Date(sessionDate).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const { data: loads14 } = await supabase
      .from("daily_load")
      .select("tss, date")
      .eq("user_id", userId)
      .eq("sport", "total")
      .gte("date", loadStartDate14)
      .lte("date", sessionDate);

    const last7daysTss = loads14?.filter(l => l.date >= loadStartDate7).reduce((s, l) => s + Number(l.tss ?? 0), 0) ?? null;
    const last14daysTss = loads14?.reduce((s, l) => s + Number(l.tss ?? 0), 0) ?? null;

    recentLoadTrend = {
      last7daysTss,
      last14daysTss,
      currentCtl: fitness?.ctl ? Number(fitness.ctl) : null,
      currentAtl: fitness?.atl ? Number(fitness.atl) : null,
      currentTsb: fitness?.tsb ? Number(fitness.tsb) : null
    };
  } catch {
    // Non-critical
  }

  const persistedExtended = readPersistedExtendedSignals(session.execution_result);

  let extendedSignals: ExtendedSignals = persistedExtended ?? EMPTY_EXTENDED_SIGNALS;
  if (!persistedExtended) {
    try {
      const splitHalves = (() => {
        const execResult = session.execution_result as Record<string, unknown> | null | undefined;
        if (!execResult) return null;
        const firstHalfAvgHr = typeof execResult.firstHalfAvgHr === "number" ? execResult.firstHalfAvgHr : null;
        const lastHalfAvgHr = typeof execResult.lastHalfAvgHr === "number" ? execResult.lastHalfAvgHr : null;
        if (!firstHalfAvgHr || !lastHalfAvgHr) return null;
        return {
          firstHalfAvgHr,
          lastHalfAvgHr,
          firstHalfAvgPower: typeof execResult.firstHalfAvgPower === "number" ? execResult.firstHalfAvgPower : null,
          lastHalfAvgPower: typeof execResult.lastHalfAvgPower === "number" ? execResult.lastHalfAvgPower : null,
          firstHalfPaceSPerKm: typeof execResult.firstHalfPaceSPerKm === "number" ? execResult.firstHalfPaceSPerKm : null,
          lastHalfPaceSPerKm: typeof execResult.lastHalfPaceSPerKm === "number" ? execResult.lastHalfPaceSPerKm : null
        };
      })();
      extendedSignals = await buildExtendedSignals(supabase, {
        athleteId: userId,
        sessionId,
        sport: session.sport as string,
        intentCategory: (session.intent_category as string | null) ?? null,
        sessionDate: session.date as string,
        splitHalves,
        environment: activityEnvironment
      });
    } catch {
      extendedSignals = EMPTY_EXTENDED_SIGNALS;
    }
  }

  return {
    session: {
      id: session.id,
      sport: session.sport,
      type: session.type,
      sessionName: session.session_name ?? null,
      intentCategory: session.intent_category ?? null,
      target: session.target ?? null,
      notes: session.notes ?? null,
      durationMinutes: session.duration_minutes ?? null,
      isKey: Boolean(session.is_key),
      date: session.date
    },
    activity,
    executionResult: (session.execution_result as Record<string, unknown>) ?? null,
    feel,
    trainingBlock,
    upcomingSessions: (upcoming ?? []).map(s => ({
      id: s.id,
      date: s.date,
      sport: s.sport,
      type: s.type,
      isKey: Boolean(s.is_key)
    })),
    recentLoadTrend,
    extendedSignals
  };
}

// --- AI prompt instructions ---

export function buildVerdictInstructions(): string {
  return [
    "You are an expert triathlon coach generating a structured session verdict.",
    "The verdict has three parts: Purpose Statement, Execution Assessment, and Adaptation Signal.",
    "",
    "PART 1 — Purpose Statement:",
    "- Explain the session's physiological intent in plain language.",
    "- Reference the training block context (e.g. 'Week 3 of a 4-week build block').",
    "- Example: 'This was a Z2 aerobic maintenance run designed to build capillary density without accumulating fatigue.'",
    "",
    "PART 2 — Execution Assessment:",
    "- Compare actual metrics against target/expected ranges.",
    "- Flag meaningful deviations with specific numbers.",
    "- For swim: include SWOLF trends, stroke rate, distance per stroke where available.",
    "- For bike: include normalised power, variability index, cadence patterns.",
    "- For run: include pace distribution, cardiac drift analysis, cadence.",
    "- Produce a clear verdict_status: 'achieved' (session achieved its purpose), 'partial' (partially achieved), 'missed' (did not achieve intent), 'off_target' (significantly off).",
    "- Express durations in minutes (e.g. '37 min'). Express run pace as min:sec/km (e.g. '5:41/km'). Express swim pace as min:sec/100m (e.g. '1:55/100m'). Never write raw seconds.",
    "- For swim: when lap data is available in the metrics, use per-lap pace (avgPacePer100mSec) to assess split-by-split pacing consistency across intervals.",
    "",
    "Swim metric rules (CRITICAL):",
    "- Swim pace is expressed as min:sec per 100m (e.g. '1:55/100m', '2:05/100m'). Descriptions like 'low to mid 2 min' refer to PACE, not heart rate.",
    "- NEVER assign a pace value or pace description as a heart rate target. Heart rate targets are always in bpm (e.g. '130-145 bpm').",
    "- If the planned session text contains no explicit heart rate target in bpm, set the target column to '\u2014' for any heart rate metric.",
    "- In metric_comparisons, use 'average pace' (not 'average heart rate') for pace-related targets like 'low to mid 2 min/100m'.",
    "",
    "PART 3 — Adaptation Signal:",
    "- State what this means for upcoming training.",
    "- If well-executed: confirm the plan proceeds. Reference specific upcoming sessions.",
    "- If warning signs: flag specific sessions for potential modification.",
    "- If missed/off-target: explain redistribution or recovery implications.",
    "- Reference upcoming sessions by weekday name and sport, NOT by ISO date (e.g. 'Wednesday's bike' not '2026-04-09 bike').",
    "- Keep adaptation_signal to 2-3 sentences. Be direct, not exhaustive.",
    "",
    "EXTENDED SIGNALS (`extendedSignals`):",
    "- `historicalComparables`: up to four previous same-sport, same-intent sessions with execution scores, pace/power/HR, and prior takeaways. Use these to detect trends ('HR is rising at the same power on each of the last three threshold bikes').",
    "- `aerobicDecoupling`: percentage drift in HR-per-output ratio from first to second half; severity mapped to stable (<3%), mild_drift (3-5%), significant_drift (5-10%), poor_durability (≥10%). Reference only for endurance/tempo/threshold work, never for short intervals or strength.",
    "- `weather`: `avgTemperatureC` and a `notable` flag list (hot, warm, cool, cold, large range). Use it to contextualise HR/pace deviations — a hot day raises HR at the same pace and is not a fitness signal.",
    "- These signals are inputs. If absent or empty, do not mention them.",
    "",
    "NON-OBVIOUS INSIGHT (`non_obvious_insight`):",
    "- Required on every verdict. ≤320 chars.",
    "- It must surface something the athlete would miss from this session alone — a trend against their own history, a decoupling/weather read, or a pattern across feel and execution.",
    "- Do not repeat what execution_summary already says. No generic coaching platitudes. Cite a number, date, or signal.",
    "- If no comparable is available and no signal stands out, say that honestly: 'No prior sessions in this intent category yet — next similar session will start to build a comparison.'",
    "",
    "TEACH (`teach`) — OPTIONAL, ≤200 chars:",
    "- Use `teach` when this session exposes a mechanistically important metric — variability index spike, aerobic decoupling, negative-split failure, durability fade, cadence drop, HR↔pace divergence, power-per-HR shift, SWOLF trend, or similar. Explain in one sentence *why* that metric matters for this athlete's training.",
    "- Prefer a different mechanism than the last few `priorHeadlines`. Rotate focus — do not teach the same concept two sessions in a row.",
    "- If no mechanism is worth teaching on this session, set `teach` to null. Do not manufacture a teach moment to fill the field.",
    "- `teach` is separate from `non_obvious_insight`: insight observes *what* is true; teach explains *why* it matters for training.",
    "",
    "COMPARABLE REFERENCE (`comparable_reference`) — ≤240 chars:",
    "- When `extendedSignals.historicalComparables` has ≥1 entry, `comparable_reference` MUST be non-null and cite at least one prior session by date + metric delta (HR, pace, power, execution score, or its stored takeaway). Example: \"2026-04-13 threshold run: 168 bpm at 4:15/km; today 172 bpm at 4:15/km over the same 6× 5 min.\"",
    "- When `historicalComparables` is empty, set `comparable_reference` to null. Do not invent a prior session.",
    "- `comparable_reference` is the hard-wired proof the injected history was actually used. It complements `non_obvious_insight` rather than duplicating it.",
    "",
    "PACING & CADENCE HALVES (`executionResult` human-readable halves):",
    "- `hr_drift_first_to_second_half`, `pace_fade_first_to_second_half`, `cadence_drift_first_to_second_half`, `swim_pace_fade_first_to_second_half`, `stroke_rate_drift_first_to_second_half`, and `power_drift_first_to_second_half` surface the two halves of the session when available.",
    "- Cite them in `execution_summary` or `key_deviations` when the halves differ materially (cadence drop ≥3 spm, pace fade ≥3%, power drop ≥5%, stroke-rate drift on swim) — this is the cleanest negative-split / durability read available.",
    "- When a half comparison is absent from `executionResult`, do not claim a split pattern.",
    "",
    SESSION_VARIANCE_PROMPT,
    "",
    "FEEL DATA — CRITICAL:",
    "- When `feel` is present in the input, you MUST reference it in execution_summary. Name the overall feel label (e.g. 'Terrible', 'Good') and any legs, energy, or life-stress signal the athlete reported.",
    "- Contradiction rule: if objective metrics landed on target BUT overall feel is 'Terrible' or 'Hard' (1-2/5), set verdict_status to at most 'partial' and adaptation_type to 'flag_review' or 'modify'. Next week's plan should be conservative. Do not call the session 'achieved'.",
    "- Inverse rule: if metrics look off-target BUT overall feel is 'Good' or 'Amazing' (4-5/5) AND execution was not reckless (no excessive time above target, no incomplete intervals on a key session), verdict_status may remain 'achieved' or 'partial' with adaptation_type 'proceed'.",
    "- If the feel `note` is present, read it as primary context — it may contain the 'why' the metrics alone cannot show (illness, weather, emotional load). Reference the note briefly if it changes your interpretation.",
    "- If no feel is present, do not speculate about how the athlete felt. Proceed on metrics alone and keep the tone neutral.",
    "",
    "Rules:",
    "- Use only provided evidence. Do not invent metrics or facts.",
    "- Speak with direct authority. Do not hedge.",
    "- Keep metric_comparisons to the 3-5 most important metrics.",
    "- Keep key_deviations only for meaningful deviations (not minor noise).",
    "- If evidence is limited, reflect that by keeping recommendations conservative.",
    "- Be concise. Each field should use the minimum words needed to convey the insight.",
    "- Return exactly one JSON object matching the required schema.",
    "",
    "Language rules (CRITICAL — violations make the output unreadable to athletes):",
    "- NEVER use camelCase field names in any text field (e.g. do NOT write 'intervalCompletionPct', 'avgPower', 'timeAboveTargetPct', 'avgHr', 'normalizedPower').",
    "- Use plain English instead: 'interval completion', 'average power', 'time above target', 'average heart rate', 'normalized power'.",
    "- NEVER reference the internal execution score or score band in execution_summary or any text field. The score is displayed separately in the UI.",
    "- Express interval completion as a count when possible (e.g. '3 of 5 intervals completed' or 'all 5 intervals completed'), not as a decimal or percentage of 'intervalCompletionPct'.",
    "- Express abbreviations in full on first use: 'NP' → 'normalized power', 'VI' → 'variability index', 'TSS' → 'training stress score'. After first use, abbreviations are fine.",
    "- In execution_summary, write ONE clear sentence about whether the session achieved its purpose. Move specific metrics to metric_comparisons.",
    "",
    "Few-shot examples (three realistic verdicts across Z2 aerobic, threshold intervals, and heat-affected long run; separated by `---`). Follow the shape, tone, and specificity — do not copy wording:",
    SESSION_VERDICT_FEW_SHOT_JSON
  ].join("\n");
}

// --- Feel humanization ---

/**
 * 5-point overall feel labels. Kept in sync with FeelCaptureBanner's UI copy
 * so the LLM input mirrors what the athlete actually selected.
 */
const OVERALL_FEEL_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Terrible",
  2: "Hard",
  3: "OK",
  4: "Good",
  5: "Amazing"
};

/**
 * Converts the raw `session_feels` projection on `SessionVerdictContext` into
 * a compact, human-readable record that is safer for the LLM to read than raw
 * integers and enum strings. Returns null when no feel fields are populated.
 *
 * This is also what we persist into `session_verdicts.feel_data` so downstream
 * consumers (weekly debrief, analytics) see consistent labels.
 */
export function humanizeFeel(
  feel: SessionVerdictContext["feel"]
): Record<string, string> | null {
  if (!feel) return null;
  const out: Record<string, string> = {};
  if (feel.overallFeel !== null && feel.overallFeel !== undefined) {
    const key = feel.overallFeel as 1 | 2 | 3 | 4 | 5;
    const label = OVERALL_FEEL_LABELS[key] ?? "Unknown";
    out.overall = `${label} (${feel.overallFeel}/5)`;
  }
  if (feel.energyLevel) out.energy = feel.energyLevel;
  if (feel.legsFeel) out.legs = feel.legsFeel;
  if (feel.motivation) out.motivation = feel.motivation;
  if (feel.sleepQuality) out.sleep = feel.sleepQuality;
  if (feel.lifeStress) out.lifeStress = feel.lifeStress;
  if (feel.note) {
    // DB already caps at 280; defensive slice in case schema changes later.
    // Note is going to the LLM, not the DOM — do NOT HTML-escape.
    out.note = feel.note.slice(0, 280);
  }
  return Object.keys(out).length > 0 ? out : null;
}

// --- Deterministic fallback ---

function formatDuration(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatPace100m(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}/100m`;
}

/**
 * Compose a deterministic `comparable_reference` from the injected history.
 * Used by the fallback verdict and the post-process enforcement when the
 * model forgets to cite a comparable. Returns null when no prior session is
 * available — the schema allows null and fabricating a reference would
 * violate the "no invented facts" contract.
 */
export function buildFallbackComparableReference(
  comparables: HistoricalComparable[]
): string | null {
  if (!Array.isArray(comparables) || comparables.length === 0) return null;
  const first = comparables[0];
  if (!first) return null;
  const titleSegment = first.title ? ` ${first.title}` : "";
  const metricBits: string[] = [];
  if (typeof first.executionScore === "number") metricBits.push(`exec ${first.executionScore}`);
  if (typeof first.avgHr === "number") metricBits.push(`${Math.round(first.avgHr)} bpm`);
  if (typeof first.avgPower === "number") metricBits.push(`${Math.round(first.avgPower)} W`);
  if (typeof first.avgPaceSPerKm === "number") metricBits.push(formatPacePerKmFromSeconds(first.avgPaceSPerKm));
  if (typeof first.avgPacePer100mSec === "number") metricBits.push(formatPace100m(first.avgPacePer100mSec));
  const base = metricBits.length > 0
    ? `${first.date}${titleSegment}: ${metricBits.join(", ")}`
    : `${first.date}${titleSegment}`;
  const takeaway = first.takeaway ? ` — ${first.takeaway}` : "";
  const full = `${base}${takeaway}`;
  return full.length > 240 ? `${full.slice(0, 237)}...` : full;
}

function formatPacePerKmFromSeconds(sec: number): string {
  const totalSec = Math.round(sec);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}

export function buildFallbackVerdict(ctx: SessionVerdictContext): SessionVerdictOutput {
  const sport = ctx.session.sport;
  const intentCategory = ctx.session.intentCategory ?? "general";
  const blockCtx = `Week ${ctx.trainingBlock.blockWeek} of ${ctx.trainingBlock.blockTotalWeeks}-week ${ctx.trainingBlock.currentBlock.toLowerCase()} block`;

  const hasActivity = ctx.activity !== null;
  const act = ctx.activity;

  // Build metric comparisons from activity data when available
  const metricComparisons: SessionVerdictOutput["metric_comparisons"] = [];
  if (act) {
    if (ctx.session.durationMinutes && act.durationSec) {
      const plannedMin = ctx.session.durationMinutes;
      const actualMin = Math.round(act.durationSec / 60);
      const pct = Math.round((actualMin / plannedMin) * 100);
      metricComparisons.push({
        metric: "Duration",
        target: `${plannedMin}m`,
        actual: `${actualMin}m (${pct}%)`,
        assessment: pct >= 90 && pct <= 110 ? "on_target" : pct < 90 ? "below" : "above"
      });
    }
    if (act.avgHr) {
      metricComparisons.push({
        metric: "Avg HR",
        target: "—",
        actual: `${act.avgHr} bpm`,
        assessment: "on_target"
      });
    }
    if (act.avgIntervalPower) {
      metricComparisons.push({
        metric: "Avg Interval Power",
        target: "—",
        actual: `${act.avgIntervalPower}W`,
        assessment: "on_target"
      });
    }
    if (act.avgPower) {
      metricComparisons.push({
        metric: act.avgIntervalPower ? "Avg Power (session)" : "Avg Power",
        target: "—",
        actual: `${act.avgPower}W`,
        assessment: "on_target"
      });
    }
    if (sport === "swim" && act.avgPacePer100mSec) {
      metricComparisons.push({
        metric: "Avg Pace",
        target: "—",
        actual: formatPace100m(act.avgPacePer100mSec),
        assessment: "on_target"
      });
    }
    if (act.distanceM) {
      const distKm = (act.distanceM / 1000).toFixed(1);
      const unit = act.distanceM >= 1000 ? `${distKm}km` : `${act.distanceM}m`;
      metricComparisons.push({
        metric: "Distance",
        target: "—",
        actual: unit,
        assessment: "on_target"
      });
    }
  }

  // Determine status based on execution result or activity presence
  let status: SessionVerdictOutput["verdict_status"] = "missed";
  let executionSummary = "No activity data linked to this session.";
  if (hasActivity) {
    const execResult = ctx.executionResult;
    const intentMatch = execResult?.intentMatchStatus ?? execResult?.status;
    if (intentMatch === "matched_intent") {
      status = "achieved";
      executionSummary = "Session completed with activity data linked. Metrics available for review.";
    } else if (intentMatch === "partial_intent") {
      status = "partial";
      executionSummary = (execResult?.executionSummary as string) ?? "Session partially matched its intended stimulus.";
    } else if (intentMatch === "missed_intent") {
      status = "missed";
      executionSummary = (execResult?.executionSummary as string) ?? "Session did not match its intended stimulus.";
    } else {
      status = "partial";
      executionSummary = "Session data available but AI analysis unavailable. Review the metrics below.";
    }
  }

  let adaptationSignal = hasActivity
    ? "AI-generated adaptation analysis unavailable. The metrics above provide a baseline for manual review."
    : "No activity data to assess. If this session was missed, consider how to redistribute its training load.";

  let adaptationType: SessionVerdictOutput["adaptation_type"] = hasActivity ? "proceed" : "flag_review";

  // Feel override: if the athlete rated this session as Terrible or Hard
  // (1-2/5), never claim the session was "achieved" — even when metrics look
  // fine. Mirrors the FEEL DATA rule in buildVerdictInstructions so the
  // deterministic fallback stays consistent with the LLM's required behavior.
  //
  // Only replace execution_summary for the contradiction case (metrics said
  // "achieved" but feel was poor). For already-partial/missed fallbacks the
  // original execution explanation is more informative; we just reinforce the
  // conservative adaptation signal.
  const overallFeel = ctx.feel?.overallFeel ?? null;
  if (hasActivity && overallFeel !== null && overallFeel <= 2) {
    const feelLabel = OVERALL_FEEL_LABELS[overallFeel as 1 | 2] ?? "Hard";
    const notePart = ctx.feel?.note ? ` Note: "${ctx.feel.note.slice(0, 140)}".` : "";
    if (status === "achieved") {
      status = "partial";
      executionSummary = `Athlete rated this session ${feelLabel} (${overallFeel}/5).${notePart} Flagging for review despite linked activity data.`;
    }
    adaptationSignal = "Feel was poor — hold the next key session conservatively and check in on recovery before pushing load.";
    adaptationType = "flag_review";
  }

  const comparables = ctx.extendedSignals?.historicalComparables ?? [];
  const decoupling = ctx.extendedSignals?.aerobicDecoupling ?? null;
  const weatherNotable = ctx.extendedSignals?.weather?.notable ?? [];
  const comparableReference = buildFallbackComparableReference(comparables);
  let nonObviousInsight: string;
  if (decoupling && (decoupling.severity === "significant_drift" || decoupling.severity === "poor_durability")) {
    nonObviousInsight = `Cardiac-to-output drift of ${decoupling.percent.toFixed(1)}% from first to second half points at aerobic durability — not top-end capacity — as the current limiter.`;
  } else if (comparables.length >= 2) {
    nonObviousInsight = `This is session ${comparables.length + 1} in this intent category — use the prior ${comparables.length} stored takeaways to compare.`;
  } else if (weatherNotable.length > 0) {
    nonObviousInsight = `Conditions today (${weatherNotable.join(", ")}) shift how HR and pace should be read; adjust expectations accordingly.`;
  } else {
    nonObviousInsight = "No prior sessions in this intent category yet — the next similar session will start to build a comparison.";
  }

  return {
    purpose_statement: ctx.session.target
      ? `${ctx.session.sessionName ?? ctx.session.type}: ${ctx.session.target}`
      : `${ctx.session.sessionName ?? ctx.session.type} — ${intentCategory} ${sport} session.`,
    training_block_context: blockCtx,
    intended_zones: "",
    intended_metrics: "",
    execution_summary: executionSummary,
    verdict_status: status,
    metric_comparisons: metricComparisons,
    key_deviations: [],
    non_obvious_insight: nonObviousInsight,
    teach: null,
    comparable_reference: comparableReference,
    adaptation_signal: adaptationSignal,
    adaptation_type: adaptationType,
    affected_session_ids: []
  };
}

// --- Humanize execution result before sending to AI ---

function formatPacePerKm(sec: number): string {
  const totalSec = Math.round(sec);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}

/**
 * Translates raw execution_result JSONB into human-readable key-value pairs
 * so the AI never sees camelCase field names like intervalCompletionPct.
 */
export function humanizeExecutionResult(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;

  const result: Record<string, unknown> = {};

  // Interval completion: 0-1 ratio → "X% of planned intervals completed" or "all planned intervals completed"
  const intervalPct = typeof raw.intervalCompletionPct === "number" ? raw.intervalCompletionPct : null;
  if (intervalPct !== null) {
    const pctRounded = Math.round(intervalPct * 100);
    result["interval_completion"] = pctRounded >= 100
      ? "all planned intervals completed (100%)"
      : `${pctRounded}% of planned intervals completed`;
  }

  // Time above target
  const timeAbove = typeof raw.timeAboveTargetPct === "number" ? raw.timeAboveTargetPct : null;
  if (timeAbove !== null) {
    result["time_above_target_zone"] = `${Math.round(timeAbove * 100)}%`;
  }

  // Duration completion
  const durCompletion = typeof raw.durationCompletion === "number" ? raw.durationCompletion : null;
  if (durCompletion !== null) {
    result["duration_completion"] = `${Math.round(durCompletion * 100)}%`;
  }

  // Heart rate
  if (typeof raw.avgHr === "number") result["avg_heart_rate"] = `${Math.round(raw.avgHr)} bpm`;
  if (typeof raw.maxHr === "number") result["max_heart_rate"] = `${Math.round(raw.maxHr)} bpm`;

  // Power
  if (typeof raw.avgIntervalPower === "number") result["avg_interval_power"] = `${Math.round(raw.avgIntervalPower)} W`;
  if (typeof raw.avgPower === "number") result["avg_power"] = `${Math.round(raw.avgPower)} W`;
  if (typeof raw.normalizedPower === "number") result["normalized_power"] = `${Math.round(raw.normalizedPower)} W`;
  if (typeof raw.maxPower === "number") result["max_power"] = `${Math.round(raw.maxPower)} W`;

  // Variability
  if (typeof raw.variabilityIndex === "number") result["variability_index"] = Number(raw.variabilityIndex).toFixed(2);

  // TSS / work
  if (typeof raw.trainingStressScore === "number") result["training_stress_score"] = `${Math.round(raw.trainingStressScore)} TSS`;
  if (typeof raw.totalWorkKj === "number") result["total_work"] = `${Math.round(raw.totalWorkKj)} kJ`;

  // Cadence
  if (typeof raw.avgCadence === "number") result["avg_cadence"] = `${Math.round(raw.avgCadence)}`;

  // Swim metrics
  if (typeof raw.avgPacePer100mSec === "number") result["avg_pace_per_100m"] = formatPace100m(raw.avgPacePer100mSec);
  if (typeof raw.bestPacePer100mSec === "number") result["best_pace_per_100m"] = formatPace100m(raw.bestPacePer100mSec);
  if (typeof raw.avgStrokeRateSpm === "number") result["avg_stroke_rate"] = `${Math.round(raw.avgStrokeRateSpm)} spm`;
  if (typeof raw.avgSwolf === "number") result["avg_swolf"] = `${Math.round(raw.avgSwolf)}`;

  // Elevation
  if (typeof raw.elevationGainM === "number") result["elevation_gain"] = `${Math.round(raw.elevationGainM)} m`;

  // Split metrics (HR drift, pace fade, cadence drift, swim halves, power halves)
  if (typeof raw.firstHalfAvgHr === "number" && typeof raw.lastHalfAvgHr === "number") {
    const drift = ((raw.lastHalfAvgHr - raw.firstHalfAvgHr) / raw.firstHalfAvgHr * 100).toFixed(1);
    result["hr_drift_first_to_second_half"] = `${drift}% (${Math.round(raw.firstHalfAvgHr)} → ${Math.round(raw.lastHalfAvgHr)} bpm)`;
  }
  if (typeof raw.firstHalfPaceSPerKm === "number" && typeof raw.lastHalfPaceSPerKm === "number") {
    const fadePct = ((raw.lastHalfPaceSPerKm - raw.firstHalfPaceSPerKm) / raw.firstHalfPaceSPerKm * 100).toFixed(1);
    result["pace_fade_first_to_second_half"] = `${formatPacePerKm(raw.firstHalfPaceSPerKm)} → ${formatPacePerKm(raw.lastHalfPaceSPerKm)} (${fadePct}%)`;
  }
  if (typeof raw.firstHalfAvgCadence === "number" && typeof raw.lastHalfAvgCadence === "number") {
    const delta = Math.round(raw.lastHalfAvgCadence - raw.firstHalfAvgCadence);
    const sign = delta >= 0 ? "+" : "";
    result["cadence_drift_first_to_second_half"] = `${Math.round(raw.firstHalfAvgCadence)} → ${Math.round(raw.lastHalfAvgCadence)} spm (${sign}${delta})`;
  }
  if (typeof raw.firstHalfPacePer100mSec === "number" && typeof raw.lastHalfPacePer100mSec === "number") {
    const fadePct = ((raw.lastHalfPacePer100mSec - raw.firstHalfPacePer100mSec) / raw.firstHalfPacePer100mSec * 100).toFixed(1);
    result["swim_pace_fade_first_to_second_half"] = `${formatPace100m(raw.firstHalfPacePer100mSec)} → ${formatPace100m(raw.lastHalfPacePer100mSec)} (${fadePct}%)`;
  }
  if (typeof raw.firstHalfStrokeRate === "number" && typeof raw.lastHalfStrokeRate === "number") {
    const delta = Math.round(raw.lastHalfStrokeRate - raw.firstHalfStrokeRate);
    const sign = delta >= 0 ? "+" : "";
    result["stroke_rate_drift_first_to_second_half"] = `${Math.round(raw.firstHalfStrokeRate)} → ${Math.round(raw.lastHalfStrokeRate)} spm (${sign}${delta})`;
  }
  if (typeof raw.firstHalfAvgPower === "number" && typeof raw.lastHalfAvgPower === "number") {
    const deltaPct = ((raw.lastHalfAvgPower - raw.firstHalfAvgPower) / raw.firstHalfAvgPower * 100).toFixed(1);
    result["power_drift_first_to_second_half"] = `${Math.round(raw.firstHalfAvgPower)} → ${Math.round(raw.lastHalfAvgPower)} W (${deltaPct}%)`;
  }

  // Scoring — omit execution_score and execution_score_band from model input;
  // the score is displayed separately in the UI and the prompt forbids mentioning it.
  if (typeof raw.diagnosisConfidence === "string") result["confidence"] = raw.diagnosisConfidence;
  if (typeof raw.executionCost === "string") result["execution_cost"] = raw.executionCost;
  if (typeof raw.intentMatchStatus === "string") {
    const statusMap: Record<string, string> = {
      matched_intent: "matched",
      partial_intent: "partial",
      missed_intent: "missed"
    };
    result["intent_match"] = statusMap[raw.intentMatchStatus] ?? raw.intentMatchStatus;
  }

  // Pass through narrative fields (already human-readable)
  if (typeof raw.executionSummary === "string") result["execution_summary"] = raw.executionSummary;
  if (typeof raw.summary === "string") result["summary"] = raw.summary;
  if (Array.isArray(raw.evidence)) result["evidence"] = raw.evidence;
  if (Array.isArray(raw.missingEvidence)) result["missing_evidence"] = raw.missingEvidence;

  // Pass through the verdict sub-object if present (it's already structured)
  if (raw.verdict && typeof raw.verdict === "object") result["verdict"] = raw.verdict;

  return result;
}

// --- Post-process AI output to remove raw seconds ---

/** Trim text to the last complete sentence if it looks truncated (ends mid-word or with open paren). */
function trimToLastSentence(text: string): string {
  const trimmed = text.trim();
  if (/[.!?]$/.test(trimmed)) return trimmed;
  // Find the last sentence-ending punctuation
  const lastPeriod = Math.max(trimmed.lastIndexOf(". "), trimmed.lastIndexOf(".\n"), trimmed.lastIndexOf("."));
  if (lastPeriod > trimmed.length * 0.5) return trimmed.slice(0, lastPeriod + 1);
  return trimmed;
}

/** Replace raw camelCase field names that the AI may echo despite instructions. */
export function sanitizeRawFieldNames(text: string): string {
  let result = text;
  // Replace camelCase metric names with human-readable equivalents
  const fieldMap: Array<[RegExp, string]> = [
    [/\bintervalCompletion(?:Pct)?\s*[=:]\s*([\d.]+)/gi, (_m: string, v: string) => {
      const pct = Math.round(parseFloat(v) * 100);
      return pct >= 100 ? "all planned intervals completed" : `${pct}% of planned intervals completed`;
    }] as unknown as [RegExp, string],
    [/\bintervalCompletion(?:Pct)?\b/gi, "interval completion"],
    [/\btimeAboveTargetPct\b/gi, "time above target"],
    [/\bavgPower\b/gi, "average power"],
    [/\bavgHr\b/gi, "average heart rate"],
    [/\bavgHR\b/g, "average HR"],
    [/\bnormalizedPower\b/gi, "normalized power"],
    [/\bvariabilityIndex\b/gi, "variability index"],
    [/\btrainingStressScore\b/gi, "training stress score"],
    [/\bavgCadence\b/gi, "average cadence"],
    [/\bavgPacePer100mSec\b/gi, "average pace per 100m"],
    [/\bavgStrokeRateSpm\b/gi, "average stroke rate"],
    [/\bavgSwolf\b/gi, "average SWOLF"],
    [/\belevationGainM\b/gi, "elevation gain"],
    [/\bdurationCompletion\b/gi, "duration completion"],
    [/\bexecutionScore\b/gi, "execution score"],
    [/\bexecutionScoreBand\b/gi, "score band"],
    [/\btotalWorkKj\b/gi, "total work"],
    [/\bmaxHr\b/gi, "max heart rate"],
    [/\bmaxPower\b/gi, "max power"],
  ];
  for (const [pattern, replacement] of fieldMap) {
    if (typeof replacement === "function") {
      result = result.replace(pattern, replacement as unknown as (...args: string[]) => string);
    } else {
      result = result.replace(pattern, replacement);
    }
  }
  // Handle "interval completion = 1" pattern (already partially replaced)
  result = result.replace(/interval completion\s*[=:]\s*([\d.]+)/gi, (_m, v) => {
    const pct = Math.round(parseFloat(v) * 100);
    return pct >= 100 ? "all planned intervals completed" : `${pct}% of planned intervals completed`;
  });
  // Handle comparison operators (≥, >=, <, ≤, etc.) — operator-aware phrasing
  result = result.replace(/interval completion\s*([≥≤]|>=|<=|>|<)\s*([\d.]+)/gi, (_m, op, v) => {
    const pct = Math.round(parseFloat(v) * 100);
    if (pct >= 100) return "all planned intervals completed";
    const isLessThan = /[<≤]/.test(op);
    const isStrict = op === "<" || op === ">";
    if (isLessThan) {
      return isStrict
        ? `less than ${pct}% of planned intervals completed`
        : `at most ${pct}% of planned intervals completed`;
    }
    return isStrict
      ? `more than ${pct}% of planned intervals completed`
      : `at least ${pct}% of planned intervals completed`;
  });
  // Strip any remaining execution score / score band references (camelCase already
  // humanised above; catch snake_case and plain English forms as a safety net).
  result = result.replace(/\bexecution[_ ]score\b(?:\s*(?:of|:|is|was|=)\s*[\d.]+%?)?/gi, "");
  result = result.replace(/\b(?:execution[_ ])?score[_ ]band\b(?:\s*(?:of|:|is|was|=)\s*\S+)?/gi, "");
  // Clean up leftover double spaces / orphan punctuation from stripping
  result = result.replace(/ {2,}/g, " ");

  // Expand NP/VI abbreviations in metric contexts
  result = result.replace(/\bNP\b(?=\s+(?:remains|target|within|of|from|rose|is|was|at|near|≈|~|\d))/g, "normalized power");
  result = result.replace(/today's NP\b/g, "today's normalized power");
  result = result.replace(/\bVI\b(?=\s+(?:of|was|is|at|\d))/g, "variability index");
  return result;
}

function normalizeSessionVerdictUnits(verdict: SessionVerdictOutput): SessionVerdictOutput {
  const n = (text: string) => sanitizeRawFieldNames(normalizeUnitString(text));
  return {
    ...verdict,
    purpose_statement: n(verdict.purpose_statement),
    training_block_context: n(verdict.training_block_context),
    intended_zones: n(verdict.intended_zones),
    intended_metrics: n(verdict.intended_metrics),
    execution_summary: n(verdict.execution_summary),
    non_obvious_insight: n(verdict.non_obvious_insight),
    comparable_reference: verdict.comparable_reference ? n(verdict.comparable_reference) : verdict.comparable_reference,
    adaptation_signal: trimToLastSentence(n(verdict.adaptation_signal)),
    metric_comparisons: verdict.metric_comparisons.map(mc => ({
      ...mc,
      metric: sanitizeRawFieldNames(mc.metric),
      target: n(mc.target),
      actual: n(mc.actual),
    })),
    key_deviations: verdict.key_deviations.map(d => ({
      ...d,
      metric: sanitizeRawFieldNames(d.metric),
      description: n(d.description),
    })),
  };
}

// --- Main generation function ---

export async function generateSessionVerdict(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<{
  verdict: SessionVerdictOutput;
  source: "ai" | "fallback";
  activityId: string | null;
  /**
   * Humanized feel snapshot from the context, mirroring what the LLM saw.
   * Persisted to `session_verdicts.feel_data` so downstream consumers read a
   * consistent label shape rather than the raw enum projection.
   */
  feel: Record<string, string> | null;
}> {
  const ctx = await buildSessionVerdictContext(supabase, userId, sessionId);
  if (!ctx) {
    throw new Error("Session not found or not accessible.");
  }

  const fallback = buildFallbackVerdict(ctx);

  // Get linked activity ID for storage
  const { data: storageLinks } = await supabase
    .from("session_activity_links")
    .select("completed_activity_id")
    .eq("planned_session_id", sessionId)
    .limit(1);
  const activityId = storageLinks?.[0]?.completed_activity_id ?? null;

  let priorHeadlines: SessionPriorHeadline[] = [];
  try {
    priorHeadlines = await fetchSessionVerdictPriorHeadlines(supabase, userId, ctx.session.date);
  } catch {
    priorHeadlines = [];
  }

  const result = await callOpenAIWithFallback<SessionVerdictOutput>({
    logTag: "session-verdict",
    fallback,
    logContext: { sessionId, userId },
    buildRequest: () => ({
      instructions: buildVerdictInstructions(),
      reasoning: { effort: "low" },
      max_output_tokens: 6000,
      text: {
        format: zodTextFormat(sessionVerdictOutputSchema, "session_verdict", {
          description: "Structured three-part session verdict."
        })
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify({
                ...ctx,
                feel: humanizeFeel(ctx.feel),
                executionResult: humanizeExecutionResult(ctx.executionResult),
                activity: ctx.activity ? {
                  ...ctx.activity,
                  durationSec: undefined,
                  durationFormatted: ctx.activity.durationSec
                    ? formatDuration(ctx.activity.durationSec)
                    : null,
                } : null,
                priorHeadlines: priorHeadlines.length > 0 ? priorHeadlines : null,
              })
            }
          ]
        }
      ]
    }),
    schema: sessionVerdictOutputSchema,
    normalizePayload: (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const record = raw as Record<string, unknown>;
      const patched: Record<string, unknown> = { ...record };
      if (!("teach" in record)) patched.teach = null;
      if (!("comparable_reference" in record)) {
        const camelCase = (record as { comparableReference?: unknown }).comparableReference;
        patched.comparable_reference = typeof camelCase === "string" && camelCase.length > 0
          ? camelCase.slice(0, 240)
          : null;
      }
      return patched;
    },
    postProcess: (verdict) => {
      const comparables = ctx.extendedSignals?.historicalComparables ?? [];
      const expected = comparables.length > 0 ? buildFallbackComparableReference(comparables) : null;
      if (comparables.length > 0 && !verdict.comparable_reference && expected) {
        console.warn("[session-verdict] Model omitted comparable_reference despite comparables in context; injecting deterministic reference", {
          sessionId,
          comparableCount: comparables.length
        });
        verdict = { ...verdict, comparable_reference: expected };
      }
      return normalizeSessionVerdictUnits(verdict);
    }
  });

  return {
    verdict: result.value,
    source: result.source,
    activityId,
    feel: humanizeFeel(ctx.feel)
  };
}
