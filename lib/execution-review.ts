import "openai/shims/node";
import { zodTextFormat } from "openai/helpers/zod";
import { asObject, asString, asStringArray, clip } from "@/lib/openai";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { diagnoseCompletedSession, type SessionDiagnosisInput } from "@/lib/coach/session-diagnosis";
import {
  type ExecutionEvidence,
  type CoachVerdict,
  coachVerdictSchema,
  COACH_VERDICT_JSON_EXAMPLE,
} from "@/lib/execution-review-types";
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
  const normalizedPayload = normalizeCoachVerdictPayload(payload, defaults);
  const parsed = coachVerdictSchema.safeParse(normalizedPayload);
  return {
    normalizedPayload,
    parsed
  };
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
    "- For 90+ scores: say 'Maintain this approach. Same targets next time.' in oneThingToChange.",
    "- For scores below 90: use the NEXT format: 'NEXT [session type]: [specific target]. [success criterion]. [progression cue].'",
    "- Do not use words like 'appears', 'seems', 'might', 'possibly', 'likely'. State what the data shows.",
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
    "- `uncertainty.label`: one of `confident_read`, `early_read`, `insufficient_data`.",
    "- `uncertainty.detail`: explain the confidence level plainly, max 500 chars.",
    "- `uncertainty.missingEvidence`: array of missing evidence strings, max 8 items.",
    "- `citedEvidence`: max 4 items.",
    "- `citedEvidence[].claim`: max 200 chars.",
    "- `citedEvidence[].support`: max 4 short support strings, each max 180 chars.",
    "Required output schema example:",
    COACH_VERDICT_JSON_EXAMPLE
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
          ? "Maintain this approach. Same targets next time."
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
      }
    } satisfies ExecutionEvidence
  };
}

export async function generateCoachVerdict(args: {
  evidence: ExecutionEvidence;
  athleteContext: AthleteContextSnapshot | null;
  recentReviewedSessions: Array<{ sessionId: string; headline: string; intentMatch: string }>;
}) {
  const deterministicFallback = buildDeterministicVerdict(args.evidence);
  const defaults = {
    intentMatch: args.evidence.rulesSummary.intentMatch,
    executionCost: args.evidence.rulesSummary.executionCost,
    nextCall: nextCallFromEvidence(args.evidence.rulesSummary.intentMatch, args.evidence.rulesSummary.executionCost)
  };

  const result = await callOpenAIWithFallback<CoachVerdict>({
    logTag: "session-review-ai",
    fallback: deterministicFallback,
    logContext: { sessionId: args.evidence.sessionId },
    buildRequest: () => ({
      instructions: buildCoachVerdictInstructions(),
      reasoning: { effort: "low" },
      max_output_tokens: 1600,
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
                recentReviewedSessions: args.recentReviewedSessions
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
    postProcess: normalizeVerdictUnits
  });

  return { verdict: result.value, source: result.source };
}

