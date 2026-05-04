/**
 * Shared calendar types extracted so the modal siblings and the main
 * `week-calendar.tsx` can both depend on them without a circular import.
 */

import type { SessionLifecycleState } from "@/lib/training/semantics";

export type SessionStatus = SessionLifecycleState;

export type WeekDay = { iso: string; weekday: string; label: string };

export type CalendarSession = {
  id: string;
  date: string;
  sport: string;
  type: string;
  sessionName?: string | null;
  discipline?: string | null;
  subtype?: string | null;
  workoutType?: string | null;
  intentCategory?: string | null;
  role?: "key" | "supporting" | "recovery" | "optional" | null;
  source?: { uploadId?: string | null; assignmentId?: string | null; assignedBy?: "planner" | "upload" | "coach" | null } | null;
  executionResult?: {
    status?: "matched_intent" | "partial_intent" | "missed_intent" | null;
    summary?: string | null;
    executionScore?: number | null;
    execution_score?: number | null;
    executionScoreBand?: string | null;
    execution_score_band?: string | null;
    executionScoreSummary?: string | null;
    recommendedNextAction?: string | null;
    recommended_next_action?: string | null;
    executionScoreProvisional?: boolean | null;
    execution_score_provisional?: boolean | null;
  } | null;
  duration: number;
  notes: string | null;
  target?: string | null;
  created_at: string;
  status: SessionStatus;
  linkedActivityCount?: number;
  linkedStats?: { durationMin: number; distanceKm: number; avgHr: number | null; avgPower: number | null } | null;
  unassignedSameDayCount?: number;
  is_key?: boolean;
  isUnplanned?: boolean;
  displayType?: "planned_session" | "completed_activity";
  raceSegments?: Array<{
    activityId: string;
    role: "swim" | "t1" | "bike" | "t2" | "run";
    sport: string;
    durationMin: number;
    distanceKm: number | null;
  }> | null;
};
