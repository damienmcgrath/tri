import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { buildExtraCompletedActivities } from "@/lib/activities/completed-activities";
import type {
  WeeklyDebriefSession,
  WeeklyDebriefInputs,
  WeeklyDebriefFacts,
  WeeklyDebriefNarrative,
  WeeklyDebriefReadiness,
  WeeklyDebriefRecord,
  WeeklyDebriefEvidenceItem,
  WeeklyDebriefEvidenceGroup,
  WeeklyDebriefSessionSummary,
  WeeklyDebriefActivityEvidence
} from "./types";
import {
  weeklyDebriefReadinessSchema,
  weeklyDebriefNarrativeSchema,
  weeklyDebriefCoachShareSchema,
  weeklyDebriefArtifactSchema,
  weeklyDebriefEvidenceItemSchema,
  weeklyDebriefEvidenceGroupSchema
} from "./types";
import { capitalize } from "./format";

export function isSkippedByTag(notes: string | null | undefined) {
  return /\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(notes ?? "");
}

export function inferSessionStatus(session: WeeklyDebriefSession, completionLedger: Record<string, number>) {
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

export function getConfidenceNote(inputs: WeeklyDebriefInputs) {
  return null;
}

export function buildArtifactState(args: { provisionalReviewCount: number }) {
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
  const hasAnyContent = args.plannedMinutes > 0 || args.resolvedMinutes > 0;
  const effectiveCompletionReady =
    args.plannedMinutes > 0 &&
    args.resolvedMinutes >= Math.round(args.plannedMinutes * 0.7) &&
    args.totalKeySessions === args.resolvedKeySessions;

  if (!hasAnyContent) {
    return weeklyDebriefReadinessSchema.parse({
      isReady: false,
      reason: "No planned or completed sessions this week — nothing to debrief yet.",
      unlockedBy: "insufficient_signal",
      resolvedKeySessions: args.resolvedKeySessions,
      totalKeySessions: args.totalKeySessions,
      resolvedMinutes: args.resolvedMinutes,
      plannedMinutes: args.plannedMinutes
    });
  }

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

export function buildDeterministicNarrative(args: {
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

export function buildCoachShare(args: { facts: WeeklyDebriefFacts; narrative: WeeklyDebriefNarrative }) {
  const clip = (value: string, max: number) => value.trim().slice(0, max);
  return weeklyDebriefCoachShareSchema.parse({
    headline: clip(args.facts.title, 120),
    summary: clip(args.narrative.executiveSummary, 320),
    wins: args.narrative.highlights.slice(0, 3).map((item) => clip(item, 180)),
    concerns: args.narrative.observations.slice(0, 3).map((item) => clip(item, 180)),
    carryForward: args.narrative.carryForward.slice(0, 2).map((item) => clip(item, 280))
  });
}

function coerceNarrativeString(value: unknown, maxLength: number) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const candidate =
      (typeof record.text === "string" && record.text) ||
      (typeof record.summary === "string" && record.summary) ||
      (typeof record.detail === "string" && record.detail) ||
      (typeof record.observation === "string" && record.observation) ||
      (typeof record.highlight === "string" && record.highlight) ||
      (typeof record.title === "string" && record.title) ||
      (typeof record.label === "string" && record.label) ||
      (typeof record.claim === "string" && record.claim) ||
      null;

    if (candidate) {
      const trimmed = candidate.trim();
      return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
    }
  }

  return null;
}

function coerceNarrativeList(value: unknown, maxItems: number, maxItemLength: number) {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((entry) => coerceNarrativeString(entry, maxItemLength))
    .filter((entry): entry is string => Boolean(entry));

  return items.slice(0, maxItems);
}

export function normalizeNarrativePayload(payload: unknown) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};

  return {
    executiveSummary: coerceNarrativeString(record.executiveSummary, 420),
    highlights: coerceNarrativeList(record.highlights, 3, 220),
    observations: coerceNarrativeList(record.observations, 3, 220),
    carryForward: coerceNarrativeList(record.carryForward, 2, 280)
  };
}

export function hydrateNarrativePayload(
  normalized: ReturnType<typeof normalizeNarrativePayload>,
  fallback: WeeklyDebriefNarrative
) {
  return {
    executiveSummary: normalized.executiveSummary ?? fallback.executiveSummary,
    highlights: normalized.highlights.length > 0 ? normalized.highlights : fallback.highlights.slice(0, 3),
    observations: normalized.observations.length > 0 ? normalized.observations : fallback.observations.slice(0, 3),
    carryForward: normalized.carryForward.length > 0 ? normalized.carryForward : fallback.carryForward.slice(0, 2)
  };
}

export function getSourceUpdatedAt(values: Array<string | null | undefined>) {
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

export function normalizePersistedArtifact(record: WeeklyDebriefRecord, effectiveStatus: "ready" | "stale" | "failed") {
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
      helpful: record.helpful ?? null,
      accurate: record.accurate ?? null,
      note: record.feedback_note ?? null,
      updatedAt: normalizeTimestamp(record.feedback_updated_at)
    }
  });

  return {
    ...artifact,
    evidence: Array.isArray((normalizedFacts as { evidence?: unknown })?.evidence) ? weeklyDebriefEvidenceItemSchema.array().parse((normalizedFacts as { evidence: unknown }).evidence) : [],
    evidenceGroups: Array.isArray((normalizedFacts as { evidenceGroups?: unknown })?.evidenceGroups) ? weeklyDebriefEvidenceGroupSchema.array().parse((normalizedFacts as { evidenceGroups: unknown }).evidenceGroups) : []
  };
}
