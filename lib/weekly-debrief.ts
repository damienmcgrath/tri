import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildExtraCompletedActivities, hasConfirmedPlannedSessionLink, loadCompletedActivities, localIsoDate } from "@/lib/activities/completed-activities";
import { getAthleteContextSnapshot, type AthleteContextSnapshot } from "@/lib/athlete-context";
import { parsePersistedExecutionReview, type PersistedExecutionReview } from "@/lib/execution-review";
import { getCoachModel, getOpenAIClient } from "@/lib/openai";
import { getSessionDisplayName } from "@/lib/training/session";
import { addDays, weekRangeLabel } from "@/app/(protected)/week-context";

export const WEEKLY_DEBRIEF_GENERATION_VERSION = 5;

const weeklyDebriefEvidenceItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(160),
  detail: z.string().min(1).max(280),
  kind: z.enum(["session", "activity"]),
  href: z.string().min(1),
  supportType: z.enum(["fact", "observation", "carry_forward"])
});

export type WeeklyDebriefEvidenceItem = z.infer<typeof weeklyDebriefEvidenceItemSchema>;

const weeklyDebriefEvidenceGroupSchema = z.object({
  claim: z.string().min(1).max(160),
  detail: z.string().min(1).max(280),
  supports: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(160),
    href: z.string().min(1),
    kind: z.enum(["session", "activity"]),
    reason: z.string().min(1).max(200)
  })).min(1).max(5)
});

export type WeeklyDebriefEvidenceGroup = z.infer<typeof weeklyDebriefEvidenceGroupSchema>;

const weeklyDebriefFactsSchema = z.object({
  weekLabel: z.string().min(1),
  weekRange: z.string().min(1),
  title: z.string().min(1).max(120),
  statusLine: z.string().min(1).max(160),
  primaryTakeawayTitle: z.string().min(1).max(120),
  primaryTakeawayDetail: z.string().min(1).max(240),
  plannedSessions: z.number().int().min(0),
  completedPlannedSessions: z.number().int().min(0).default(0),
  completedSessions: z.number().int().min(0),
  addedSessions: z.number().int().min(0).default(0),
  skippedSessions: z.number().int().min(0),
  remainingSessions: z.number().int().min(0),
  keySessionsCompleted: z.number().int().min(0),
  keySessionsMissed: z.number().int().min(0).default(0),
  keySessionsTotal: z.number().int().min(0),
  plannedMinutes: z.number().int().min(0),
  completedPlannedMinutes: z.number().int().min(0).default(0),
  completedMinutes: z.number().int().min(0),
  skippedMinutes: z.number().int().min(0),
  extraMinutes: z.number().int().min(0),
  completionPct: z.number().int().min(0).max(999),
  dominantSport: z.string().min(1),
  keySessionStatus: z.string().min(1).max(160),
  metrics: z.array(z.object({
    label: z.string().min(1).max(60),
    value: z.string().min(1).max(80),
    detail: z.string().min(1).max(100).nullable().optional().default(null),
    tone: z.enum(["neutral", "positive", "muted", "caution"])
  })).min(3).max(6),
  factualBullets: z.array(z.string().min(1).max(160)).min(2).max(4),
  confidenceNote: z.string().min(1).max(220).nullable(),
  artifactStateLabel: z.enum(["final", "provisional"]).default("provisional"),
  artifactStateNote: z.string().min(1).max(200).nullable().default(null),
  provisionalReviewCount: z.number().int().min(0).default(0),
  weekShape: z.enum(["normal", "partial_reflection", "disrupted"]),
  reflectionsSparse: z.boolean()
});

export type WeeklyDebriefFacts = z.infer<typeof weeklyDebriefFactsSchema>;

const weeklyDebriefNarrativeSchema = z.object({
  executiveSummary: z.string().min(1).max(420),
  highlights: z.array(z.string().min(1).max(220)).min(3).max(3),
  observations: z.array(z.string().min(1).max(220)).min(1).max(3),
  carryForward: z.array(z.string().min(1).max(160)).min(2).max(2)
});

export type WeeklyDebriefNarrative = z.infer<typeof weeklyDebriefNarrativeSchema>;

const weeklyDebriefCoachShareSchema = z.object({
  headline: z.string().min(1).max(120),
  summary: z.string().min(1).max(320),
  wins: z.array(z.string().min(1).max(180)).min(1).max(3),
  concerns: z.array(z.string().min(1).max(180)).min(1).max(3),
  carryForward: z.array(z.string().min(1).max(160)).min(2).max(2)
});

export type WeeklyDebriefCoachShare = z.infer<typeof weeklyDebriefCoachShareSchema>;

const weeklyDebriefArtifactSchema = z.object({
  weekStart: z.string().date(),
  weekEnd: z.string().date(),
  status: z.enum(["ready", "stale", "failed"]),
  sourceUpdatedAt: z.string().datetime(),
  generatedAt: z.string().datetime(),
  generationVersion: z.number().int().positive(),
  facts: weeklyDebriefFactsSchema,
  narrative: weeklyDebriefNarrativeSchema,
  coachShare: weeklyDebriefCoachShareSchema,
  evidence: z.array(weeklyDebriefEvidenceItemSchema).max(24),
  evidenceGroups: z.array(weeklyDebriefEvidenceGroupSchema).max(6),
  feedback: z.object({
    helpful: z.boolean().nullable(),
    accurate: z.boolean().nullable(),
    note: z.string().nullable(),
    updatedAt: z.string().datetime().nullable()
  })
});

export type WeeklyDebriefArtifact = z.infer<typeof weeklyDebriefArtifactSchema>;

const weeklyDebriefReadinessSchema = z.object({
  isReady: z.boolean(),
  reason: z.string().min(1).max(220),
  unlockedBy: z.enum(["end_of_week", "effective_completion", "insufficient_signal"]),
  resolvedKeySessions: z.number().int().min(0),
  totalKeySessions: z.number().int().min(0),
  resolvedMinutes: z.number().int().min(0),
  plannedMinutes: z.number().int().min(0)
});

export type WeeklyDebriefReadiness = z.infer<typeof weeklyDebriefReadinessSchema>;

type WeeklyDebriefSession = {
  id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  intent_category?: string | null;
  session_role?: "key" | "supporting" | "recovery" | "optional" | null;
  notes: string | null;
  status: "planned" | "completed" | "skipped";
  duration_minutes: number | null;
  updated_at: string | null;
  created_at: string;
  execution_result?: Record<string, unknown> | null;
  is_key?: boolean | null;
};

type WeeklyDebriefActivity = {
  id: string;
  upload_id: string | null;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  schedule_status: "scheduled" | "unscheduled";
  is_unplanned: boolean;
  created_at?: string;
};

type WeeklyDebriefLink = {
  completed_activity_id: string;
  planned_session_id?: string | null;
  confirmation_status?: "suggested" | "confirmed" | "rejected" | null;
  created_at?: string | null;
};

type WeeklyDebriefInputs = {
  sessions: WeeklyDebriefSession[];
  activities: WeeklyDebriefActivity[];
  links: WeeklyDebriefLink[];
  athleteContext: AthleteContextSnapshot | null;
  timeZone: string;
  weekStart: string;
  weekEnd: string;
  todayIso: string;
};

type WeeklyDebriefSourceInputs = {
  sessions: Array<Pick<WeeklyDebriefSession, "id" | "date" | "sport" | "notes" | "status" | "duration_minutes" | "updated_at" | "created_at" | "is_key" | "session_role">>;
  activities: WeeklyDebriefActivity[];
  links: WeeklyDebriefLink[];
  weeklyCheckinUpdatedAt: string | null;
  timeZone: string;
  weekStart: string;
  weekEnd: string;
  todayIso: string;
};

type WeeklyDebriefSourceState = {
  readiness: WeeklyDebriefReadiness;
  sourceUpdatedAt: string;
};

type WeeklyDebriefSessionSummary = {
  id: string;
  label: string;
  date: string;
  sport: string;
  durationMinutes: number;
  status: "completed" | "planned" | "skipped";
  isKey: boolean;
  review: PersistedExecutionReview | null;
  completedMinutes: number;
};

type WeeklyDebriefComputed = {
  readiness: WeeklyDebriefReadiness;
  facts: WeeklyDebriefFacts;
  narrative: WeeklyDebriefNarrative;
  coachShare: WeeklyDebriefCoachShare;
  evidence: WeeklyDebriefEvidenceItem[];
  evidenceGroups: WeeklyDebriefEvidenceGroup[];
  sourceUpdatedAt: string;
};

type WeeklyDebriefRecord = {
  week_start: string;
  week_end: string;
  status: "ready" | "stale" | "failed";
  source_updated_at: string;
  generated_at: string;
  generation_version: number;
  facts: unknown;
  narrative: unknown;
  coach_share: unknown;
  helpful: boolean | null;
  accurate: boolean | null;
  feedback_note: string | null;
  feedback_updated_at: string | null;
};

export type WeeklyDebriefSnapshot =
  | {
      readiness: WeeklyDebriefReadiness;
      artifact: WeeklyDebriefArtifact | null;
      stale: boolean;
      sourceUpdatedAt: string;
      weekStart: string;
      weekEnd: string;
    }
  | {
      readiness: WeeklyDebriefReadiness;
      artifact: null;
      stale: false;
      sourceUpdatedAt: string;
      weekStart: string;
      weekEnd: string;
    };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMinutes(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function isSkippedByTag(notes: string | null | undefined) {
  return /\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(notes ?? "");
}

function inferSessionStatus(session: WeeklyDebriefSession, completionLedger: Record<string, number>) {
  if (session.status === "completed" || session.status === "skipped") {
    return session.status;
  }

  if (isSkippedByTag(session.notes)) {
    return "skipped" as const;
  }

  const key = `${session.date}:${session.sport}`;
  const count = completionLedger[key] ?? 0;
  if (count > 0) {
    completionLedger[key] = count - 1;
    return "completed" as const;
  }

  return "planned" as const;
}

function getConfidenceNote(inputs: WeeklyDebriefInputs) {
  return null;
}

function buildArtifactState(args: { provisionalReviewCount: number }) {
  if (args.provisionalReviewCount > 0) {
    return {
      label: "provisional" as const,
      note: "This debrief is provisional and may update before the week is final."
    };
  }

  return {
    label: "final" as const,
    note: null
  };
}

export function computeWeeklyDebriefReadiness(args: {
  todayIso: string;
  weekStart: string;
  weekEnd: string;
  plannedMinutes: number;
  resolvedMinutes: number;
  totalKeySessions: number;
  resolvedKeySessions: number;
}) {
  const isEndOfWeek = args.todayIso >= args.weekEnd;
  const effectiveCompletionReady =
    args.plannedMinutes > 0 &&
    args.resolvedMinutes >= Math.round(args.plannedMinutes * 0.7) &&
    args.totalKeySessions === args.resolvedKeySessions;

  if (isEndOfWeek) {
    return weeklyDebriefReadinessSchema.parse({
      isReady: true,
      reason: "The training week has ended, so the debrief is ready to review.",
      unlockedBy: "end_of_week",
      resolvedKeySessions: args.resolvedKeySessions,
      totalKeySessions: args.totalKeySessions,
      resolvedMinutes: args.resolvedMinutes,
      plannedMinutes: args.plannedMinutes
    });
  }

  if (effectiveCompletionReady) {
    return weeklyDebriefReadinessSchema.parse({
      isReady: true,
      reason: "Enough of the week is resolved to make the debrief meaningful.",
      unlockedBy: "effective_completion",
      resolvedKeySessions: args.resolvedKeySessions,
      totalKeySessions: args.totalKeySessions,
      resolvedMinutes: args.resolvedMinutes,
      plannedMinutes: args.plannedMinutes
    });
  }

  return weeklyDebriefReadinessSchema.parse({
    isReady: false,
    reason:
      args.totalKeySessions > args.resolvedKeySessions
        ? "Not enough signal yet. Finish or explicitly resolve the remaining key session before we summarize the week."
        : "Not enough signal yet. The debrief unlocks once more of the planned week is completed or explicitly skipped.",
    unlockedBy: "insufficient_signal",
    resolvedKeySessions: args.resolvedKeySessions,
    totalKeySessions: args.totalKeySessions,
    resolvedMinutes: args.resolvedMinutes,
    plannedMinutes: args.plannedMinutes
  });
}

export function classifyWeeklyDebriefWeekShape(args: {
  plannedSessions: number;
  completedSessions: number;
  skippedSessions: number;
  reflectionsSparse: boolean;
  completionPct: number;
}) {
  if (args.skippedSessions >= Math.max(2, Math.ceil(args.plannedSessions * 0.3)) || args.completionPct < 65) {
    return "disrupted" as const;
  }

  if (args.reflectionsSparse) {
    return "partial_reflection" as const;
  }

  return "normal" as const;
}

function buildDeterministicNarrative(args: {
  facts: WeeklyDebriefFacts;
  topHighlights: string[];
  observations: string[];
  carryForward: string[];
}) {
  const highlights = [
    ...args.topHighlights,
    args.facts.keySessionsTotal > 0 && args.facts.keySessionsCompleted === args.facts.keySessionsTotal
      ? "The priority sessions set the tone for the week rather than forcing catch-up later."
      : null,
    args.facts.skippedSessions <= 1
      ? "The broader week kept its shape instead of unraveling across multiple sessions."
      : null,
    args.facts.addedSessions > 0 && args.facts.skippedSessions === 0
      ? "Added work stayed additive rather than replacing the planned structure."
      : null,
    args.facts.weekShape === "disrupted"
      ? "Even with some disruption, the week still showed what held and where it loosened."
      : "The stronger sessions are worth repeating next week."
  ].filter((value, index, all) => value && all.indexOf(value) === index).slice(0, 3);

  return weeklyDebriefNarrativeSchema.parse({
    executiveSummary:
      args.facts.weekShape === "partial_reflection" && args.facts.confidenceNote
        ? `${args.facts.primaryTakeawayDetail} ${args.facts.confidenceNote}`
        : args.facts.primaryTakeawayDetail,
    highlights,
    observations: args.observations.slice(0, Math.max(1, Math.min(3, args.observations.length))),
    carryForward: args.carryForward.slice(0, 2)
  });
}

function buildCoachShare(args: { facts: WeeklyDebriefFacts; narrative: WeeklyDebriefNarrative }) {
  return weeklyDebriefCoachShareSchema.parse({
    headline: args.facts.title,
    summary: args.narrative.executiveSummary,
    wins: args.narrative.highlights.slice(0, 3),
    concerns: args.narrative.observations.slice(0, 3),
    carryForward: args.narrative.carryForward.slice(0, 2)
  });
}

async function generateNarrative(args: {
  facts: WeeklyDebriefFacts;
  evidence: WeeklyDebriefEvidenceItem[];
  athleteContext: AthleteContextSnapshot | null;
  deterministicFallback: WeeklyDebriefNarrative;
}) {
  if (!process.env.OPENAI_API_KEY) {
    return args.deterministicFallback;
  }

  try {
    const client = getOpenAIClient();
    const response = await client.responses.create({
      model: getCoachModel(),
      instructions:
        "You write Weekly Debrief copy for endurance athletes. Use only the provided facts and evidence. Be calm, precise, coach-like, and proportionate to evidence. Distinguish facts, observations, and carry-forward suggestions. Avoid hype, diagnosis, and certainty beyond the data. Return valid JSON only with executiveSummary, highlights, observations, carryForward.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                facts: args.facts,
                evidence: args.evidence,
                athleteContext: args.athleteContext ? {
                  weeklyState: args.athleteContext.weeklyState,
                  declared: {
                    weeklyConstraints: args.athleteContext.declared.weeklyConstraints,
                    limiters: args.athleteContext.declared.limiters.slice(0, 3).map((limiter) => limiter.value)
                  }
                } : null
              })
            }
          ]
        }
      ]
    });
    const text = response.output_text?.trim();
    if (!text) return args.deterministicFallback;
    const parsed = weeklyDebriefNarrativeSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return args.deterministicFallback;
    return parsed.data;
  } catch {
    return args.deterministicFallback;
  }
}

function getSourceUpdatedAt(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? new Date().toISOString();
}

function normalizeTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString();
}

function normalizePersistedFacts(rawFacts: unknown): Record<string, unknown> {
  const facts = (rawFacts && typeof rawFacts === "object" ? rawFacts : {}) as Record<string, unknown>;
  const legacyStateLabel = facts.artifactStateLabel;
  const keySessionStatus = typeof facts.keySessionStatus === "string" ? facts.keySessionStatus : "";
  const statusLine = typeof facts.statusLine === "string" ? facts.statusLine : "";
  const factualBullets = Array.isArray(facts.factualBullets) ? facts.factualBullets.filter((value): value is string => typeof value === "string") : [];

  return {
    ...facts,
    primaryTakeawayTitle:
      typeof facts.primaryTakeawayTitle === "string" && facts.primaryTakeawayTitle.trim().length > 0
        ? facts.primaryTakeawayTitle
        : keySessionStatus || "What defined the week",
    primaryTakeawayDetail:
      typeof facts.primaryTakeawayDetail === "string" && facts.primaryTakeawayDetail.trim().length > 0
        ? facts.primaryTakeawayDetail
        : statusLine || factualBullets[0] || "This debrief was saved before the latest Weekly Debrief format.",
    artifactStateLabel: legacyStateLabel === "saved" ? "final" : legacyStateLabel
  };
}

function normalizePersistedArtifact(record: WeeklyDebriefRecord, effectiveStatus: "ready" | "stale" | "failed") {
  const normalizedFacts = normalizePersistedFacts(record.facts);

  const artifact = weeklyDebriefArtifactSchema.parse({
    weekStart: record.week_start,
    weekEnd: record.week_end,
    status: effectiveStatus,
    sourceUpdatedAt: normalizeTimestamp(record.source_updated_at),
    generatedAt: normalizeTimestamp(record.generated_at),
    generationVersion: record.generation_version,
    facts: normalizedFacts,
    narrative: record.narrative,
    coachShare: record.coach_share,
    evidence: Array.isArray((normalizedFacts as { evidence?: unknown })?.evidence) ? (normalizedFacts as { evidence: WeeklyDebriefEvidenceItem[] }).evidence : [],
    evidenceGroups: Array.isArray((normalizedFacts as { evidenceGroups?: unknown })?.evidenceGroups) ? (normalizedFacts as { evidenceGroups: WeeklyDebriefEvidenceGroup[] }).evidenceGroups : [],
    feedback: {
      helpful: record.helpful,
      accurate: record.accurate,
      note: record.feedback_note,
      updatedAt: normalizeTimestamp(record.feedback_updated_at)
    }
  });

  return {
    ...artifact,
    evidence: Array.isArray((normalizedFacts as { evidence?: unknown })?.evidence) ? weeklyDebriefEvidenceItemSchema.array().parse((normalizedFacts as { evidence: unknown }).evidence) : [],
    evidenceGroups: Array.isArray((normalizedFacts as { evidenceGroups?: unknown })?.evidenceGroups) ? weeklyDebriefEvidenceGroupSchema.array().parse((normalizedFacts as { evidenceGroups: unknown }).evidenceGroups) : []
  };
}

function buildWeekTitle(args: {
  completedPlannedSessions: number;
  plannedSessions: number;
  keySessionsLanded: number;
  keySessionsMissed: number;
  keySessionsTotal: number;
  skippedSessions: number;
  addedSessions: number;
  weekShape: "normal" | "partial_reflection" | "disrupted";
  latestIssueLabel: string | null;
}) {
  if (args.keySessionsTotal === 0) {
    if (args.weekShape === "disrupted") {
      return args.latestIssueLabel
        ? `A mixed week, with drift most visible in ${args.latestIssueLabel.toLowerCase()}`
        : "A mixed week, with quality fading later on";
    }

    if (args.addedSessions > 0 && args.skippedSessions === 0) {
      return "A steady week, with extra work layered around it";
    }

    if (args.skippedSessions > 0) {
      return "A mostly intact week, with one visible wobble";
    }

    return "A steady consistency week";
  }

  if (args.weekShape === "disrupted") {
    return args.keySessionsLanded > 0
      ? "A disrupted week, with some of the main work preserved"
      : "A disrupted week, with the main work partly missed";
  }

  if (args.keySessionsTotal > 0 && args.keySessionsLanded === args.keySessionsTotal) {
    if (args.skippedSessions > 0) {
      return "The main work landed, with a few lower-priority misses";
    }
    if (args.addedSessions > 0) {
      return "The main work landed, with a little extra training added";
    }
    return "The main work landed across a steady week";
  }

  if (args.keySessionsMissed > 0) {
    return "A mixed week, with one meaningful gap in the main work";
  }

  if (args.skippedSessions > 0) {
    return "A mixed week with a couple of late changes";
  }

  if (args.completedPlannedSessions >= Math.ceil(args.plannedSessions * 0.8)) {
    return "A steady week with most of the planned work in place";
  }

  return "A flexible week that stayed broadly on course";
}

function buildStatusLine(args: {
  completedPlannedSessions: number;
  plannedSessions: number;
  keySessionsLanded: number;
  keySessionsMissed: number;
  keySessionsTotal: number;
  skippedSessions: number;
  addedSessions: number;
  latestIssueLabel: string | null;
  strongestExecutionLabel: string | null;
  weekShape: "normal" | "partial_reflection" | "disrupted";
}) {
  if (args.keySessionsTotal === 0) {
    if (args.latestIssueLabel) {
      return `Most of the week structure held, with the clearest drift showing up in ${args.latestIssueLabel}.`;
    }
    if (args.addedSessions > 0 && args.skippedSessions === 0) {
      return "Extra work changed the shape of the week, but the planned structure still mostly held.";
    }
    if (args.strongestExecutionLabel) {
      return `${args.strongestExecutionLabel} gave the clearest picture of how the week was landing.`;
    }
    if (args.weekShape === "disrupted") {
      return "The week stayed readable, but execution quality loosened more than the schedule alone suggests.";
    }
    return "The week was defined more by overall consistency than by one priority session.";
  }

  if (args.keySessionsLanded === args.keySessionsTotal && args.latestIssueLabel) {
    return `The priority structure held, but the clearest quality drift showed up in ${args.latestIssueLabel}.`;
  }
  if (args.keySessionsLanded === args.keySessionsTotal) {
    return args.addedSessions > 0
      ? "The priority structure held, and the added work stayed secondary to it."
      : "The priority structure held and execution stayed broadly intact across the week.";
  }
  if (args.keySessionsMissed > 0) {
    return args.latestIssueLabel
      ? `${args.latestIssueLabel} was the clearest point where the week's priority structure stopped landing cleanly.`
      : "One gap in the priority work shaped the rest of the week more than the surrounding sessions did.";
  }
  return `${args.completedPlannedSessions} of ${args.plannedSessions} planned sessions landed, with enough shape left to learn from the week.`;
}

function buildPrimaryTakeaway(args: {
  keySessionsTotal: number;
  keySessionsCompleted: number;
  keySessionsMissed: number;
  skippedSessions: number;
  addedSessions: number;
  lateWeekSkippedSessions: number;
  weekShape: "normal" | "partial_reflection" | "disrupted";
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  strongestExecutionSession: WeeklyDebriefSessionSummary | null;
  completedPlannedSessions: number;
  plannedSessions: number;
}) {
  if (args.keySessionsTotal === 0) {
    if (args.strongestExecutionSession && args.latestIssueSession && args.strongestExecutionSession.id !== args.latestIssueSession.id) {
      return {
        title: "The week had one clear strength and one clear wobble",
        detail: `${args.strongestExecutionSession.label} was the best-executed session of the week, while ${args.latestIssueSession.label} was where the week loosened most.`
      };
    }

    if (args.latestIssueSession) {
      return {
        title: "One session explained most of the drift",
        detail: `${args.latestIssueSession.label} was the clearest point where execution quality fell away, more than the rest of the week.`
      };
    }

    if (args.strongestExecutionSession) {
      return {
        title: "Quality came through in one representative session",
        detail: `${args.strongestExecutionSession.label} best captured how the week was landing overall.`
      };
    }

    if (args.addedSessions > 0 && args.skippedSessions === 0) {
      return {
        title: "Consistency held, even with a little extra work",
        detail: "No one session dominated the week; the main read is that the overall structure held while a little extra work was layered on."
      };
    }
  }

  if (args.keySessionsTotal > 0) {
    if (args.keySessionsCompleted === args.keySessionsTotal) {
      if (args.skippedSessions > 0) {
        return {
          title: "The main work held",
          detail: "The priority sessions landed, and most of the disruption stayed outside the work the week depended on."
        };
      }

      if (args.addedSessions > 0) {
        return {
          title: "The main work set the week",
          detail: "The priority sessions landed first, and the added work stayed secondary to the planned structure."
        };
      }

      return {
        title: "The main work set the tone",
        detail: "The priority sessions landed and the rest of the week stayed close to the intended structure."
      };
    }

    if (args.keySessionsMissed > 0) {
      return {
        title: "One key gap shaped the week",
        detail: args.latestIssueSession?.label
          ? `${args.latestIssueSession.label} was the clearest point where the week's main structure stopped feeling fully intact.`
          : "The biggest story of the week was the priority work that did not fully land."
      };
    }
  }

  if (args.addedSessions > 0 && args.skippedSessions === 0) {
    return {
      title: "Consistency held, with extra work around it",
      detail: "No single session defined the week; the main story was that the planned structure held while a little extra work was layered on."
    };
  }

  if (args.lateWeekSkippedSessions > 0) {
    return {
      title: "Most of the week held until late drift",
      detail: "The opening structure stayed intact, but the back half of the week loosened more than the start."
    };
  }

  if (args.skippedSessions > 0) {
    return {
      title: "A few changes shaped the week",
      detail: "Without one designated priority session, the main story was where the planned structure slipped and what still held around it."
    };
  }

  if (args.completedPlannedSessions >= Math.ceil(args.plannedSessions * 0.8)) {
    return {
      title: "Consistency defined the week",
      detail: "No single session outweighed the rest; the value came from keeping the week's structure in place across multiple days."
    };
  }

  return {
    title: "The structure mattered more than any one session",
    detail: args.weekShape === "disrupted"
      ? "The week is better understood as a block with a few loose edges than as one standout session."
      : "This was more about the overall rhythm of the week than about a single headline workout."
  };
}

function buildPositiveHighlights(args: {
  keySessionsTotal: number;
  keySessionsCompleted: number;
  skippedSessions: number;
  addedSessions: number;
  lateWeekSkippedSessions: number;
  weekShape: "normal" | "partial_reflection" | "disrupted";
  strongestExecutionSession: WeeklyDebriefSessionSummary | null;
}) {
  const highlights = [
    args.strongestExecutionSession
      ? `${args.strongestExecutionSession.label} was the best-executed session of the week.`
      : null,
    args.keySessionsTotal > 0 && args.keySessionsCompleted === args.keySessionsTotal
      ? "The priority sessions landed without the rest of the week needing to bend around them."
      : null,
    args.skippedSessions <= 1
      ? "The week kept its shape without quality slipping across multiple sessions."
      : args.lateWeekSkippedSessions > 0
        ? "The disruption stayed more contained than a fully unraveled week."
        : null,
    args.addedSessions > 0 && args.skippedSessions === 0
      ? "Extra work stayed additive rather than replacing the main week."
      : null,
    args.weekShape === "disrupted"
      ? "Even with some messiness, the stronger sessions still showed what is worth protecting."
      : null
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  return highlights.slice(0, 3);
}

function getDominantSport(sportMinutes: Map<string, number>) {
  const winner = [...sportMinutes.entries()].sort((a, b) => b[1] - a[1])[0];
  return winner?.[1] ? capitalize(winner[0]) : "Mixed";
}

function buildFallbackEvidenceSummaries(sessionSummaries: WeeklyDebriefSessionSummary[], extraActivities: ReturnType<typeof buildExtraCompletedActivities>) {
  const evidence: WeeklyDebriefEvidenceItem[] = [];

  for (const session of sessionSummaries) {
    if (session.status !== "completed" && session.status !== "skipped") continue;
    const review = session.review;
    evidence.push({
      id: session.id,
      label: session.label,
      detail:
        review?.executionSummary ??
        (session.status === "skipped" ? "This planned session was explicitly skipped." : `${formatMinutes(session.completedMinutes)} completed.`),
      kind: "session",
      href: `/sessions/${session.id}`,
      supportType: review ? "observation" : "fact"
    });
  }

  for (const activity of extraActivities.slice(0, 4)) {
    evidence.push({
      id: activity.id,
      label: `${capitalize(activity.sport)} extra workout`,
      detail: `${formatMinutes(activity.durationMinutes)} of unscheduled work was added to the week.`,
      kind: "activity",
      href: `/sessions/activity/${activity.id}`,
      supportType: "fact"
    });
  }

  return evidence.slice(0, 18);
}

function buildEvidenceGroups(args: {
  facts: WeeklyDebriefFacts;
  sessionSummaries: WeeklyDebriefSessionSummary[];
  extraActivities: ReturnType<typeof buildExtraCompletedActivities>;
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  strongestExecutionSession: WeeklyDebriefSessionSummary | null;
  lateWeekSkippedSessions: number;
  weekStart: string;
}) {
  const completedSessions = args.sessionSummaries.filter((session) => session.status === "completed");
  const completedKeySessions = completedSessions.filter((session) => session.isKey);
  const skippedSessions = args.sessionSummaries.filter((session) => session.status === "skipped");
  const longestCompleted = [...completedSessions].sort((a, b) => b.completedMinutes - a.completedMinutes);

  const sessionSupport = (session: WeeklyDebriefSessionSummary, reason: string) => ({
    id: session.id,
    label: session.label,
    href: `/sessions/${session.id}`,
    kind: "session" as const,
    reason
  });

  const activitySupport = (activity: ReturnType<typeof buildExtraCompletedActivities>[number], reason: string) => ({
    id: activity.id,
    label: `${capitalize(activity.sport)} extra workout`,
    href: `/sessions/activity/${activity.id}`,
    kind: "activity" as const,
    reason
  });

  const uniqueSupports = <T extends { kind: "session" | "activity"; id: string }>(supports: T[]) =>
    supports.filter((support, index, all) => all.findIndex((candidate) => candidate.kind === support.kind && candidate.id === support.id) === index);

  const groups: WeeklyDebriefEvidenceGroup[] = [];

  const primarySupports = args.facts.keySessionsTotal > 0
    ? [
        ...completedKeySessions.slice(0, 2).map((session) => sessionSupport(session, "This was part of the week's priority work.")),
        ...skippedSessions.filter((session) => session.isKey).slice(0, 1).map((session) => sessionSupport(session, "This missing key session changed the week's shape.")),
        ...(args.facts.addedSessions > 0 ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This added work changed the week's shape without replacing the plan.")) : [])
      ]
    : [
        ...longestCompleted.slice(0, 2).map((session) => sessionSupport(session, "This helped hold the week's planned structure together.")),
        ...(args.facts.addedSessions > 0 ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This added work changed the week's overall shape.")) : []),
        ...skippedSessions.slice(0, 1).map((session) => sessionSupport(session, "This missed session explains where the week loosened."))
      ];

  if (primarySupports.length > 0) {
    groups.push({
      claim: args.facts.primaryTakeawayTitle,
      detail: args.facts.primaryTakeawayDetail,
      supports: uniqueSupports(primarySupports).slice(0, 4)
    });
  }

  const stabilitySupports = [
    ...(args.strongestExecutionSession ? [sessionSupport(args.strongestExecutionSession, "This session best represents the week's strongest execution quality.")] : []),
    ...completedKeySessions.slice(0, 2).filter((session) => session.id !== args.strongestExecutionSession?.id).map((session) => sessionSupport(session, "This session helped preserve the week's quality.")),
    ...longestCompleted.slice(0, 2).map((session) => sessionSupport(session, "This session helped keep the planned rhythm in place.")),
    ...(args.facts.addedSessions > 0 && args.facts.skippedSessions === 0
      ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This extra work stayed additive rather than replacing the plan."))
      : [])
  ];

  if (stabilitySupports.length > 0) {
    groups.push({
      claim: args.strongestExecutionSession ? "Where execution quality was strongest" : "What held the week together",
      detail: args.strongestExecutionSession
        ? `${args.strongestExecutionSession.label} gave the clearest read on the week's strongest execution.`
        : args.facts.keySessionsTotal > 0 && args.facts.keySessionsCompleted === args.facts.keySessionsTotal
          ? "The priority work landed, and the rest of the week still had enough structure around it."
          : "These sessions best explain what held the week together.",
      supports: uniqueSupports(stabilitySupports).slice(0, 4)
    });
  }

  const noticeSupports = [
    ...(args.latestIssueSession ? [sessionSupport(args.latestIssueSession, "This was the clearest point where execution drift showed up.")] : []),
    ...skippedSessions.filter((session) => !args.latestIssueSession || session.id !== args.latestIssueSession.id).slice(0, args.lateWeekSkippedSessions > 0 ? 2 : 1).map((session) =>
      sessionSupport(
        session,
        session.date >= addDays(args.weekStart, 4)
          ? "This miss contributed to the late-week drift."
          : "This miss contributed to where the week loosened."
      )
    ),
    ...(args.facts.addedSessions > 0 ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This extra session changed the week's shape and is worth reading in context.")) : [])
  ];

  if (noticeSupports.length > 0) {
    groups.push({
      claim: "Where execution drift showed up",
      detail: args.latestIssueSession
        ? `The clearest drift showed up around ${args.latestIssueSession.label}.`
        : args.lateWeekSkippedSessions > 0
          ? "Most of the disruption was concentrated in the back half of the week."
          : "These sessions best explain where the week diverged from the intended shape.",
      supports: uniqueSupports(noticeSupports).slice(0, 4)
    });
  }

  return groups.slice(0, 3);
}

function buildDeterministicSuggestions(args: {
  weekShape: "normal" | "partial_reflection" | "disrupted";
  athleteContext: AthleteContextSnapshot | null;
  keySessionsMissed: number;
  lateSkippedSessions: number;
  addedSessions: number;
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  keySessionsTotal: number;
}) {
  const carry: string[] = [];
  if (args.latestIssueSession?.label) {
    carry.push(`Take a calmer first half into the next ${args.latestIssueSession.label.toLowerCase()}.`);
  } else if (args.keySessionsMissed > 0) {
    carry.push("Protect the main session before adding anything extra.");
  } else if (args.keySessionsTotal === 0) {
    carry.push("Keep the sessions that are landing cleanly as the anchor points of the week.");
  } else {
    carry.push("Keep the same spacing around the main work.");
  }

  if (args.lateSkippedSessions > 0) {
    carry.push("Protect the back half of the week from spillover.");
  } else if (args.addedSessions > 0) {
    carry.push("Only add extra work after the planned sessions are already done.");
  } else if (args.athleteContext?.weeklyState.note) {
    carry.push("Carry one useful cue from your note into the next harder session.");
  } else if (args.weekShape === "disrupted") {
    carry.push("Keep next week simple rather than trying to repay missed work.");
  } else {
    carry.push("Keep easy work controlled ahead of the harder day.");
  }

  return carry.slice(0, 2);
}

function buildDeterministicObservations(args: {
  reflectionsSparse: boolean;
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  lateSkippedSessions: number;
  skippedSessions: number;
  addedSessions: number;
  keySessionsMissed: number;
  reviewedSessionsCount: number;
}) {
  const observations: string[] = [];
  if (args.latestIssueSession?.label) {
    observations.push(`The clearest drift showed up in ${args.latestIssueSession.label}, rather than across the whole week.`);
  }
  if (args.keySessionsMissed > 0) {
    observations.push("The most meaningful drift touched one of the week's priority sessions.");
  } else if (args.lateSkippedSessions > 0) {
    observations.push("Most of the disruption was contained to the back half of the week.");
  } else if (args.skippedSessions > 0) {
    observations.push("The misses were present, but they did not spread across the whole structure.");
  }
  if (args.addedSessions > 0) {
    observations.push("Added work changed the shape of the week and is worth reading alongside the planned sessions, not separately from them.");
  }
  if (args.reviewedSessionsCount === 0 && observations.length === 0) {
    observations.push("This week reads more through overall rhythm than through one standout session.");
  }

  return observations.slice(0, 3);
}

export function buildWeeklyDebriefFacts(input: WeeklyDebriefInputs) {
  const completionLedger = input.sessions.reduce<Record<string, number>>((acc, session) => {
    if (session.status !== "completed") return acc;
    const key = `${session.date}:${session.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const sessionSummaries: WeeklyDebriefSessionSummary[] = input.sessions
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
    .map((session) => {
      const status = inferSessionStatus(session, completionLedger);
      const label = getSessionDisplayName({
        sessionName: session.session_name ?? session.type,
        subtype: session.subtype ?? session.workout_type ?? session.type,
        discipline: session.sport
      });
      const review = parsePersistedExecutionReview(session.execution_result ?? null);
      return {
        id: session.id,
        label,
        date: session.date,
        sport: session.sport,
        durationMinutes: Math.max(0, session.duration_minutes ?? 0),
        status,
        isKey: Boolean(session.is_key) || session.session_role === "key",
        review,
        completedMinutes: status === "completed" ? Math.max(0, session.duration_minutes ?? 0) : 0
      };
    });

  const confirmedLinks = input.links.filter(hasConfirmedPlannedSessionLink);
  const linkedActivityIds = new Set(confirmedLinks.map((link) => link.completed_activity_id));
  const durationByActivityId = new Map(
    input.activities.map((activity) => [activity.id, Math.round((activity.duration_sec ?? 0) / 60)])
  );

  for (const session of sessionSummaries) {
    const linkedMinutes = confirmedLinks
      .filter((link) => link.planned_session_id === session.id)
      .reduce((sum, link) => sum + (durationByActivityId.get(link.completed_activity_id) ?? 0), 0);
    if (linkedMinutes > 0) {
      session.completedMinutes = linkedMinutes;
    }
  }

  const weekEndExclusive = addDays(input.weekEnd, 1);
  const extraActivities = buildExtraCompletedActivities({
    activities: input.activities,
    links: input.links,
    timeZone: input.timeZone,
    weekStart: input.weekStart,
    weekEndExclusive
  });

  const plannedSessions = sessionSummaries.length;
  const completedPlannedSessions = sessionSummaries.filter((session) => session.status === "completed").length;
  const addedSessions = extraActivities.length;
  const completedSessions = completedPlannedSessions + addedSessions;
  const skippedSessions = sessionSummaries.filter((session) => session.status === "skipped").length;
  const remainingSessions = sessionSummaries.filter((session) => session.status === "planned").length;
  const keySessions = sessionSummaries.filter((session) => session.isKey);
  const keySessionsCompleted = keySessions.filter((session) => session.status === "completed").length;
  const keySessionsMissed = keySessions.filter((session) => session.status === "skipped").length;
  const plannedMinutes = sessionSummaries.reduce((sum, session) => sum + session.durationMinutes, 0);
  const completedPlannedMinutes = sessionSummaries.reduce((sum, session) => sum + session.completedMinutes, 0);
  const completedMinutes = completedPlannedMinutes + extraActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const skippedMinutes = sessionSummaries.filter((session) => session.status === "skipped").reduce((sum, session) => sum + session.durationMinutes, 0);
  const resolvedMinutes = completedMinutes + skippedMinutes;
  const extraMinutes = extraActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const completionPct = plannedMinutes === 0 ? 0 : Math.round((resolvedMinutes / plannedMinutes) * 100);
  const reflectionsSparse = !input.athleteContext?.weeklyState.note?.trim();
  const weekShape = classifyWeeklyDebriefWeekShape({
    plannedSessions,
    completedSessions,
    skippedSessions,
    reflectionsSparse,
    completionPct
  });

  const sportMinutes = sessionSummaries.reduce((acc, session) => {
    acc.set(session.sport, (acc.get(session.sport) ?? 0) + session.completedMinutes);
    return acc;
  }, new Map<string, number>());
  for (const activity of extraActivities) {
    sportMinutes.set(activity.sport, (sportMinutes.get(activity.sport) ?? 0) + activity.durationMinutes);
  }

  const readiness = computeWeeklyDebriefReadiness({
    todayIso: input.todayIso,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    plannedMinutes,
    resolvedMinutes,
    totalKeySessions: keySessions.length,
    resolvedKeySessions: keySessionsCompleted
  });

  const reviewedSessions = sessionSummaries.filter((session) => Boolean(session.review));
  const strongestExecutionSession =
    reviewedSessions
      .filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "on_target")
      .sort((a, b) => (b.review?.executionScore ?? -1) - (a.review?.executionScore ?? -1))[0] ??
    [...reviewedSessions].sort((a, b) => (b.review?.executionScore ?? -1) - (a.review?.executionScore ?? -1))[0] ??
    null;
  const provisionalReviewCount = reviewedSessions.filter((session) => session.review?.executionScoreProvisional).length;
  const latestIssueSession = reviewedSessions
    .filter((session) => session.review?.deterministic.rulesSummary.intentMatch !== "on_target")
    .sort((a, b) => (a.review?.executionScore ?? 100) - (b.review?.executionScore ?? 100))[0] ?? null;
  const finalTitle = buildWeekTitle({
    completedPlannedSessions,
    plannedSessions,
    keySessionsLanded: keySessionsCompleted,
    keySessionsMissed,
    keySessionsTotal: keySessions.length,
    skippedSessions,
    addedSessions,
    weekShape,
    latestIssueLabel: latestIssueSession?.label ?? null
  });
  const statusLine = buildStatusLine({
    completedPlannedSessions,
    plannedSessions,
    keySessionsLanded: keySessionsCompleted,
    keySessionsMissed,
    keySessionsTotal: keySessions.length,
    skippedSessions,
    addedSessions,
    latestIssueLabel: latestIssueSession?.label ?? null,
    strongestExecutionLabel: strongestExecutionSession?.label ?? null,
    weekShape
  });
  const lateWeekSkippedSessions = sessionSummaries.filter(
    (session) => session.status === "skipped" && session.date >= addDays(input.weekStart, 4)
  ).length;
  const primaryTakeaway = buildPrimaryTakeaway({
    keySessionsTotal: keySessions.length,
    keySessionsCompleted,
    keySessionsMissed,
    skippedSessions,
    addedSessions,
    lateWeekSkippedSessions,
    weekShape,
    latestIssueSession,
    strongestExecutionSession,
    completedPlannedSessions,
    plannedSessions
  });
  const artifactState = buildArtifactState({
    provisionalReviewCount
  });

  const factualBullets = [
    `${completedPlannedSessions} of ${plannedSessions} planned sessions were completed.`,
    reviewedSessions.length > 0
      ? latestIssueSession
        ? `The clearest drift showed up in ${latestIssueSession.label}.`
        : strongestExecutionSession
          ? `${strongestExecutionSession.label} gave the strongest execution read.`
          : `${reviewedSessions.length} sessions were reviewed for execution quality.`
      : keySessions.length > 0 && keySessionsCompleted === keySessions.length
        ? `All key sessions landed.`
        : keySessions.length > 0
          ? `${keySessionsCompleted} of ${keySessions.length} key sessions landed.`
          : "The week is best read through overall structure rather than one priority session.",
    skippedSessions > 0
      ? `${skippedSessions} planned ${skippedSessions === 1 ? "session was" : "sessions were"} missed.`
      : addedSessions > 0
        ? `${addedSessions} extra ${addedSessions === 1 ? "session was" : "sessions were"} added.`
        : `${formatMinutes(completedMinutes)} of training was completed.`,
    extraMinutes > 0 ? `${formatMinutes(extraMinutes)} was added outside the original plan.` : `${formatMinutes(completedMinutes)} was completed against ${formatMinutes(plannedMinutes)} planned.`
  ].filter((value, index, all) => value && all.indexOf(value) === index).slice(0, 4);

  const positiveHighlights = buildPositiveHighlights({
    keySessionsTotal: keySessions.length,
    keySessionsCompleted,
    skippedSessions,
    addedSessions,
    lateWeekSkippedSessions,
    weekShape,
    strongestExecutionSession
  });

  const observations = buildDeterministicObservations({
    reflectionsSparse,
    latestIssueSession,
    lateSkippedSessions: lateWeekSkippedSessions,
    skippedSessions,
    addedSessions,
    keySessionsMissed,
    reviewedSessionsCount: reviewedSessions.length
  });
  const carryForward = buildDeterministicSuggestions({
    weekShape,
    athleteContext: input.athleteContext,
    keySessionsMissed,
    lateSkippedSessions: lateWeekSkippedSessions,
    addedSessions,
    latestIssueSession,
    keySessionsTotal: keySessions.length
  });

  const qualityOnTargetCount = reviewedSessions.filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "on_target").length;
  const qualityPartialCount = reviewedSessions.filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "partial").length;
  const qualityMissedCount = reviewedSessions.filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "missed").length;
  const metrics = [
    {
      label: "Completed",
      value: `${completedPlannedSessions}/${plannedSessions}`,
      detail:
        skippedSessions > 0 || addedSessions > 0
          ? `${completedPlannedSessions} completed${skippedSessions > 0 ? ` • ${skippedSessions} missed` : ""}${addedSessions > 0 ? ` • ${addedSessions} added` : ""}`
          : `${completedPlannedSessions} completed`,
      tone: skippedSessions === 0 ? "positive" as const : "neutral" as const
    },
    {
      label: "Time",
      value: `${formatMinutes(completedMinutes)} / ${formatMinutes(plannedMinutes)}`,
      detail: addedSessions > 0 ? `${formatMinutes(completedMinutes)} done • includes ${formatMinutes(extraMinutes)} added work` : `${formatMinutes(completedMinutes)} done`,
      tone: completionPct >= 90 ? "positive" as const : completionPct >= 70 ? "neutral" as const : "caution" as const
    },
    ...(reviewedSessions.length > 0 ? [{
      label: "Sessions on target",
      value: `${qualityOnTargetCount}/${reviewedSessions.length} on target`,
      detail: qualityPartialCount > 0 || qualityMissedCount > 0 ? `${qualityPartialCount} partial · ${qualityMissedCount} off` : null,
      tone: qualityMissedCount > 0 ? "caution" as const : qualityOnTargetCount > 0 ? "positive" as const : "neutral" as const
    }] : []),
    ...(strongestExecutionSession ? [{
      label: "Strongest execution",
      value: strongestExecutionSession.label,
      detail: strongestExecutionSession.review?.deterministic.rulesSummary.intentMatch === "on_target" ? "Stayed closest to target" : strongestExecutionSession.review?.executionScoreBand ?? null,
      tone: "positive" as const
    }] : []),
    ...((latestIssueSession || skippedSessions > 0 || addedSessions > 0) ? [{
      label: latestIssueSession ? "Biggest drift" : "Week shape",
      value: latestIssueSession ? latestIssueSession.label : skippedSessions > 0 ? `${skippedSessions} missed` : `${addedSessions} added`,
      detail: latestIssueSession ? null : skippedSessions > 0 ? "Back-half looseness" : "Added work changed the shape",
      tone: latestIssueSession || skippedSessions > 0 ? "caution" as const : "muted" as const
    }] : [])
  ];

  const deterministicNarrative = buildDeterministicNarrative({
    facts: weeklyDebriefFactsSchema.parse({
      weekLabel: `Week of ${input.weekStart}`,
      weekRange: weekRangeLabel(input.weekStart),
      title: finalTitle,
      statusLine,
      primaryTakeawayTitle: primaryTakeaway.title,
      primaryTakeawayDetail: primaryTakeaway.detail,
      plannedSessions,
      completedPlannedSessions,
      completedSessions,
      addedSessions,
      skippedSessions,
      remainingSessions,
      keySessionsCompleted,
      keySessionsMissed,
      keySessionsTotal: keySessions.length,
      plannedMinutes,
      completedPlannedMinutes,
      completedMinutes,
      skippedMinutes,
      extraMinutes,
      completionPct,
      dominantSport: getDominantSport(sportMinutes),
      keySessionStatus: keySessions.length > 0 ? "Priority sessions influenced the week." : "Consistency and execution quality explained the week better than one priority session.",
      metrics,
      factualBullets,
      confidenceNote: getConfidenceNote(input),
      artifactStateLabel: artifactState.label,
      artifactStateNote: artifactState.note,
      provisionalReviewCount,
      weekShape,
      reflectionsSparse
    }),
    topHighlights: positiveHighlights,
    observations,
    carryForward
  });

  const evidence = buildFallbackEvidenceSummaries(sessionSummaries, extraActivities);
  const facts = weeklyDebriefFactsSchema.parse({
    weekLabel: `Week of ${input.weekStart}`,
    weekRange: weekRangeLabel(input.weekStart),
    title: finalTitle,
    statusLine,
    primaryTakeawayTitle: primaryTakeaway.title,
    primaryTakeawayDetail: primaryTakeaway.detail,
    plannedSessions,
    completedPlannedSessions,
    completedSessions,
    addedSessions,
    skippedSessions,
    remainingSessions,
    keySessionsCompleted,
    keySessionsMissed,
    keySessionsTotal: keySessions.length,
    plannedMinutes,
    completedPlannedMinutes,
    completedMinutes,
    skippedMinutes,
    extraMinutes,
    completionPct: clamp(completionPct, 0, 999),
    dominantSport: getDominantSport(sportMinutes),
    keySessionStatus: keySessions.length > 0 ? "Priority sessions influenced the week." : "Consistency and execution quality explained the week better than one priority session.",
    metrics,
    factualBullets,
    confidenceNote: getConfidenceNote(input),
    artifactStateLabel: artifactState.label,
    artifactStateNote: artifactState.note,
    provisionalReviewCount,
    weekShape,
    reflectionsSparse
  });
  const evidenceGroups = buildEvidenceGroups({
    facts,
    sessionSummaries,
    extraActivities,
    latestIssueSession,
    strongestExecutionSession,
    lateWeekSkippedSessions,
    weekStart: input.weekStart
  });

  return {
    readiness,
    facts,
    deterministicNarrative,
    evidence,
    evidenceGroups,
    sourceUpdatedAt: getSourceUpdatedAt([
      ...input.sessions.map((session) => session.updated_at ?? session.created_at),
      ...input.activities.map((activity) => activity.created_at ?? activity.start_time_utc),
      ...input.links.map((link) => link.created_at ?? null),
      input.athleteContext?.weeklyState.updatedAt
    ])
  };
}

async function loadWeeklyDebriefInputs(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayIso: string;
}) {
  const activityRangeStart = `${addDays(args.weekStart, -1)}T00:00:00.000Z`;
  const activityRangeEnd = `${addDays(args.weekEnd, 2)}T00:00:00.000Z`;

  const [{ data: sessionsData, error: sessionsError }, activities, { data: linksData, error: linksError }, athleteContext] = await Promise.all([
    args.supabase
      .from("sessions")
      .select("id,date,sport,type,session_name,subtype,workout_type,intent_category,session_role,notes,status,duration_minutes,updated_at,created_at,execution_result,is_key")
      .or(`athlete_id.eq.${args.athleteId},user_id.eq.${args.athleteId}`)
      .gte("date", args.weekStart)
      .lte("date", args.weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true }),
    loadCompletedActivities({
      supabase: args.supabase,
      userId: args.athleteId,
      rangeStart: activityRangeStart,
      rangeEnd: activityRangeEnd
    }),
    args.supabase
      .from("session_activity_links")
      .select("completed_activity_id,planned_session_id,confirmation_status,created_at")
      .eq("user_id", args.athleteId),
    getAthleteContextSnapshot(args.supabase, args.athleteId)
  ]);

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }
  if (linksError) {
    throw new Error(linksError.message);
  }

  return {
    sessions: (sessionsData ?? []) as WeeklyDebriefSession[],
    activities: activities as WeeklyDebriefActivity[],
    links: (linksData ?? []) as WeeklyDebriefLink[],
    athleteContext,
    timeZone: args.timeZone,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    todayIso: args.todayIso
  } satisfies WeeklyDebriefInputs;
}

async function loadWeeklyDebriefSourceInputs(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayIso: string;
}) {
  const activityRangeStart = `${addDays(args.weekStart, -1)}T00:00:00.000Z`;
  const activityRangeEnd = `${addDays(args.weekEnd, 2)}T00:00:00.000Z`;

  const [
    { data: sessionsData, error: sessionsError },
    activities,
    { data: linksData, error: linksError },
    { data: checkinData, error: checkinError }
  ] = await Promise.all([
    args.supabase
      .from("sessions")
      .select("id,date,sport,notes,status,duration_minutes,updated_at,created_at,is_key,session_role")
      .or(`athlete_id.eq.${args.athleteId},user_id.eq.${args.athleteId}`)
      .gte("date", args.weekStart)
      .lte("date", args.weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true }),
    loadCompletedActivities({
      supabase: args.supabase,
      userId: args.athleteId,
      rangeStart: activityRangeStart,
      rangeEnd: activityRangeEnd
    }),
    args.supabase
      .from("session_activity_links")
      .select("completed_activity_id,planned_session_id,confirmation_status,created_at")
      .eq("user_id", args.athleteId),
    args.supabase
      .from("athlete_checkins")
      .select("updated_at")
      .eq("athlete_id", args.athleteId)
      .eq("week_start", args.weekStart)
      .maybeSingle()
  ]);

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }
  if (linksError) {
    throw new Error(linksError.message);
  }
  if (checkinError) {
    throw new Error(checkinError.message);
  }

  return {
    sessions: (sessionsData ?? []) as WeeklyDebriefSourceInputs["sessions"],
    activities: activities as WeeklyDebriefActivity[],
    links: (linksData ?? []) as WeeklyDebriefLink[],
    weeklyCheckinUpdatedAt: checkinData?.updated_at ?? null,
    timeZone: args.timeZone,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    todayIso: args.todayIso
  } satisfies WeeklyDebriefSourceInputs;
}

function computeWeeklyDebriefSourceState(input: WeeklyDebriefSourceInputs) {
  const completionLedger = input.sessions.reduce<Record<string, number>>((acc, session) => {
    if (session.status !== "completed") return acc;
    const key = `${session.date}:${session.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const sessionSummaries = input.sessions
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
    .map((session) => ({
      ...session,
      resolvedStatus: inferSessionStatus(session as WeeklyDebriefSession, completionLedger),
      isKey: Boolean(session.is_key) || session.session_role === "key",
      durationMinutes: Math.max(0, session.duration_minutes ?? 0)
    }));

  const confirmedLinks = input.links.filter(hasConfirmedPlannedSessionLink);
  const weekEndExclusive = addDays(input.weekEnd, 1);
  const extraActivities = buildExtraCompletedActivities({
    activities: input.activities,
    links: input.links,
    timeZone: input.timeZone,
    weekStart: input.weekStart,
    weekEndExclusive
  });

  const plannedMinutes = sessionSummaries.reduce((sum, session) => sum + session.durationMinutes, 0);
  const completedMinutes =
    sessionSummaries
      .filter((session) => session.resolvedStatus === "completed")
      .reduce((sum, session) => {
        const linkedMinutes = confirmedLinks
          .filter((link) => link.planned_session_id === session.id)
          .reduce((minutes, link) => {
            const activity = input.activities.find((candidate) => candidate.id === link.completed_activity_id);
            return minutes + Math.round((activity?.duration_sec ?? 0) / 60);
          }, 0);
        return sum + (linkedMinutes > 0 ? linkedMinutes : session.durationMinutes);
      }, 0) +
    extraActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const skippedMinutes = sessionSummaries
    .filter((session) => session.resolvedStatus === "skipped")
    .reduce((sum, session) => sum + session.durationMinutes, 0);
  const resolvedMinutes = completedMinutes + skippedMinutes;

  const keySessions = sessionSummaries.filter((session) => session.isKey);
  const resolvedKeySessions = keySessions.filter(
    (session) => session.resolvedStatus === "completed" || session.resolvedStatus === "skipped"
  ).length;

  return {
    readiness: computeWeeklyDebriefReadiness({
      todayIso: input.todayIso,
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      plannedMinutes,
      resolvedMinutes,
      totalKeySessions: keySessions.length,
      resolvedKeySessions
    }),
    sourceUpdatedAt: getSourceUpdatedAt([
      ...input.sessions.map((session) => session.updated_at ?? session.created_at),
      ...input.activities.map((activity) => activity.created_at ?? activity.start_time_utc),
      ...input.links.map((link) => link.created_at ?? null),
      input.weeklyCheckinUpdatedAt
    ])
  } satisfies WeeklyDebriefSourceState;
}

export async function computeWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayIso: string;
}) {
  const inputs = await loadWeeklyDebriefInputs(args);
  const base = buildWeeklyDebriefFacts(inputs);
  const narrative = await generateNarrative({
    facts: base.facts,
    evidence: base.evidence,
    athleteContext: inputs.athleteContext,
    deterministicFallback: base.deterministicNarrative
  });
  const coachShare = buildCoachShare({
    facts: base.facts,
    narrative
  });

  return {
    readiness: base.readiness,
    facts: base.facts,
    narrative,
    coachShare,
    evidence: base.evidence,
    evidenceGroups: base.evidenceGroups,
    sourceUpdatedAt: base.sourceUpdatedAt
  } satisfies WeeklyDebriefComputed;
}

export async function persistWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  computed: WeeklyDebriefComputed;
}) {
  if (!args.computed.readiness.isReady) {
    throw new Error("Weekly Debrief cannot be persisted before readiness is met.");
  }

  const generatedAt = new Date().toISOString();
  const factsPayload = {
    ...args.computed.facts,
    evidence: args.computed.evidence,
    evidenceGroups: args.computed.evidenceGroups
  };

  const { data, error } = await args.supabase
    .from("weekly_debriefs")
    .upsert({
      athlete_id: args.athleteId,
      user_id: args.athleteId,
      week_start: args.weekStart,
      week_end: args.weekEnd,
      status: "ready",
      source_updated_at: args.computed.sourceUpdatedAt,
      generated_at: generatedAt,
      generation_version: WEEKLY_DEBRIEF_GENERATION_VERSION,
      facts: factsPayload,
      narrative: args.computed.narrative,
      coach_share: args.computed.coachShare
    }, {
      onConflict: "athlete_id,week_start"
    })
    .select("week_start,week_end,status,source_updated_at,generated_at,generation_version,facts,narrative,coach_share,helpful,accurate,feedback_note,feedback_updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Could not persist weekly debrief.");
  }

  return normalizePersistedArtifact(data as WeeklyDebriefRecord, "ready");
}

export async function getPersistedWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
}) {
  const { data, error } = await args.supabase
    .from("weekly_debriefs")
    .select("week_start,week_end,status,source_updated_at,generated_at,generation_version,facts,narrative,coach_share,helpful,accurate,feedback_note,feedback_updated_at")
    .eq("athlete_id", args.athleteId)
    .eq("week_start", args.weekStart)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? (data as WeeklyDebriefRecord) : null;
}

export function isWeeklyDebriefStale(args: {
  persisted: Pick<WeeklyDebriefRecord, "generated_at" | "source_updated_at" | "status" | "generation_version"> | null;
  sourceUpdatedAt: string;
}) {
  if (!args.persisted) return false;
  if (args.persisted.status === "failed") return false;
  return args.persisted.generation_version !== WEEKLY_DEBRIEF_GENERATION_VERSION ||
    args.sourceUpdatedAt > args.persisted.generated_at ||
    args.persisted.source_updated_at !== args.sourceUpdatedAt;
}

export async function getWeeklyDebriefSnapshot(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  timeZone: string;
  todayIso: string;
}) {
  const weekEnd = addDays(args.weekStart, 6);
  const sourceState = computeWeeklyDebriefSourceState(await loadWeeklyDebriefSourceInputs({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart,
    weekEnd,
    timeZone: args.timeZone,
    todayIso: args.todayIso
  }));

  if (!sourceState.readiness.isReady) {
    return {
      readiness: sourceState.readiness,
      artifact: null,
      stale: false,
      sourceUpdatedAt: sourceState.sourceUpdatedAt,
      weekStart: args.weekStart,
      weekEnd
    } satisfies WeeklyDebriefSnapshot;
  }

  const persisted = await getPersistedWeeklyDebrief({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart
  });

  if (!persisted) {
    return {
      readiness: sourceState.readiness,
      artifact: null,
      stale: false,
      sourceUpdatedAt: sourceState.sourceUpdatedAt,
      weekStart: args.weekStart,
      weekEnd
    } satisfies WeeklyDebriefSnapshot;
  }

  const stale = isWeeklyDebriefStale({
    persisted,
    sourceUpdatedAt: sourceState.sourceUpdatedAt
  });
  const effectiveStatus = stale ? "stale" : persisted.status;
  return {
    readiness: sourceState.readiness,
    artifact: normalizePersistedArtifact(persisted, effectiveStatus),
    stale,
    sourceUpdatedAt: sourceState.sourceUpdatedAt,
    weekStart: args.weekStart,
    weekEnd
  } satisfies WeeklyDebriefSnapshot;
}

export async function refreshWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  timeZone: string;
  todayIso: string;
}) {
  const weekEnd = addDays(args.weekStart, 6);
  const computed = await computeWeeklyDebrief({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart,
    weekEnd,
    timeZone: args.timeZone,
    todayIso: args.todayIso
  });

  if (!computed.readiness.isReady) {
    return {
      readiness: computed.readiness,
      artifact: null
    };
  }

  const artifact = await persistWeeklyDebrief({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart,
    weekEnd,
    computed
  });

  return {
    readiness: computed.readiness,
    artifact
  };
}

const weeklyDebriefFeedbackInputSchema = z.object({
  weekStart: z.string().date(),
  helpful: z.boolean().nullable(),
  accurate: z.boolean().nullable(),
  note: z.string().trim().max(400).nullable().optional()
});

export type WeeklyDebriefFeedbackInput = z.infer<typeof weeklyDebriefFeedbackInputSchema>;

export async function saveWeeklyDebriefFeedback(args: {
  supabase: SupabaseClient;
  athleteId: string;
  input: WeeklyDebriefFeedbackInput;
}) {
  const parsed = weeklyDebriefFeedbackInputSchema.parse(args.input);
  const feedbackUpdatedAt = new Date().toISOString();
  const { data, error } = await args.supabase
    .from("weekly_debriefs")
    .update({
      helpful: parsed.helpful,
      accurate: parsed.accurate,
      feedback_note: parsed.note ?? null,
      feedback_updated_at: feedbackUpdatedAt
    })
    .eq("athlete_id", args.athleteId)
    .eq("week_start", parsed.weekStart)
    .select("week_start,week_end,status,source_updated_at,generated_at,generation_version,facts,narrative,coach_share,helpful,accurate,feedback_note,feedback_updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Weekly Debrief must be generated before feedback can be saved.");
  }

  return normalizePersistedArtifact(data as WeeklyDebriefRecord, data.status);
}

export async function getAdjacentWeeklyDebriefs(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
}) {
  const [{ data: prevData, error: prevError }, { data: nextData, error: nextError }] = await Promise.all([
    args.supabase
      .from("weekly_debriefs")
      .select("week_start")
      .eq("athlete_id", args.athleteId)
      .lt("week_start", args.weekStart)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    args.supabase
      .from("weekly_debriefs")
      .select("week_start")
      .eq("athlete_id", args.athleteId)
      .gt("week_start", args.weekStart)
      .order("week_start", { ascending: true })
      .limit(1)
      .maybeSingle()
  ]);

  if (prevError) throw new Error(prevError.message);
  if (nextError) throw new Error(nextError.message);

  return {
    previousWeekStart: prevData?.week_start ?? null,
    nextWeekStart: nextData?.week_start ?? null
  };
}
