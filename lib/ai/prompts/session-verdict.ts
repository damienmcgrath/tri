import "openai/shims/node";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import { normalizeUnitString } from "@/lib/execution-review";
import { getMacroContext } from "@/lib/training/macro-context";

export const SESSION_VERDICT_PROMPT_VERSION = "v1";

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
};

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
  const activityId = links?.[0]?.completed_activity_id;
  if (activityId) {
    const { data: act } = await supabase
      .from("completed_activities")
      .select("duration_sec, distance_m, avg_hr, avg_power, avg_pace_per_100m_sec, metrics_v2, execution_result")
      .eq("id", activityId)
      .maybeSingle();
    if (act) {
      activity = {
        durationSec: act.duration_sec,
        distanceM: act.distance_m,
        avgHr: act.avg_hr,
        avgPower: act.avg_power,
        avgPacePer100mSec: act.avg_pace_per_100m_sec ?? null,
        metrics: (act.metrics_v2 as Record<string, unknown>) ?? null
      };
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
    recentLoadTrend
  };
}

// --- AI prompt instructions ---

function buildVerdictInstructions(): string {
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
    "- Express durations in minutes (e.g. '37 min'). Express run pace as min:sec/km (e.g. '5:41/km'). Never write raw seconds.",
    "",
    "PART 3 — Adaptation Signal:",
    "- State what this means for upcoming training.",
    "- If well-executed: confirm the plan proceeds. Reference specific upcoming sessions.",
    "- If warning signs: flag specific sessions for potential modification.",
    "- If missed/off-target: explain redistribution or recovery implications.",
    "- If feel data contradicts objective metrics, acknowledge the mismatch explicitly.",
    "- Reference upcoming sessions by weekday name and sport, NOT by ISO date (e.g. 'Wednesday's bike' not '2026-04-09 bike').",
    "- Keep adaptation_signal to 2-3 sentences. Be direct, not exhaustive.",
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
    "- In execution_summary, write ONE clear sentence about whether the session achieved its purpose. Move specific metrics to metric_comparisons."
  ].join("\n");
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

function buildFallbackVerdict(ctx: SessionVerdictContext): SessionVerdictOutput {
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
    if (act.avgPower) {
      metricComparisons.push({
        metric: "Avg Power",
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

  const adaptationSignal = hasActivity
    ? "AI-generated adaptation analysis unavailable. The metrics above provide a baseline for manual review."
    : "No activity data to assess. If this session was missed, consider how to redistribute its training load.";

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
    adaptation_signal: adaptationSignal,
    adaptation_type: hasActivity ? "proceed" : "flag_review",
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
function humanizeExecutionResult(raw: Record<string, unknown> | null): Record<string, unknown> | null {
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

  // Split metrics (HR drift, pace fade)
  if (typeof raw.firstHalfAvgHr === "number" && typeof raw.lastHalfAvgHr === "number") {
    const drift = ((raw.lastHalfAvgHr - raw.firstHalfAvgHr) / raw.firstHalfAvgHr * 100).toFixed(1);
    result["hr_drift_first_to_second_half"] = `${drift}% (${Math.round(raw.firstHalfAvgHr)} → ${Math.round(raw.lastHalfAvgHr)} bpm)`;
  }
  if (typeof raw.firstHalfPaceSPerKm === "number" && typeof raw.lastHalfPaceSPerKm === "number") {
    result["pace_fade_first_to_second_half"] = `${formatPacePerKm(raw.firstHalfPaceSPerKm)} → ${formatPacePerKm(raw.lastHalfPaceSPerKm)}`;
  }

  // Scoring (keep as context but use human names)
  if (typeof raw.executionScore === "number") result["execution_score"] = raw.executionScore;
  if (typeof raw.executionScoreBand === "string") result["execution_score_band"] = raw.executionScoreBand;
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
function sanitizeRawFieldNames(text: string): string {
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
  // Handle comparison operators (≥, >=, etc.)
  result = result.replace(/interval completion\s*[≥>=<≤]+\s*([\d.]+)/gi, (_m, v) => {
    const pct = Math.round(parseFloat(v) * 100);
    return pct >= 100 ? "all planned intervals completed" : `at least ${pct}% of planned intervals completed`;
  });
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
): Promise<{ verdict: SessionVerdictOutput; source: "ai" | "fallback"; activityId: string | null }> {
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
                executionResult: humanizeExecutionResult(ctx.executionResult),
                activity: ctx.activity ? {
                  ...ctx.activity,
                  durationSec: undefined,
                  durationFormatted: ctx.activity.durationSec
                    ? formatDuration(ctx.activity.durationSec)
                    : null,
                } : null,
              })
            }
          ]
        }
      ]
    }),
    schema: sessionVerdictOutputSchema,
    postProcess: normalizeSessionVerdictUnits
  });

  return { verdict: result.value, source: result.source, activityId };
}
