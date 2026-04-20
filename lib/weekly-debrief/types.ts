import { z } from "zod";
import { clip } from "@/lib/openai";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import type { PersistedExecutionReview } from "@/lib/execution-review";

export const WEEKLY_DEBRIEF_GENERATION_VERSION = 8;

/** @deprecated Use clip() from lib/openai.ts — this alias exists only for schema transform compatibility. */
export const truncateStr = clip;

export const weeklyDebriefEvidenceItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).transform((s) => truncateStr(s, 160)),
  detail: z.string().min(1).transform((s) => truncateStr(s, 280)),
  kind: z.enum(["session", "activity"]),
  href: z.string().min(1),
  supportType: z.enum(["fact", "observation", "carry_forward"])
});

export type WeeklyDebriefEvidenceItem = z.infer<typeof weeklyDebriefEvidenceItemSchema>;

export const weeklyDebriefEvidenceGroupSchema = z.object({
  claim: z.string().min(1).transform((s) => truncateStr(s, 160)),
  detail: z.string().min(1).transform((s) => truncateStr(s, 280)),
  supports: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).transform((s) => truncateStr(s, 160)),
    href: z.string().min(1),
    kind: z.enum(["session", "activity"]),
    reason: z.string().min(1).transform((s) => truncateStr(s, 200))
  })).min(1).max(5)
});

export type WeeklyDebriefEvidenceGroup = z.infer<typeof weeklyDebriefEvidenceGroupSchema>;

export const weeklyDebriefFactsSchema = z.object({
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
  narrativeSource: z.enum(["ai", "fallback", "legacy_unknown"]).default("legacy_unknown"),
  artifactStateLabel: z.enum(["final", "provisional"]).default("provisional"),
  artifactStateNote: z.string().min(1).max(200).nullable().default(null),
  provisionalReviewCount: z.number().int().min(0).default(0),
  weekShape: z.enum(["normal", "partial_reflection", "disrupted"]),
  reflectionsSparse: z.boolean(),
  feelsSnapshot: z.object({
    sessionsWithFeels: z.number().int().min(0),
    avgOverallFeel: z.number().min(1).max(5).nullable(),
    notablePatterns: z.array(z.string().min(1).max(120))
  }).nullable().default(null)
});

export type WeeklyDebriefFacts = z.infer<typeof weeklyDebriefFactsSchema>;

export const weeklyDebriefNarrativeSchema = z.object({
  executiveSummary: z.string().min(1).max(420),
  highlights: z.array(z.string().min(1).max(220)).min(3).max(3),
  observations: z.array(z.string().min(1).max(220)).min(1).max(3),
  carryForward: z.array(z.string().min(1).max(280)).min(2).max(2),
  /**
   * Required weekly-level finding the athlete would not spot by reading
   * individual session reviews. Usually a pattern across sessions, a shift in
   * decoupling/readiness over the week, or a historical comparison.
   */
  nonObviousInsight: z.string().min(1).max(360)
});

export type WeeklyDebriefNarrative = z.infer<typeof weeklyDebriefNarrativeSchema>;

export const weeklyDebriefCoachShareSchema = z.object({
  headline: z.string().min(1).max(120),
  summary: z.string().min(1).max(320),
  wins: z.array(z.string().min(1).max(180)).min(1).max(3),
  concerns: z.array(z.string().min(1).max(180)).min(1).max(3),
  carryForward: z.array(z.string().min(1).max(280)).min(2).max(2)
});

export type WeeklyDebriefCoachShare = z.infer<typeof weeklyDebriefCoachShareSchema>;

export const weeklyDebriefArtifactSchema = z.object({
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

export const weeklyDebriefReadinessSchema = z.object({
  isReady: z.boolean(),
  reason: z.string().min(1).max(220),
  unlockedBy: z.enum(["end_of_week", "effective_completion", "insufficient_signal"]),
  resolvedKeySessions: z.number().int().min(0),
  totalKeySessions: z.number().int().min(0),
  resolvedMinutes: z.number().int().min(0),
  plannedMinutes: z.number().int().min(0)
});

export type WeeklyDebriefReadiness = z.infer<typeof weeklyDebriefReadinessSchema>;

export type WeeklyDebriefSession = {
  id: string;
  athlete_id?: string | null;
  user_id?: string | null;
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

export type WeeklyDebriefActivity = {
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
  metrics_v2?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export type WeeklyDebriefLink = {
  completed_activity_id: string;
  planned_session_id?: string | null;
  confirmation_status?: "suggested" | "confirmed" | "rejected" | null;
  created_at?: string | null;
};

export type WeeklyDebriefCheckIn = {
  fatigueScore: number | null;
  stressScore: number | null;
  motivationScore: number | null;
  weekNotes: string | null;
};

type WeeklyDebriefSessionFeel = {
  sessionId: string;
  overallFeel: number;
  energyLevel: string | null;
  legsFeel: string | null;
  motivation: string | null;
  sleepQuality: string | null;
  lifeStress: string | null;
  note: string | null;
};

export type WeeklyDebriefInputs = {
  sessions: WeeklyDebriefSession[];
  activities: WeeklyDebriefActivity[];
  links: WeeklyDebriefLink[];
  sessionFeels: WeeklyDebriefSessionFeel[];
  athleteContext: AthleteContextSnapshot | null;
  checkIn: WeeklyDebriefCheckIn | null;
  timeZone: string;
  weekStart: string;
  weekEnd: string;
  todayIso: string;
};

export type WeeklyDebriefSourceInputs = {
  sessions: Array<Pick<WeeklyDebriefSession, "id" | "date" | "sport" | "notes" | "status" | "duration_minutes" | "updated_at" | "created_at" | "is_key" | "session_role">>;
  activities: WeeklyDebriefActivity[];
  links: WeeklyDebriefLink[];
  weeklyCheckinUpdatedAt: string | null;
  latestFeelUpdatedAt: string | null;
  timeZone: string;
  weekStart: string;
  weekEnd: string;
  todayIso: string;
};

export type WeeklyDebriefSourceState = {
  readiness: WeeklyDebriefReadiness;
  sourceUpdatedAt: string;
};

export type WeeklyDebriefSessionSummary = {
  id: string;
  label: string;
  date: string;
  sport: string;
  durationMinutes: number;
  status: "completed" | "planned" | "skipped";
  isKey: boolean;
  review: PersistedExecutionReview | null;
  completedMinutes: number;
  feels: {
    overallFeel: number;
    energyLevel: string | null;
    legsFeel: string | null;
    motivation: string | null;
    note: string | null;
  } | null;
};

export type WeeklyDebriefComputed = {
  readiness: WeeklyDebriefReadiness;
  facts: WeeklyDebriefFacts;
  narrative: WeeklyDebriefNarrative;
  coachShare: WeeklyDebriefCoachShare;
  evidence: WeeklyDebriefEvidenceItem[];
  evidenceGroups: WeeklyDebriefEvidenceGroup[];
  sourceUpdatedAt: string;
};

export type WeeklyDebriefActivityEvidence = {
  context: "linked_session" | "extra_activity";
  label: string;
  sport: string;
  activityId: string;
  sessionId?: string;
  summary: {
    durationSec: number | null;
    distanceM: number | null;
    avgHr: number | null;
    avgPower: number | null;
    qualityWarnings: string[];
  };
  run?: Record<string, unknown>;
  swim?: Record<string, unknown>;
  bike?: Record<string, unknown>;
  other?: Record<string, unknown>;
};

export type WeeklyDebriefRecord = {
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

export const weeklyDebriefFeedbackInputSchema = z.object({
  weekStart: z.string().date(),
  helpful: z.boolean().nullable(),
  accurate: z.boolean().nullable(),
  note: z.string().trim().max(400).nullable().optional()
});

export type WeeklyDebriefFeedbackInput = z.infer<typeof weeklyDebriefFeedbackInputSchema>;
