import "openai/shims/node";
import { zodTextFormat } from "openai/helpers/zod";
import { asObject, asString, asStringArray, clip } from "@/lib/openai";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import {
  SESSION_VARIANCE_PROMPT,
  type SessionPriorHeadline,
} from "@/lib/ai/session-variance-corpus";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import type { HistoricalComparable } from "@/lib/analytics/historical-comparables";
import { diagnoseCompletedSession, type SessionDiagnosisInput } from "@/lib/coach/session-diagnosis";
import {
  type ExecutionEvidence,
  type CoachVerdict,
  coachVerdictSchema,
  COACH_VERDICT_JSON_EXAMPLE,
} from "@/lib/execution-review-types";
import { COACH_VERDICT_FEW_SHOT_JSON } from "@/lib/execution-review-examples";
import {
  nextCallFromEvidence,
  buildEvidenceSummary,
} from "@/lib/execution-review-persistence";

// Re-export types and persistence so existing imports from "@/lib/execution-review" keep working.
export type { ExecutionEvidence, CoachVerdict, WeeklyExecutionBrief, PersistedExecutionReview } from "@/lib/execution-review-types";
export {
  toPersistedExecutionReview,
  parsePersistedExecutionReview,
  refreshObservedPatterns,
  buildWeeklyExecutionBrief,
} from "@/lib/execution-review-persistence";

function toIntentMatch(status: "matched_intent" | "partial_intent" | "missed_intent") {
  if (status === "matched_intent") return "on_target" as const;
  if (status === "missed_intent") return "missed" as const;
  return "partial" as const;
}

function deriveMissingEvidence(input: SessionDiagnosisInput) {
  const missing: string[] = [];
  if (!input.actual.durationSec) missing.push("completed duration");
  if (input.planned.plannedIntervals && input.actual.intervalCompletionPct === null && input.actual.completedIntervals === null) missing.push("interval completion");
  if (!input.actual.avgHr && !input.actual.avgPower && !input.actual.avgPaceSPerKm) missing.push("intensity data");
  if (!input.actual.splitMetrics || Object.keys(input.actual.splitMetrics).length === 0) missing.push("split comparison");
  return missing;
}

function getIssueSeverity(code: string) {
  if (["too_hard", "incomplete_reps", "faded_late", "started_too_hard"].includes(code)) return "high" as const;
  if (["high_hr", "under_target", "over_target", "shortened", "late_drift"].includes(code)) return "moderate" as const;
  return "low" as const;
}

function getActualMetric(input: SessionDiagnosisInput["actual"], key: string) {
  const value = input.metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildSportSpecificEvidence(input: SessionDiagnosisInput): ExecutionEvidence["actual"]["sportSpecific"] {
  const splitMetrics = input.actual.splitMetrics ?? null;
  const avgHr = input.actual.avgHr ?? null;
  const maxHr = getActualMetric(input.actual, "max_hr");
  const trainingStressScore = getActualMetric(input.actual, "training_stress_score");
  const aerobicTrainingEffect = getActualMetric(input.actual, "aerobic_training_effect");
  const anaerobicTrainingEffect = getActualMetric(input.actual, "anaerobic_training_effect");

  switch (input.planned.sport ?? "other") {
    case "run":
      return {
        run: {
          avgPaceSPerKm: input.actual.avgPaceSPerKm ?? null,
          bestPaceSPerKm: getActualMetric(input.actual, "best_pace_s_per_km"),
          normalizedGradedPaceSPerKm: getActualMetric(input.actual, "normalized_graded_pace_s_per_km"),
          avgHr,
          maxHr,
          hrZoneTimeSec: getActualMetric(input.actual, "hr_zone_time_sec"),
          paceZoneTimeSec: getActualMetric(input.actual, "pace_zone_time_sec"),
          avgCadence: getActualMetric(input.actual, "avg_cadence"),
          maxCadence: getActualMetric(input.actual, "max_cadence"),
          elevationGainM: getActualMetric(input.actual, "elevation_gain_m"),
          elevationLossM: getActualMetric(input.actual, "elevation_loss_m"),
          trainingStressScore,
          aerobicTrainingEffect,
          anaerobicTrainingEffect,
          splitMetrics
        }
      };
    case "swim":
      return {
        swim: {
          avgPacePer100mSec: getActualMetric(input.actual, "avg_pace_per_100m_sec"),
          bestPacePer100mSec: getActualMetric(input.actual, "best_pace_per_100m_sec"),
          avgStrokeRateSpm: getActualMetric(input.actual, "avg_stroke_rate_spm"),
          maxStrokeRateSpm: getActualMetric(input.actual, "max_stroke_rate_spm"),
          avgSwolf: getActualMetric(input.actual, "avg_swolf"),
          poolLengthM: getActualMetric(input.actual, "pool_length_m"),
          lengthCount: getActualMetric(input.actual, "length_count"),
          paceZoneTimeSec: getActualMetric(input.actual, "pace_zone_time_sec"),
          trainingStressScore,
          aerobicTrainingEffect,
          anaerobicTrainingEffect,
          splitMetrics
        }
      };
    case "bike":
      return {
        bike: {
          avgPower: input.actual.avgPower ?? null,
          normalizedPower: getActualMetric(input.actual, "normalized_power"),
          maxPower: getActualMetric(input.actual, "max_power"),
          intensityFactor: getActualMetric(input.actual, "intensity_factor"),
          variabilityIndex: input.actual.variabilityIndex ?? null,
          totalWorkKj: getActualMetric(input.actual, "total_work_kj"),
          avgCadence: getActualMetric(input.actual, "avg_cadence"),
          maxCadence: getActualMetric(input.actual, "max_cadence"),
          avgHr,
          maxHr,
          hrZoneTimeSec: getActualMetric(input.actual, "hr_zone_time_sec"),
          trainingStressScore,
          aerobicTrainingEffect,
          anaerobicTrainingEffect,
          splitMetrics
        }
      };
    case "strength":
      return {
        strength: {
          durationSec: input.actual.durationSec ?? null,
          intervalCompletionPct: input.actual.intervalCompletionPct ?? null,
          avgHr,
          maxHr,
          timeAboveTargetPct: input.actual.timeAboveTargetPct ?? null,
          trainingStressScore,
          aerobicTrainingEffect,
          anaerobicTrainingEffect
        }
      };
    default:
      return null;
  }
}

function buildActualEvidence(input: SessionDiagnosisInput): ExecutionEvidence["actual"] {
  return {
    durationSec: input.actual.durationSec ?? null,
    avgHr: input.actual.avgHr ?? null,
    avgPower: input.actual.avgPower ?? null,
    avgIntervalPower: input.actual.avgIntervalPower ?? null,
    avgPaceSPerKm: input.actual.avgPaceSPerKm ?? null,
    timeAboveTargetPct: input.actual.timeAboveTargetPct ?? null,
    intervalCompletionPct: input.actual.intervalCompletionPct ?? null,
    variabilityIndex: input.actual.variabilityIndex ?? null,
    normalizedPower: getActualMetric(input.actual, "normalized_power"),
    trainingStressScore: getActualMetric(input.actual, "training_stress_score"),
    intensityFactor: getActualMetric(input.actual, "intensity_factor"),
    totalWorkKj: getActualMetric(input.actual, "total_work_kj"),
    avgCadence: getActualMetric(input.actual, "avg_cadence"),
    maxCadence: getActualMetric(input.actual, "max_cadence"),
    bestPaceSPerKm: getActualMetric(input.actual, "best_pace_s_per_km"),
    normalizedGradedPaceSPerKm: getActualMetric(input.actual, "normalized_graded_pace_s_per_km"),
    avgPacePer100mSec: getActualMetric(input.actual, "avg_pace_per_100m_sec"),
    bestPacePer100mSec: getActualMetric(input.actual, "best_pace_per_100m_sec"),
    avgStrokeRateSpm: getActualMetric(input.actual, "avg_stroke_rate_spm"),
    maxStrokeRateSpm: getActualMetric(input.actual, "max_stroke_rate_spm"),
    avgSwolf: getActualMetric(input.actual, "avg_swolf"),
    elevationGainM: getActualMetric(input.actual, "elevation_gain_m"),
    elevationLossM: getActualMetric(input.actual, "elevation_loss_m"),
    poolLengthM: getActualMetric(input.actual, "pool_length_m"),
    lengthCount: getActualMetric(input.actual, "length_count"),
    hrZoneTimeSec: getActualMetric(input.actual, "hr_zone_time_sec"),
    paceZoneTimeSec: getActualMetric(input.actual, "pace_zone_time_sec"),
    maxHr: getActualMetric(input.actual, "max_hr"),
    maxPower: getActualMetric(input.actual, "max_power"),
    aerobicTrainingEffect: getActualMetric(input.actual, "aerobic_training_effect"),
    anaerobicTrainingEffect: getActualMetric(input.actual, "anaerobic_training_effect"),
    splitMetrics: input.actual.splitMetrics ?? null,
    sportSpecific: buildSportSpecificEvidence(input)
  };
}

// asObject, asString, asStringArray, clip are now imported from @/lib/openai

/**
 * Build a deterministic `comparableReference` string from the injected
 * historical comparables. Used by the fallback verdict and as the sanity-check
 * replacement when the model forgets the field. Returns null when no
 * comparables are present — the schema allows null, and fabricating a
 * reference would violate the "don't invent facts" contract.
 */
function buildDeterministicComparableReference(
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
  if (typeof first.avgPaceSPerKm === "number") metricBits.push(formatSecondsToPacePerKm(first.avgPaceSPerKm));
  if (typeof first.avgPacePer100mSec === "number") metricBits.push(formatSecondsToPacePer100m(first.avgPacePer100mSec));
  const base = metricBits.length > 0
    ? `${first.date}${titleSegment}: ${metricBits.join(", ")}`
    : `${first.date}${titleSegment}`;
  const takeaway = first.takeaway ? ` — ${first.takeaway}` : "";
  return clip(`${base}${takeaway}`, 240);
}

function formatSecondsToPacePer100m(sec: number): string {
  const totalSec = Math.round(sec);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}/100m`;
}

function normalizeNextCall(value: unknown): CoachVerdict["sessionVerdict"]["nextCall"] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "move_on" ||
    normalized === "proceed_with_caution" ||
    normalized === "repeat_session" ||
    normalized === "protect_recovery" ||
    normalized === "adjust_next_key_session"
  ) {
    return normalized;
  }
  if (normalized === "proceed" || normalized === "continue" || normalized === "carry_on") {
    return "proceed_with_caution";
  }
  if (normalized === "moveon" || normalized === "move") {
    return "move_on";
  }
  if (normalized === "repeat") {
    return "repeat_session";
  }
  if (normalized === "recover" || normalized === "protect") {
    return "protect_recovery";
  }
  if (normalized === "adjust_next_session" || normalized === "adjust") {
    return "adjust_next_key_session";
  }
  return null;
}

function normalizeSessionVerdictFields(
  sessionVerdict: Record<string, unknown>,
  defaults?: {
    intentMatch: CoachVerdict["sessionVerdict"]["intentMatch"];
    executionCost: CoachVerdict["sessionVerdict"]["executionCost"];
    nextCall: CoachVerdict["sessionVerdict"]["nextCall"];
  }
): Record<string, unknown> {
  return {
    ...sessionVerdict,
    intentMatch: sessionVerdict.intentMatch ?? defaults?.intentMatch,
    executionCost: sessionVerdict.executionCost ?? defaults?.executionCost,
    nextCall: normalizeNextCall(sessionVerdict.nextCall) ?? sessionVerdict.nextCall ?? defaults?.nextCall
  };
}

function normalizeCoachVerdictPayload(
  payload: unknown,
  defaults?: {
    intentMatch: CoachVerdict["sessionVerdict"]["intentMatch"];
    executionCost: CoachVerdict["sessionVerdict"]["executionCost"];
    nextCall: CoachVerdict["sessionVerdict"]["nextCall"];
  }
): unknown {
  const root = asObject(payload);
  if (!root) return payload;

  if ("sessionVerdict" in root || "explanation" in root || "uncertainty" in root || "citedEvidence" in root) {
    const sessionVerdict = asObject(root.sessionVerdict);
    if (!sessionVerdict) return root;
    return {
      ...root,
      sessionVerdict: normalizeSessionVerdictFields(sessionVerdict, defaults)
    };
  }

  for (const key of ["verdict", "review", "coachVerdict", "coach_verdict", "result", "data", "output"]) {
    const candidate = asObject(root[key]);
    if (!candidate) continue;
    if ("sessionVerdict" in candidate || "explanation" in candidate || "uncertainty" in candidate || "citedEvidence" in candidate) {
      const sessionVerdict = asObject(candidate.sessionVerdict);
      return {
        ...candidate,
        sessionVerdict: sessionVerdict
          ? normalizeSessionVerdictFields(sessionVerdict, defaults)
          : candidate.sessionVerdict
      };
    }
  }

  const summary = asString(root.summary);
  const whatHappened = asString(root.whatHappened);
  const whyItMatters = asString(root.interpretation_for_session) ?? asString(root.interpretationForSession);
  const whatToDoThisWeek = asString(root.what_this_means_for_the_week) ?? asString(root.whatThisMeansForTheWeek);
  const practicalNextSteps = asObject(root.practical_next_steps) ?? asObject(root.practicalNextSteps);
  const nextTime =
    asString(practicalNextSteps?.next_session) ??
    asString(practicalNextSteps?.nextSession) ??
    asString(root.next_session) ??
    asString(root.nextSession);
  const thisWeek =
    asString(practicalNextSteps?.this_week) ??
    asString(practicalNextSteps?.thisWeek) ??
    whatToDoThisWeek;
  const uncertaintyBlock = asObject(root.constraints_and_uncertainties) ?? asObject(root.constraintsAndUncertainties);
  const questionsBlock = asObject(root.questions_for_you) ?? asObject(root.questionsForYou);
  const confidence = asString(root.confidence);

  if (summary || whatHappened || whyItMatters || thisWeek || nextTime) {
    const missingEvidence = [
      ...asStringArray(uncertaintyBlock?.missingEvidence),
      ...asStringArray(uncertaintyBlock?.missing_evidence)
    ].slice(0, 8);
    const uncertaintyDetailParts = [
      asString(uncertaintyBlock?.summary),
      asString(uncertaintyBlock?.detail),
      ...asStringArray(questionsBlock?.items),
      ...asStringArray(questionsBlock?.questions)
    ].filter((item): item is string => item !== null);

    return {
      sessionVerdict: {
        headline: clip(summary ?? "Session review", 160),
        summary: clip(summary ?? whatHappened ?? "Execution evidence is available for review.", 500),
        intentMatch: defaults?.intentMatch ?? "partial",
        executionCost: defaults?.executionCost ?? "unknown",
        confidence: confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : "medium",
        nextCall: defaults?.nextCall ?? "proceed_with_caution"
      },
      explanation: {
        whatHappened: clip(whatHappened ?? summary ?? "Execution evidence is available for review.", 500),
        whyItMatters: clip(whyItMatters ?? "Use this review conservatively and in the context of the rest of the week.", 500),
        whatToDoNextTime: clip(nextTime ?? "Use one clear execution cue on the next similar session.", 500),
        whatToDoThisWeek: clip(thisWeek ?? "Keep the rest of the week stable and use this review as guidance for the next similar session.", 500)
      },
      nonObviousInsight: clip(
        asString(root.nonObviousInsight) ??
          asString(root.non_obvious_insight) ??
          "No comparative history or cross-session signal was strong enough to surface a non-obvious finding for this session.",
        320
      ),
      comparableReference: (() => {
        const candidate = asString(root.comparableReference) ?? asString(root.comparable_reference);
        return candidate ? clip(candidate, 240) : null;
      })(),
      uncertainty: {
        label: missingEvidence.length > 0 || uncertaintyDetailParts.length > 0 ? "early_read" : "confident_read",
        detail: clip(
          uncertaintyDetailParts.join(" ").trim() || "This read is grounded in the available execution evidence.",
          500
        ),
        missingEvidence
      },
      citedEvidence: summary
        ? [{
            claim: clip(summary, 200),
            support: [clip(whatHappened ?? whyItMatters ?? summary, 180)]
          }]
        : []
    };
  }

  return payload;
}

function coerceCoachVerdictPayload(
  payload: unknown,
  defaults: {
    intentMatch: CoachVerdict["sessionVerdict"]["intentMatch"];
    executionCost: CoachVerdict["sessionVerdict"]["executionCost"];
    nextCall: CoachVerdict["sessionVerdict"]["nextCall"];
  }
) {
  const normalizedPayload = ensureOptionalInsightFields(
    normalizeCoachVerdictPayload(payload, defaults)
  );
  const parsed = coachVerdictSchema.safeParse(normalizedPayload);
  return {
    normalizedPayload,
    parsed
  };
}

/**
 * Inject `teach: null` and `comparableReference: null` when the payload does
 * not already carry them. Legacy payloads (DB-stored verdicts written before
 * these fields existed, hand-written test fixtures, LLM drops) would
 * otherwise fail zod validation now that both are required nullable fields.
 */
function ensureOptionalInsightFields(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  const patched: Record<string, unknown> = { ...record };
  if (!("teach" in record)) patched.teach = null;
  if (!("comparableReference" in record)) {
    const snakeCase = (record as { comparable_reference?: unknown }).comparable_reference;
    patched.comparableReference = typeof snakeCase === "string" && snakeCase.length > 0
      ? clip(snakeCase, 240)
      : null;
  }
  return patched;
}

function formatSecondsToDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const totalMin = Math.round(sec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

function formatSecondsToPacePerKm(sec: number): string {
  const totalSec = Math.round(sec);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}

export function normalizeUnitString(text: string): string {
  // Replace bare seconds (e.g. "2,239 s", "2239s", "2700 sec", "4500 seconds") — not s/km
  let result = text.replace(/(\d[\d,]*(?:\.\d+)?)\s*(?:seconds?|secs?|s\b)(?!\/km)/g, (_match, numStr: string) => {
    const sec = parseFloat(numStr.replace(/,/g, ""));
    return formatSecondsToDuration(sec);
  });
  // Replace pace in s/km (e.g. "341.63 s/km", "341 sec/km", "341 seconds/km")
  result = result.replace(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\/km/g, (_match, numStr: string) => {
    return formatSecondsToPacePerKm(parseFloat(numStr));
  });
  return result;
}

export function normalizeVerdictUnitsForTest(text: string): string {
  return normalizeUnitString(text);
}

function normalizeVerdictUnits(verdict: CoachVerdict): CoachVerdict {
  const n = normalizeUnitString;
  return {
    ...verdict,
    sessionVerdict: {
      ...verdict.sessionVerdict,
      headline: n(verdict.sessionVerdict.headline),
      summary: n(verdict.sessionVerdict.summary)
    },
    explanation: {
      ...(verdict.explanation.sessionIntent ? { sessionIntent: n(verdict.explanation.sessionIntent) } : {}),
      whatHappened: n(verdict.explanation.whatHappened),
      whyItMatters: n(verdict.explanation.whyItMatters),
      ...(verdict.explanation.oneThingToChange ? { oneThingToChange: n(verdict.explanation.oneThingToChange) } : {}),
      whatToDoNextTime: n(verdict.explanation.whatToDoNextTime),
      whatToDoThisWeek: n(verdict.explanation.whatToDoThisWeek)
    },
    nonObviousInsight: n(verdict.nonObviousInsight),
    comparableReference: verdict.comparableReference ? n(verdict.comparableReference) : verdict.comparableReference,
    uncertainty: {
      ...verdict.uncertainty,
      detail: n(verdict.uncertainty.detail)
    },
    citedEvidence: verdict.citedEvidence.map((e) => ({
      claim: n(e.claim),
      support: e.support.map(n)
    }))
  };
}

export function coerceCoachVerdictPayloadForTest(
  payload: unknown,
  defaults: {
    intentMatch: CoachVerdict["sessionVerdict"]["intentMatch"];
    executionCost: CoachVerdict["sessionVerdict"]["executionCost"];
    nextCall: CoachVerdict["sessionVerdict"]["nextCall"];
  }
) {
  return coerceCoachVerdictPayload(payload, defaults);
}

function buildCoachVerdictInstructions() {
  return [
    "You are an endurance coach helping athletes interpret completed workouts.",
    "Use only the provided evidence and context.",
    "Do not invent metrics, missing facts, unsupported causes, or unsupported comparisons.",
    "Return exactly one JSON object that matches the required schema below.",
    "Do not wrap the object in keys like data, review, result, output, or verdict.",
    "Do not rename any keys.",
    "Keep enum values exactly as specified.",
    "Keep `citedEvidence` as an array of objects with `claim` and `support` only.",
    "Keep each `support` entry as a plain string, not an object.",
    "If evidence is limited, reflect that in `uncertainty` and keep recommendations conservative.",
    "If you mention shorthand metrics such as IF, VI, SWOLF, TSS, or training effect, explain them in plain athlete-friendly language in the same sentence.",
    "Express durations in minutes (e.g. '37 min', '1 h 15 min'). Never write raw seconds.",
    "Express run pace as min:sec/km (e.g. '5:41/km'). Never write raw seconds per km.",
    "",
    "Prescriptive review rules:",
    "- Speak with direct authority. State findings. Do not hedge.",
    "- Never lead with duration comparison. Evaluate intensity compliance first, pacing second, duration third.",
    "- For interval sessions: evaluate interval quality before mentioning whether all were completed.",
    "- For endurance sessions: evaluate intensity compliance before mentioning duration.",
    "- Always use the NEXT format for oneThingToChange, regardless of score: 'NEXT [session type]: [specific target with numbers]. [success criterion]. [progression cue if criterion met].'",
    "- For 90+ scores, still restate the numeric target (pace ceiling, HR cap, interval structure) and add a progression trigger (e.g. 'if HR holds, extend by 10 min next time').",
    "- Do not use words like 'appears', 'seems', 'might', 'possibly', 'likely'. State what the data shows.",
    "",
    "Extended signals:",
    "- `extendedSignals.historicalComparables` lists up to four previous same-sport, same-intent sessions with their execution score, pace/power, HR, and stored takeaway. Use these to frame trends (\"third threshold bike in a row with HR creeping higher for the same power\"). If the array is empty, skip trend claims.",
    "- `extendedSignals.aerobicDecoupling` reports how the HR-per-output ratio changed from the first to the second half of this session. `percent` is the raw drift; `severity` maps to stable (<3%), mild_drift (3-5%), significant_drift (5-10%), or poor_durability (≥10%). Reference decoupling only for endurance or tempo sessions where it is load-bearing, never for short intervals or strength.",
    "- `extendedSignals.weather` carries the session's temperature data and a `notable` flag list (hot, warm, cool, cold, large range). Use it to contextualise HR/pace deviations — a hot day explains HR elevation at the same pace without implying fitness loss.",
    "- These signals are inputs, not requirements. If a signal is null or empty, do not mention it and do not invent one.",
    "",
    "nonObviousInsight rules:",
    "- Every verdict must include a `nonObviousInsight` (≤320 chars) — a finding the athlete would not reach by glancing at this session alone.",
    "- Draw it from: a comparison against `historicalComparables`, a `aerobicDecoupling` trend, a weather-adjusted interpretation, or a correlation between feel and execution across `recentReviewedSessions`.",
    "- Do not repeat what is already in `whatHappened`. If you cannot surface something genuinely non-obvious from the evidence, state that honestly (e.g. \"Not enough prior sessions in this intent category to establish a trend yet.\") — but still use this field.",
    "- No generic coaching platitudes. Ground every claim in a specific number, date, or signal.",
    "",
    "teach (optional, ≤200 chars):",
    "- Use `teach` when this session exposes a mechanistically important metric — variability index spike, aerobic decoupling, negative-split failure, durability fade, cadence drop, HR↔pace divergence, power-per-HR shift, or similar. Explain in one sentence *why* that metric matters for this athlete's training.",
    "- Prefer a different mechanism than the last few `priorHeadlines`. Rotate focus — do not teach the same concept two sessions in a row.",
    "- If no mechanism is worth teaching on this session, set `teach` to null. Do not manufacture a teach moment to fill the field.",
    "- `teach` is separate from `nonObviousInsight`: insight observes *what* is true; teach explains *why* it matters.",
    "",
    "comparableReference (≤240 chars):",
    "- When `extendedSignals.historicalComparables` has ≥1 entry, `comparableReference` MUST be non-null and cite at least one prior session by its date, naming the metric delta (HR, pace, power, execution score, or takeaway). Example: \"2026-04-06 threshold bike: 168 bpm at 245 W; today 172 bpm at 245 W.\"",
    "- When `historicalComparables` is empty (no prior same-intent session), set `comparableReference` to null. Do not invent a comparable.",
    "- `comparableReference` is the hard-wired proof that the injected history was actually used; it complements `nonObviousInsight` rather than duplicating it.",
    "",
    "Pacing and cadence halves:",
    "- `actual.splitMetrics` carries first-half vs last-half values for HR, pace, power, cadence, pace-per-100m, and stroke rate. When two halves differ materially (cadence drop ≥3 spm, pace fade ≥3%, power drop ≥5%, stroke-rate drift on swim), cite the split comparison directly in `whatHappened` or `citedEvidence` — this is the cleanest negative-split / durability read available.",
    "- Do not invent halves that are not present. If `splitMetrics` is null, do not claim a split pattern.",
    "",
    SESSION_VARIANCE_PROMPT,
    "",
    "Field requirements:",
    "- `sessionVerdict.headline`: short label, max 160 chars.",
    "- `sessionVerdict.summary`: one concise session verdict, max 500 chars.",
    "- `sessionVerdict.intentMatch`: must match the provided deterministic intent result.",
    "- `sessionVerdict.executionCost`: must stay consistent with the provided deterministic execution cost.",
    "- `sessionVerdict.nextCall`: choose one allowed enum only.",
    "- `explanation.sessionIntent` (optional): one sentence on the physiological purpose of this session, max 300 chars.",
    "- `explanation.whatHappened`: factual session read evaluating intensity first, pacing second, duration third. Max 500 chars.",
    "- `explanation.whyItMatters`: what it means for adaptation or the week, max 500 chars.",
    "- `explanation.oneThingToChange` (optional): single concrete instruction using NEXT format, max 500 chars.",
    "- `explanation.whatToDoNextTime`: one practical cue for the next similar session, max 500 chars.",
    "- `explanation.whatToDoThisWeek`: how to handle the rest of this week, max 500 chars.",
    "- `nonObviousInsight`: one finding grounded in an extended signal, max 320 chars. Required.",
    "- `teach`: optional mechanistic explanation, max 200 chars. Null when nothing is worth teaching.",
    "- `comparableReference`: cite of ≥1 prior session by date + metric delta, max 240 chars. Required non-null when historicalComparables is non-empty; null otherwise.",
    "- `uncertainty.label`: one of `confident_read`, `early_read`, `insufficient_data`.",
    "- `uncertainty.detail`: explain the confidence level plainly, max 500 chars.",
    "- `uncertainty.missingEvidence`: array of missing evidence strings, max 8 items.",
    "- `citedEvidence`: max 4 items.",
    "- `citedEvidence[].claim`: max 200 chars.",
    "- `citedEvidence[].support`: max 4 short support strings, each max 180 chars.",
    "Required output schema example:",
    COACH_VERDICT_JSON_EXAMPLE,
    "",
    "Few-shot examples (three realistic verdicts across different intent categories; separated by `---`). Follow the shape, tone, and specificity — do not copy wording:",
    COACH_VERDICT_FEW_SHOT_JSON
  ].join("\n");
}

function deriveExecutionCost(params: {
  timeAboveTargetPct: number | null;
  hrDrift: number | null;
  paceFade: number | null;
  intervalCompletionPct: number | null;
  durationCompletion: number | null;
  fatigue: number | null;
}) {
  let burden = 0;
  if ((params.timeAboveTargetPct ?? 0) >= 0.25) burden += 2;
  if ((params.hrDrift ?? 1) > 1.06) burden += 2;
  if ((params.paceFade ?? 1) > 1.1) burden += 2;
  if ((params.intervalCompletionPct ?? 1) < 0.85) burden += 1;
  if ((params.durationCompletion ?? 1) < 0.9) burden += 1;
  if ((params.fatigue ?? 0) >= 4) burden += 1;
  if (burden >= 5) return "high" as const;
  if (burden >= 2) return "moderate" as const;
  if (burden === 0) return "low" as const;
  return "moderate" as const;
}

function buildDeterministicVerdict(evidence: ExecutionEvidence): CoachVerdict {
  const intentMatch = evidence.rulesSummary.intentMatch;
  const nextCall = nextCallFromEvidence(intentMatch, evidence.rulesSummary.executionCost);
  const confidence = evidence.rulesSummary.confidence;
  const summary =
    intentMatch === "on_target"
      ? "The intended training purpose appears to have landed with controlled execution."
      : intentMatch === "missed"
        ? "The session came up short of its intended purpose, so the next call should stay conservative."
        : "Some of the intended stimulus landed, but key parts of the execution were uneven.";
  const uncertaintyLabel =
    confidence === "high"
      ? "confident_read"
      : evidence.rulesSummary.evidenceCount > 0
        ? "early_read"
        : "insufficient_data";

  const decoupling = evidence.extendedSignals?.aerobicDecoupling ?? null;
  const comparables = evidence.extendedSignals?.historicalComparables ?? [];
  const weatherNotable = evidence.extendedSignals?.weather?.notable ?? [];
  const comparableReference = buildDeterministicComparableReference(comparables);
  let nonObviousInsight: string;
  if (decoupling && (decoupling.severity === "significant_drift" || decoupling.severity === "poor_durability")) {
    nonObviousInsight = `Cardiac-to-output drift of ${decoupling.percent.toFixed(1)}% from the first half to the second points at aerobic durability, not top-end capacity, as the current limiter.`;
  } else if (comparables.length >= 2) {
    const scores = comparables
      .map((c) => c.executionScore)
      .filter((n): n is number => typeof n === "number");
    if (scores.length >= 2) {
      const trend = scores[0] > scores[scores.length - 1] ? "improving" : scores[0] < scores[scores.length - 1] ? "sliding" : "flat";
      nonObviousInsight = `This is your ${comparables.length + 1}${comparables.length + 1 === 2 ? "nd" : comparables.length + 1 === 3 ? "rd" : "th"} session in this intent category; execution scores are ${trend} vs. your recent history.`;
    } else {
      nonObviousInsight = `Compared against ${comparables.length} prior session${comparables.length === 1 ? "" : "s"} in this intent category, this read fits the pattern rather than breaking it.`;
    }
  } else if (weatherNotable.length > 0) {
    nonObviousInsight = `Conditions today (${weatherNotable.join(", ")}) materially shift how HR and pace should be interpreted — adjust expectations accordingly.`;
  } else {
    nonObviousInsight = "Not enough prior sessions in this intent category to establish a trend yet. A fresh comparative read will emerge after the next one or two completed sessions like this.";
  }

  return {
    sessionVerdict: {
      headline:
        intentMatch === "on_target"
          ? "Intent landed"
          : intentMatch === "missed"
            ? "Intent came up short"
            : "Intent only partially landed",
      summary,
      intentMatch,
      executionCost: evidence.rulesSummary.executionCost,
      confidence,
      nextCall
    },
    explanation: {
      sessionIntent: evidence.planned.intentCategory
        ? `${evidence.planned.intentCategory} — targeting the planned training stimulus for this session.`
        : undefined,
      whatHappened: evidence.detectedIssues.length > 0
        ? `Key execution issues: ${evidence.detectedIssues.slice(0, 2).map((issue) => issue.code.replaceAll("_", " ")).join(", ")}.`
        : "Execution stayed close to the planned session targets.",
      whyItMatters:
        intentMatch === "on_target"
          ? "Matching the planned intent protects the adaptation you wanted from the day and supports the rest of the week."
          : "When execution drifts, the session can stop delivering the precise stimulus the week depends on.",
      oneThingToChange:
        intentMatch === "on_target"
          ? `NEXT ${evidence.planned.intentCategory ?? "session"}: hold the same targets. If it still feels controlled, progress duration by ~10% or tighten the interval structure next time.`
          : intentMatch === "missed"
            ? `NEXT ${evidence.planned.intentCategory ?? "session"}: start more conservatively and protect the key work before adding intensity.`
            : `NEXT ${evidence.planned.intentCategory ?? "session"}: tighten control earlier in the session.`,
      whatToDoNextTime:
        intentMatch === "on_target"
          ? "Repeat the same pacing and control on the next similar session."
          : intentMatch === "missed"
            ? "Start more conservatively and protect the key work before adding intensity."
            : "Keep one clear execution cue in mind and tighten control earlier in the session.",
      whatToDoThisWeek:
        nextCall === "protect_recovery"
          ? "Protect recovery and avoid adding extra load off this one session."
          : nextCall === "repeat_session"
            ? "Keep the week steady and consider repeating the intent before progressing."
            : nextCall === "adjust_next_key_session"
              ? "Keep the next key session controlled rather than forcing progression."
              : "Move into the rest of the week as planned."
    },
    nonObviousInsight,
    teach: null,
    comparableReference,
    uncertainty: {
      label: uncertaintyLabel,
      detail:
        uncertaintyLabel === "confident_read"
          ? "This read is grounded in enough execution evidence to be used with confidence."
          : uncertaintyLabel === "early_read"
            ? "This is a useful early read, but some execution details are still missing."
            : "There is not enough execution detail to support a strong coaching judgment.",
      missingEvidence: evidence.missingEvidence
    },
    citedEvidence: [
      {
        claim:
          intentMatch === "on_target"
            ? "The session mostly matched the planned intent."
            : intentMatch === "missed"
              ? "The session missed the intended training purpose."
              : "The session only partially matched the planned intent.",
        support: buildEvidenceSummary(evidence)
      }
    ]
  };
}

export function buildExecutionEvidence(args: {
  athleteId: string;
  sessionId: string;
  sessionTitle: string;
  sessionRole?: string | null;
  plannedStructure?: string | null;
  diagnosisInput: SessionDiagnosisInput;
  weeklyState?: { fatigue: number | null } | null;
}) {
  const diagnosis = diagnoseCompletedSession(args.diagnosisInput);
  const firstHalfHr = args.diagnosisInput.actual.splitMetrics?.firstHalfAvgHr ?? null;
  const lastHalfHr = args.diagnosisInput.actual.splitMetrics?.lastHalfAvgHr ?? null;
  const firstHalfPace = args.diagnosisInput.actual.splitMetrics?.firstHalfPaceSPerKm ?? null;
  const lastHalfPace = args.diagnosisInput.actual.splitMetrics?.lastHalfPaceSPerKm ?? null;
  const hrDrift = firstHalfHr && lastHalfHr ? lastHalfHr / firstHalfHr : null;
  const paceFade = firstHalfPace && lastHalfPace ? lastHalfPace / firstHalfPace : null;
  const durationCompletion =
    args.diagnosisInput.actual.durationSec && args.diagnosisInput.planned.plannedDurationSec
      ? args.diagnosisInput.actual.durationSec / args.diagnosisInput.planned.plannedDurationSec
      : null;
  const issues = diagnosis.detectedIssues.map((code) => ({
    code,
    severity: getIssueSeverity(code),
    supportingMetrics: buildEvidenceSummary({
      sessionId: args.sessionId,
      athleteId: args.athleteId,
      sport: args.diagnosisInput.planned.sport ?? "other",
      planned: {
        title: args.sessionTitle,
        intentCategory: args.diagnosisInput.planned.intentCategory ?? null,
        durationSec: args.diagnosisInput.planned.plannedDurationSec ?? null,
        targetBands: args.diagnosisInput.planned.targetBands ?? null,
        plannedIntervals: args.diagnosisInput.planned.plannedIntervals ?? null,
        plannedStructure: args.plannedStructure ?? null,
        sessionRole: args.sessionRole === "key" || args.sessionRole === "supporting" || args.sessionRole === "recovery" ? args.sessionRole : "unknown"
      },
      actual: buildActualEvidence(args.diagnosisInput),
      detectedIssues: [],
      missingEvidence: [],
      rulesSummary: {
        intentMatch: "partial",
        executionScore: null,
        executionScoreBand: null,
        confidence: "low",
        provisional: true,
        evidenceCount: 0,
        executionCost: "unknown"
      }
    })
  }));

  const executionCost = deriveExecutionCost({
    timeAboveTargetPct: args.diagnosisInput.actual.timeAboveTargetPct ?? null,
    hrDrift,
    paceFade,
    intervalCompletionPct: args.diagnosisInput.actual.intervalCompletionPct ?? null,
    durationCompletion,
    fatigue: args.weeklyState?.fatigue ?? null
  });

  return {
    diagnosis,
    evidence: {
      sessionId: args.sessionId,
      athleteId: args.athleteId,
      sport: args.diagnosisInput.planned.sport ?? "other",
      planned: {
        title: args.sessionTitle,
        intentCategory: args.diagnosisInput.planned.intentCategory ?? null,
        durationSec: args.diagnosisInput.planned.plannedDurationSec ?? null,
        targetBands: args.diagnosisInput.planned.targetBands ?? null,
        plannedIntervals: args.diagnosisInput.planned.plannedIntervals ?? null,
        plannedStructure: args.plannedStructure ?? null,
        sessionRole: args.sessionRole === "key" || args.sessionRole === "supporting" || args.sessionRole === "recovery" ? args.sessionRole : "unknown"
      },
      actual: buildActualEvidence(args.diagnosisInput),
      detectedIssues: issues,
      missingEvidence: deriveMissingEvidence(args.diagnosisInput),
      rulesSummary: {
        intentMatch: toIntentMatch(diagnosis.intentMatchStatus),
        executionScore: diagnosis.executionScore,
        executionScoreBand: diagnosis.executionScoreBand,
        confidence: diagnosis.diagnosisConfidence,
        provisional: diagnosis.executionScoreProvisional,
        evidenceCount: diagnosis.evidenceCount,
        executionCost
      },
      extendedSignals: null as ExecutionEvidence["extendedSignals"]
    } satisfies ExecutionEvidence
  };
}

export function reasoningEffortForSession(
  sessionRole: ExecutionEvidence["planned"]["sessionRole"]
): "low" | "medium" {
  return sessionRole === "key" ? "medium" : "low";
}

export async function generateCoachVerdict(args: {
  evidence: ExecutionEvidence;
  athleteContext: AthleteContextSnapshot | null;
  recentReviewedSessions: Array<{ sessionId: string; headline: string; intentMatch: string }>;
  priorHeadlines?: SessionPriorHeadline[];
}) {
  const deterministicFallback = buildDeterministicVerdict(args.evidence);
  const defaults = {
    intentMatch: args.evidence.rulesSummary.intentMatch,
    executionCost: args.evidence.rulesSummary.executionCost,
    nextCall: nextCallFromEvidence(args.evidence.rulesSummary.intentMatch, args.evidence.rulesSummary.executionCost)
  };

  const reasoningEffort = reasoningEffortForSession(args.evidence.planned.sessionRole);

  const comparables = args.evidence.extendedSignals?.historicalComparables ?? [];
  const expectedComparableReference =
    comparables.length > 0 ? buildDeterministicComparableReference(comparables) : null;

  const result = await callOpenAIWithFallback<CoachVerdict>({
    logTag: "session-review-ai",
    fallback: deterministicFallback,
    logContext: { sessionId: args.evidence.sessionId, reasoningEffort },
    buildRequest: () => ({
      instructions: buildCoachVerdictInstructions(),
      reasoning: { effort: reasoningEffort },
      max_output_tokens: 3000,
      text: {
        format: zodTextFormat(coachVerdictSchema, "session_coach_verdict", {
          description: "Structured session review verdict."
        })
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify({
                sessionEvidence: args.evidence,
                athleteContext: args.athleteContext,
                recentReviewedSessions: args.recentReviewedSessions,
                priorHeadlines: args.priorHeadlines && args.priorHeadlines.length > 0 ? args.priorHeadlines : null
              })
            }
          ]
        }
      ]
    }),
    schema: coachVerdictSchema,
    normalizePayload: (raw) =>
      coerceCoachVerdictPayload(raw, defaults).normalizedPayload,
    sanityCheck: (parsed) => {
      const deterministicConfidence = args.evidence.rulesSummary.confidence;
      if (deterministicConfidence !== "low" && parsed.sessionVerdict.intentMatch !== args.evidence.rulesSummary.intentMatch) {
        return `model intent match disagreed with deterministic diagnosis (model=${parsed.sessionVerdict.intentMatch}, deterministic=${args.evidence.rulesSummary.intentMatch})`;
      }
      return undefined;
    },
    postProcess: (verdict) => {
      // Enforce 3.4b: when historicalComparables are present, the verdict must
      // cite at least one. If the model omitted it, splice in a deterministic
      // reference rather than discarding the rest of its output — the rest of
      // the verdict is still higher quality than the full fallback.
      const patched: CoachVerdict =
        comparables.length > 0 && !verdict.comparableReference && expectedComparableReference
          ? { ...verdict, comparableReference: expectedComparableReference }
          : verdict;
      if (comparables.length > 0 && !verdict.comparableReference) {
        console.warn("[session-review-ai] Model omitted comparableReference despite comparables in context; injecting deterministic reference", {
          sessionId: args.evidence.sessionId,
          comparableCount: comparables.length
        });
      }
      return normalizeVerdictUnits(patched);
    }
  });

  return { verdict: result.value, source: result.source };
}

