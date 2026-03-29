"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SessionStatusChip } from "@/lib/ui/status-chip";
import { getSessionDisplayName } from "@/lib/training/session";
import { getDayStateLabel, type SessionLifecycleState } from "@/lib/training/semantics";
import { acceptAdaptationAction, clearSkippedAction, confirmSkippedAction, dismissAdaptationAction, markActivityExtraAction, markSkippedAction, moveSessionAction, quickAddSessionAction } from "@/app/(protected)/calendar/actions";
import { linkActivityAction } from "@/app/(protected)/activities/[activityId]/actions";
import { hasConfirmedSkipTag } from "@/lib/plans/skip-notes";

type SessionStatus = SessionLifecycleState;
type FilterStatus = "all" | SessionStatus | "extra" | "moved";
type SportFilter = "all" | "swim" | "bike" | "run" | "strength";

type CalendarSession = {
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
  executionResult?: { status?: "matched_intent" | "partial_intent" | "missed_intent" | null; summary?: string | null; executionScore?: number | null; execution_score?: number | null; executionScoreBand?: string | null; execution_score_band?: string | null; executionScoreSummary?: string | null; recommendedNextAction?: string | null; recommended_next_action?: string | null; executionScoreProvisional?: boolean | null; execution_score_provisional?: boolean | null } | null;
  duration: number;
  notes: string | null;
  created_at: string;
  status: SessionStatus;
  linkedActivityCount?: number;
  linkedStats?: { durationMin: number; distanceKm: number; avgHr: number | null; avgPower: number | null } | null;
  unassignedSameDayCount?: number;
  is_key?: boolean;
  isUnplanned?: boolean;
  displayType?: "planned_session" | "completed_activity";
};

type WeekDay = { iso: string; weekday: string; label: string };
type RecentMove = { sessionId: string; fromDate: string; toDate: string };
type AdaptationIssueType = "unmatched_upload" | "skipped_reassign" | "moved_session" | "extra_workout";
const MOVE_TAG_PATTERN = /\[moved\sfrom\s(\d{4}-\d{2}-\d{2})\]/i;

const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const uploadDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function calendarDisciplineChipTone(sport: string) {
  const tones: Record<string, { bg: string; text: string; dot: string; border: string }> = {
    swim: { bg: "rgba(86,182,217,0.16)", text: "#BFE9F8", dot: "#78CCE8", border: "rgba(86,182,217,0.28)" },
    bike: { bg: "rgba(107,170,117,0.15)", text: "#C9E8CF", dot: "#8AC896", border: "rgba(107,170,117,0.28)" },
    run: { bg: "rgba(196,135,114,0.15)", text: "#F0D3C8", dot: "#D9A995", border: "rgba(196,135,114,0.28)" },
    strength: { bg: "rgba(154,134,200,0.16)", text: "#E2D7F8", dot: "#BDA8E8", border: "rgba(154,134,200,0.3)" },
    other: { bg: "rgba(148,163,184,0.15)", text: "#E2E8F0", dot: "#CBD5E1", border: "rgba(148,163,184,0.28)" }
  };

  return tones[sport] ?? tones.other;
}

function calendarDisciplineBorderColor(sport: string) {
  const tones: Record<string, string> = {
    run: "var(--color-run)",
    swim: "var(--color-swim)",
    bike: "var(--color-bike)",
    strength: "var(--color-strength)"
  };

  return tones[sport] ?? "rgba(255,255,255,0.24)";
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getMonday(date = new Date()) {
  const day = date.getUTCDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - distanceFromMonday);
  return monday;
}

function isSkipped(notes: string | null) {
  return /\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(notes ?? "");
}

function getMovedFromDate(notes: string | null) {
  const match = (notes ?? "").match(MOVE_TAG_PATTERN);
  return match?.[1] ?? null;
}

function getActivityId(sessionId: string) {
  return sessionId.startsWith("activity-") ? sessionId.replace("activity-", "") : null;
}

function getSessionTitle(session: CalendarSession) {
  return getSessionDisplayName({
    sessionName: session.sessionName,
    discipline: session.discipline ?? session.sport,
    subtype: session.subtype,
    workoutType: session.workoutType,
    type: session.type
  });
}

function getSuggestedSessionId(upload: CalendarSession, candidateSessions: CalendarSession[]) {
  if (candidateSessions.length === 0) return "";

  const scoredCandidates = candidateSessions.map((session, index) => {
    let score = 0;

    if (session.date === upload.date) score += 5;
    if (session.sport === upload.sport) score += 4;
    if (session.status === "planned") score += 2;
    if (session.status === "skipped") score -= 1;

    const durationDelta = Math.abs(session.duration - upload.duration);
    score -= durationDelta / 30;

    return { sessionId: session.id, score, index };
  });

  scoredCandidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.index - right.index;
  });

  return scoredCandidates[0]?.sessionId ?? candidateSessions[0]?.id ?? "";
}

function getSessionState(session: CalendarSession, recentMoves: RecentMove[], extraActivityIds: string[]) {
  if (session.displayType === "completed_activity") {
    if (session.isUnplanned || extraActivityIds.includes(session.id)) {
      return "extra" as const;
    }
    return "unmatched_upload" as const;
  }
  if (recentMoves.some((move) => move.sessionId === session.id)) {
    return "moved" as const;
  }
  if (session.linkedActivityCount && session.linkedActivityCount > 0 && session.status === "completed") {
    return "assigned_from_upload" as const;
  }
  return session.status;
}

function getIssueId(type: AdaptationIssueType, id: string) {
  return `${type}:${id}`;
}

function getDismissedIssuesStorageKey(weekStart: string) {
  return `tri.calendar.dismissedIssues:${weekStart}`;
}

function SessionActionMenu({
  session,
  state,
  onMove,
  onOpen,
  onToggleSkip,
  onAssign
}: {
  session: CalendarSession;
  state: "planned" | "completed" | "skipped" | "extra" | "moved" | "assigned_from_upload" | "unmatched_upload";
  onMove: () => void;
  onOpen: () => void;
  onToggleSkip: () => void;
  onAssign: () => void;
}) {
  const [open, setOpen] = useState(false);
  const activityId = getActivityId(session.id);

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-[11px] text-muted hover:text-foreground"
        aria-label="Card actions"
        onClick={() => setOpen((value) => !value)}
      >
        •••
      </button>
      {open ? (
        <div className="absolute right-0 top-7 z-20 w-36 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-1 text-[11px] shadow-lg">
          {session.displayType === "completed_activity" && activityId ? (
            <Link className="block rounded px-2 py-1 hover:bg-[hsl(var(--surface-subtle))]" href={`/sessions/activity-${activityId}`}>
              Open details
            </Link>
          ) : session.displayType !== "completed_activity" && session.status === "completed" ? (
            <Link className="block rounded px-2 py-1 hover:bg-[hsl(var(--surface-subtle))]" href={`/sessions/${session.id}`}>
              Open details
            </Link>
          ) : (
            <button className="block w-full rounded px-2 py-1 text-left hover:bg-[hsl(var(--surface-subtle))]" onClick={() => { onOpen(); setOpen(false); }}>
              Open details
            </button>
          )}
          {session.displayType !== "completed_activity" ? (
            <button className="block w-full rounded px-2 py-1 text-left hover:bg-[hsl(var(--surface-subtle))]" onClick={() => { onMove(); setOpen(false); }}>
              Move
            </button>
          ) : null}
          {session.displayType !== "completed_activity" ? (
            <button className="block w-full rounded px-2 py-1 text-left hover:bg-[hsl(var(--surface-subtle))]" onClick={() => { onToggleSkip(); setOpen(false); }}>
              {state === "skipped" ? "Mark planned" : "Mark skipped"}
            </button>
          ) : null}
          {session.displayType === "completed_activity" && session.source?.uploadId ? (
            <button className="block w-full rounded px-2 py-1 text-left hover:bg-[hsl(var(--surface-subtle))]" onClick={() => { onAssign(); setOpen(false); }}>
              Assign to session
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type PendingAdaptation = { id: string; trigger_type: string; options: unknown };

export function WeekCalendar({
  weekDays,
  sessions,
  completedCount,
  plannedRemainingCount,
  skippedCount,
  extraSessionCount,
  pendingAdaptations = [],
  weekStart
}: {
  weekDays: WeekDay[];
  sessions: CalendarSession[];
  executionLabel: string;
  executionSubtext?: string;
  completedCount: number;
  plannedTotalCount: number;
  skippedCount: number;
  extraSessionCount: number;
  plannedRemainingCount: number;
  plannedMinutes: number;
  completedMinutes: number;
  remainingMinutes: number;
  pendingAdaptations?: PendingAdaptation[];
  weekStart?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sportFilter, setSportFilter] = useState<SportFilter>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
  const [moveSource, setMoveSource] = useState<CalendarSession | null>(null);
  const [detailSession, setDetailSession] = useState<CalendarSession | null>(null);
  const [assignSource, setAssignSource] = useState<CalendarSession | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissedIssues, setDismissedIssues] = useState<string[]>([]);
  const [loadedDismissedIssuesWeek, setLoadedDismissedIssuesWeek] = useState<string | null>(null);
  const [localAdaptations, setLocalAdaptations] = useState<PendingAdaptation[]>(pendingAdaptations);
  const [expandedAdaptationId, setExpandedAdaptationId] = useState<string | null>(null);
  const [loadingAdaptations, setLoadingAdaptations] = useState(false);
  const [extraActivityIds, setExtraActivityIds] = useState<string[]>([]);
  const [recentMoves, setRecentMoves] = useState<RecentMove[]>([]);
  const [isPending, startTransition] = useTransition();
  const [localSessions, setLocalSessions] = useState<CalendarSession[]>(sessions);
  const isOverlayOpen = Boolean(quickAddDate || moveSource || detailSession || assignSource);

  useEffect(() => setLocalSessions(sessions), [sessions]);
  const persistedMoves = useMemo(
    () =>
      localSessions
        .filter((session) => session.displayType !== "completed_activity")
        .map((session) => {
          const fromDate = getMovedFromDate(session.notes);
          return fromDate ? ({ sessionId: session.id, fromDate, toDate: session.date } as RecentMove) : null;
        })
        .filter((move): move is RecentMove => Boolean(move)),
    [localSessions]
  );
  const trackedMoves = useMemo(
    () => [...recentMoves, ...persistedMoves.filter((move) => !recentMoves.some((item) => item.sessionId === move.sessionId))],
    [persistedMoves, recentMoves]
  );
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isOverlayOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isOverlayOpen]);

  const currentWeekStart = getMonday().toISOString().slice(0, 10);
  const activeWeekStart = weekDays[0]?.iso ?? currentWeekStart;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedValue = window.localStorage.getItem(getDismissedIssuesStorageKey(activeWeekStart));
    if (!storedValue) {
      setDismissedIssues([]);
      setLoadedDismissedIssuesWeek(activeWeekStart);
      return;
    }

    try {
      const parsed = JSON.parse(storedValue);
      setDismissedIssues(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
    } catch {
      setDismissedIssues([]);
    }
    setLoadedDismissedIssuesWeek(activeWeekStart);
  }, [activeWeekStart]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loadedDismissedIssuesWeek !== activeWeekStart) return;
    window.localStorage.setItem(getDismissedIssuesStorageKey(activeWeekStart), JSON.stringify([...new Set(dismissedIssues)]));
  }, [activeWeekStart, dismissedIssues, loadedDismissedIssuesWeek]);

  const withWeek = (targetWeekStart: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (targetWeekStart === currentWeekStart) params.delete("weekStart");
    else params.set("weekStart", targetWeekStart);
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  };

  const filteredSessions = useMemo(() => {
    return localSessions.filter((session) => {
      const sportMatch = sportFilter === "all" || session.sport === sportFilter;
      const state = getSessionState(session, trackedMoves, extraActivityIds);
      const statusMatch = statusFilter === "all" || state === statusFilter;
      return sportMatch && statusMatch;
    });
  }, [extraActivityIds, localSessions, sportFilter, statusFilter, trackedMoves]);

  const visibleIds = useMemo(() => new Set(filteredSessions.map((session) => session.id)), [filteredSessions]);

  const sessionsByDay = useMemo(
    () =>
      weekDays.reduce<Record<string, CalendarSession[]>>((acc, day) => {
        acc[day.iso] = localSessions.filter((session) => session.date === day.iso && visibleIds.has(session.id));
        return acc;
      }, {}),
    [localSessions, visibleIds, weekDays]
  );

  const dayMetrics = useMemo(
    () =>
      weekDays.map((day) => {
        const all = localSessions.filter((session) => session.date === day.iso);
        const planned = all.filter((session) => session.displayType !== "completed_activity");
        const plannedMin = planned.reduce((sum, item) => sum + item.duration, 0);
        const completedMin = planned.filter((item) => item.status === "completed").reduce((sum, item) => sum + item.duration, 0);
        const skipped = planned.filter((item) => item.status === "skipped" || isSkipped(item.notes)).length;
        const isRest = planned.length === 0 && all.some((item) => item.type?.toLowerCase().includes("rest"));
        const openCapacity = planned.length > 0 && plannedMin <= 50;
        const fullyDone = planned.length > 0 && planned.every((item) => item.status === "completed");
        const availableDay = planned.length === 0 && !isRest;
        const hasPlanned = planned.length > 0;
        const remainingPlanned = Math.max(plannedMin - completedMin, 0);
        return { day: day.iso, plannedMin, completedMin, skipped, openCapacity, isRest, fullyDone, availableDay, hasPlanned, remainingPlanned };
      }),
    [localSessions, weekDays]
  );

  const unmatchedUploads = localSessions
    .filter(
      (session) =>
        session.displayType === "completed_activity" &&
        !session.isUnplanned &&
        !extraActivityIds.includes(session.id) &&
        !dismissedIssues.includes(getIssueId("unmatched_upload", session.id))
    )
    .slice(0, 2);
  const skippedToResolve = localSessions
    .filter(
      (session) =>
        session.displayType !== "completed_activity" &&
        session.status === "skipped" &&
        !hasConfirmedSkipTag(session.notes) &&
        !dismissedIssues.includes(getIssueId("skipped_reassign", session.id))
    )
    .slice(0, 2);
  const movedItems = trackedMoves
    .filter((move) => !dismissedIssues.includes(getIssueId("moved_session", move.sessionId)))
    .slice(0, 2);
  const extraItems = localSessions
    .filter(
      (session) =>
        session.displayType === "completed_activity" &&
        (session.isUnplanned || extraActivityIds.includes(session.id)) &&
        !dismissedIssues.includes(getIssueId("extra_workout", session.id))
    )
    .slice(0, 2);

  const hasLoadedDismissalsForActiveWeek = loadedDismissedIssuesWeek === activeWeekStart;
  const hasAdaptation = unmatchedUploads.length > 0 || skippedToResolve.length > 0 || movedItems.length > 0 || extraItems.length > 0;

  const todayIso = new Date().toISOString().slice(0, 10);
  const absorbDay = dayMetrics.find((day) => day.openCapacity || day.availableDay)?.day ?? weekDays[0]?.iso;
  const absorbDayLabel = weekDays.find((day) => day.iso === absorbDay)?.weekday ?? absorbDay;

  function moveSession(session: CalendarSession, newDate: string) {
    if (session.date === newDate) return;
    const fromDate = session.date;
    startTransition(() => {
      void (async () => {
        try {
          await moveSessionAction({ sessionId: session.id, newDate });
          setRecentMoves((prev) => [{ sessionId: session.id, fromDate, toDate: newDate }, ...prev.filter((item) => item.sessionId !== session.id)]);
          setToast(`Moved to ${weekDays.find((day) => day.iso === newDate)?.weekday ?? "new day"}`);
          router.refresh();
        } catch {
          setToast("Could not move session");
        }
      })();
    });
  }

  return (
    <section className="space-y-3">
      <header className="surface-subtle flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <p className="text-sm font-semibold">{dayFormatter.format(new Date(`${weekDays[0].iso}T00:00:00.000Z`))} – {dayFormatter.format(new Date(`${weekDays[6].iso}T00:00:00.000Z`))}</p>
          <Link href={withWeek(addDays(activeWeekStart, -7))} className="rounded-md border border-[rgba(255,255,255,0.12)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-[rgba(255,255,255,0.6)]">Prev</Link>
          <Link
            href={withWeek(currentWeekStart)}
            className={`rounded-md border bg-[var(--color-surface-raised)] px-2 py-1 text-xs ${
              activeWeekStart === currentWeekStart
                ? "border-[rgba(190,255,0,0.40)] text-[var(--color-accent)]"
                : "border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.6)]"
            }`}
          >
            This week
          </Link>
          <Link href={withWeek(addDays(activeWeekStart, 7))} className="rounded-md border border-[rgba(255,255,255,0.12)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-[rgba(255,255,255,0.6)]">Next</Link>
        </div>
        <div className="flex flex-col gap-2 text-xs sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="sport-filter">Discipline filter</label>
            <select id="sport-filter" value={sportFilter} onChange={(e) => setSportFilter(e.target.value as SportFilter)} className="flex-1 rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1.5 sm:flex-none sm:py-1">
              <option value="all">All disciplines</option><option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option><option value="strength">Strength</option>
            </select>
            <label className="sr-only" htmlFor="status-filter">Status filter</label>
            <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FilterStatus)} className="flex-1 rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1.5 sm:flex-none sm:py-1">
              <option value="all">All statuses</option><option value="planned">Planned</option><option value="completed">Completed</option><option value="skipped">Skipped</option><option value="moved">Moved</option><option value="extra">Extra</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setQuickAddDate(weekDays[0]?.iso)} className="btn-primary px-3 text-xs">Add session</button>
            <span className="hidden sm:inline rounded-full border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--surface-subtle)/0.45)] px-2 py-0.5 text-[11px] text-muted">{completedCount} done · {plannedRemainingCount} remaining · {skippedCount} skipped · {extraSessionCount} extra</span>
            <span className="sm:hidden rounded-full border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--surface-subtle)/0.45)] px-2 py-0.5 text-[11px] text-muted">{completedCount} done · {skippedCount} skipped</span>
          </div>
        </div>
      </header>

      {hasLoadedDismissalsForActiveWeek && hasAdaptation ? (
        <section className="rounded-xl border border-[hsl(var(--border)/0.62)] bg-[linear-gradient(180deg,hsl(var(--bg-elevated)/0.78),hsl(var(--bg-elevated)/0.58))] px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-danger">Needs attention</p>
            <p className="text-[11px] text-muted">
              {unmatchedUploads.length + skippedToResolve.length + movedItems.length + extraItems.length} open
            </p>
          </div>
          <div className="flex flex-col gap-1.5 text-xs">
            {unmatchedUploads.map((upload) => (
              <div key={upload.id} className="flex flex-col gap-1.5 rounded-lg border border-[hsl(var(--accent-performance)/0.26)] bg-[hsl(var(--accent-performance)/0.04)] px-2.5 py-2 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-[hsl(var(--text-primary))]">Upload needs review</p>
                  <p className="text-[11px] text-muted">{getDisciplineMeta(upload.sport).label} · {upload.duration} min · logged {uploadDateFormatter.format(new Date(`${upload.created_at}`))}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] md:justify-end">
                  <button onClick={() => setAssignSource(upload)} className="text-accent hover:underline">Assign to session</button>
                  <button
                    onClick={() => {
                      const activityId = getActivityId(upload.id);
                      if (!activityId) {
                        setToast("Could not mark activity as extra");
                        return;
                      }

                      startTransition(() => {
                        void (async () => {
                          try {
                            await markActivityExtraAction({ activityId });
                            setLocalSessions((prev) =>
                              prev.map((session) => (session.id === upload.id ? { ...session, isUnplanned: true } : session))
                            );
                            setExtraActivityIds((prev) => [...prev, upload.id]);
                            setDismissedIssues((prev) => [...prev, getIssueId("unmatched_upload", upload.id), getIssueId("extra_workout", upload.id)]);
                            setToast("Marked as extra workout");
                            router.refresh();
                          } catch {
                            setToast("Could not mark activity as extra");
                          }
                        })();
                      });
                    }}
                    className="text-muted hover:text-foreground"
                  >
                    Mark extra
                  </button>
                  <button onClick={() => setDismissedIssues((prev) => [...prev, getIssueId("unmatched_upload", upload.id)])} className="text-muted hover:text-foreground">Dismiss</button>
                </div>
              </div>
            ))}
            {skippedToResolve.map((session) => (
              <div key={session.id} className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--signal-risk)/0.35)] bg-[hsl(var(--signal-risk)/0.08)] px-2.5 py-2 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                <p className="font-semibold">Skipped session</p>
                <p className="text-muted">{weekDays.find((day) => day.iso === session.date)?.weekday} {getSessionTitle(session)} · {session.duration} min</p>
                <p className="text-muted">Suggested move: {absorbDayLabel}</p>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 md:justify-end">
                  <button onClick={() => setMoveSource(session)} className="text-accent hover:underline">Move to another day</button>
                  <button
                    onClick={() => {
                      startTransition(() => {
                        void (async () => {
                          try {
                            await confirmSkippedAction({ sessionId: session.id });
                            setLocalSessions((prev) =>
                              prev.map((item) =>
                                item.id === session.id
                                  ? { ...item, notes: item.notes ? `${item.notes}\n[Skip confirmed ${new Date().toISOString().slice(0, 10)}]` : `[Skip confirmed ${new Date().toISOString().slice(0, 10)}]` }
                                  : item
                              )
                            );
                            setDismissedIssues((prev) => [...prev, getIssueId("skipped_reassign", session.id)]);
                            setToast("Skip confirmed");
                            router.refresh();
                          } catch {
                            setToast("Could not confirm skip");
                          }
                        })();
                      });
                    }}
                    className="text-muted hover:text-foreground"
                  >
                    Confirm skip
                  </button>
                </div>
              </div>
            ))}
            {movedItems.map((move) => {
              const session = localSessions.find((item) => item.id === move.sessionId);
              if (!session) return null;
              return (
                <div key={`move-${move.sessionId}`} className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--signal-load)/0.35)] bg-[hsl(var(--signal-load)/0.08)] px-2.5 py-2 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                  <p className="font-semibold">Moved session</p>
                  <p className="text-muted">{getSessionTitle(session)} moved from {weekDays.find((day) => day.iso === move.fromDate)?.weekday ?? move.fromDate}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 md:justify-end">
                    <button onClick={() => setDetailSession(session)} className="text-accent hover:underline">Review</button>
                    <button onClick={() => setDismissedIssues((prev) => [...prev, getIssueId("moved_session", move.sessionId)])} className="text-muted hover:text-foreground">Dismiss</button>
                  </div>
                </div>
              );
            })}
            {extraItems.map((item) => (
              <div key={`extra-${item.id}`} className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--signal-load)/0.35)] bg-[hsl(var(--signal-load)/0.08)] px-2.5 py-2 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">Extra workout logged</p>
                  <p className="text-muted">{getDisciplineMeta(item.sport).label} · {item.duration} min</p>
                </div>
                <button onClick={() => setDismissedIssues((prev) => [...prev, getIssueId("extra_workout", item.id)])} className="text-muted hover:text-foreground">Dismiss</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {localAdaptations.length > 0 ? (
        <section className="rounded-xl border border-[rgba(190,255,0,0.22)] bg-[rgba(190,255,0,0.04)] px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">Adaptation suggestions</p>
            <button
              type="button"
              onClick={() => {
                if (!weekStart) return;
                setLoadingAdaptations(true);
                void fetch("/api/coach/adaptation", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ weekStart })
                })
                  .then((res) => res.json())
                  .then((data: { adaptations?: PendingAdaptation[] }) => {
                    if (data.adaptations) setLocalAdaptations(data.adaptations.map((a) => ({ id: a.id ?? "", trigger_type: (a as { trigger?: { type: string } }).trigger?.type ?? "", options: (a as { options?: unknown }).options })));
                  })
                  .finally(() => setLoadingAdaptations(false));
              }}
              disabled={loadingAdaptations}
              className="text-[11px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)] disabled:opacity-40"
            >
              {loadingAdaptations ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <div className="space-y-2">
            {localAdaptations.map((adaptation) => {
              const options = Array.isArray(adaptation.options) ? adaptation.options as Array<{ id: string; label: string; description: string; projectedCompletionPct: number; keySessionImpact: string }> : [];
              const isExpanded = expandedAdaptationId === adaptation.id;
              return (
                <div key={adaptation.id} className="rounded-lg border border-[rgba(190,255,0,0.15)] bg-[rgba(190,255,0,0.03)] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[hsl(var(--text-primary))]">{adaptation.trigger_type.replace(/_/g, " ")}</p>
                      {options.length > 0 && !isExpanded ? (
                        <p className="mt-0.5 text-[11px] text-tertiary">{options.length} option{options.length > 1 ? "s" : ""} available</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setExpandedAdaptationId(isExpanded ? null : adaptation.id)}
                        className="text-[var(--color-accent)] hover:underline"
                      >
                        {isExpanded ? "Hide" : "View options"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          startTransition(() => {
                            void dismissAdaptationAction({ adaptationId: adaptation.id }).then(() => {
                              setLocalAdaptations((prev) => prev.filter((a) => a.id !== adaptation.id));
                            });
                          });
                        }}
                        className="text-tertiary hover:text-[hsl(var(--text-primary))]"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  {isExpanded && options.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {options.map((option) => (
                        <div key={option.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2.5">
                          <p className="text-xs font-medium">{option.label}</p>
                          <p className="mt-1 text-[11px] text-muted">{option.description}</p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-tertiary">~{option.projectedCompletionPct}% completion · Key sessions: {option.keySessionImpact}</span>
                            <button
                              type="button"
                              onClick={() => {
                                startTransition(() => {
                                  void acceptAdaptationAction({ adaptationId: adaptation.id }).then(() => {
                                    setLocalAdaptations((prev) => prev.filter((a) => a.id !== adaptation.id));
                                    setToast("Adaptation applied");
                                    router.refresh();
                                  });
                                });
                              }}
                              className="inline-flex min-h-[44px] items-center rounded-md bg-[rgba(190,255,0,0.15)] px-3 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[rgba(190,255,0,0.22)] lg:min-h-0 lg:px-2.5 lg:py-1"
                            >
                              Accept
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <article className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {weekDays.map((day) => {
          const daySessions = sessionsByDay[day.iso] ?? [];
          const metrics = dayMetrics.find((metric) => metric.day === day.iso);
          const isToday = day.iso === todayIso;
          const isFuture = day.iso > todayIso;
          const isPast = day.iso < todayIso;
          const needsAttention = Boolean(metrics && (isPast || isToday) && (metrics.skipped > 0 || (isPast && metrics.hasPlanned && !metrics.fullyDone)));
          const attentionReason = needsAttention && metrics
            ? metrics.skipped > 0
              ? `${metrics.skipped} session${metrics.skipped > 1 ? "s" : ""} skipped`
              : `${metrics.remainingPlanned} min not done`
            : null;
          const dayLabel = isToday
            ? getDayStateLabel("today")
            : needsAttention
              ? getDayStateLabel("needs_attention")
              : metrics?.fullyDone
                ? getDayStateLabel("complete")
                : metrics?.isRest
                  ? getDayStateLabel("rest_day")
                  : metrics?.availableDay
                    ? getDayStateLabel("available")
                    : metrics?.openCapacity
                      ? getDayStateLabel("open_capacity")
                      : isFuture && metrics?.hasPlanned
                        ? getDayStateLabel("planned")
                        : getDayStateLabel("planned");
          const dayTone = needsAttention ? "text-[hsl(var(--signal-risk))]" : isToday ? "text-accent" : "text-muted";

          // Day context note — single-line contextual hint per the spec
          const hasKeySession = daySessions.some((s) => s.is_key || s.role === "key");
          const allRecovery = daySessions.length > 0 && daySessions.every((s) => s.role === "recovery" || s.role === "optional");
          const dayContextNote = hasKeySession
            ? "Key session today"
            : daySessions.length === 0 && !needsAttention
              ? "Rest day"
              : allRecovery
                ? "Recovery day"
                : null;

          return (
            <section
              key={day.iso}
              className="surface-card h-full rounded-md border border-[rgba(255,255,255,0.06)] p-2"
              style={{
                background: isToday ? "rgba(190,255,0,0.04)" : "#111114",
                borderTopColor: isToday ? "#BEFF00" : "rgba(255,255,255,0.06)",
                borderTopWidth: isToday ? "2px" : "1px"
              }}
            >
              <div className="mb-2 min-h-[86px] border-b border-[hsl(var(--border))] pb-2">
                <p className="text-xs uppercase tracking-[0.14em] text-muted">{day.weekday}</p>
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{day.label}</p>
                  {isToday ? <span className="rounded-full bg-[hsl(var(--accent-performance)/0.2)] px-2 py-0.5 text-[11px] text-accent">Today</span> : null}
                </div>
                <p className="mt-1 text-xs text-muted">{metrics?.completedMin ?? 0}/{metrics?.plannedMin ?? 0} min</p>
                <p className={`mt-1 text-[11px] ${dayTone}`}>{dayLabel}</p>
                {dayContextNote ? (
                  <p className={`text-[11px] ${hasKeySession ? "font-medium text-accent" : "text-tertiary"}`}>{dayContextNote}</p>
                ) : null}
                {attentionReason ? <p className="text-[11px] text-muted">{attentionReason}</p> : null}
              </div>

              <div className="space-y-1.5 pt-0.5">
                {daySessions.length === 0 ? (
                  <button onClick={() => setQuickAddDate(day.iso)} className="w-full min-h-[92px] rounded-xl border border-dashed border-[hsl(var(--border)/0.85)] bg-[hsl(var(--surface-subtle)/0.25)] px-2 py-2.5 text-xs text-muted hover:border-[hsl(var(--accent-performance)/0.38)] hover:text-accent">
                    + Add session
                    <span className="mt-1 block text-[10px] text-tertiary">No items yet — add planned work or log extra activity.</span>
                  </button>
                ) : null}
                {daySessions.map((session) => {
                  const movedMeta = trackedMoves.find((move) => move.sessionId === session.id) ?? (getMovedFromDate(session.notes) ? { fromDate: getMovedFromDate(session.notes) } : null);
                  const state = getSessionState(session, trackedMoves, extraActivityIds);
                  const discipline = getDisciplineMeta(session.sport);
                  const disciplineTone = calendarDisciplineChipTone(session.sport);
                  const isNeedsAttentionCard = state === "skipped" || state === "unmatched_upload";
                  const cardBackground = isNeedsAttentionCard ? "rgba(255,90,40,0.04)" : "#18181C";
                  const leftBorderColor = isNeedsAttentionCard ? "#FF5A28" : calendarDisciplineBorderColor(session.sport);

                  const stateBadge =
                    state === "extra" ? null
                    : state === "unmatched_upload" ? (
                      <span className="rounded-full border border-[hsl(var(--accent-performance)/0.45)] bg-[hsl(var(--accent-performance)/0.14)] px-1.5 py-0.5 text-[10px] text-accent">Needs review</span>
                    ) : state === "moved" ? (
                      <span className="rounded-full border border-[hsl(var(--signal-load)/0.4)] px-1.5 py-0.5 text-[10px] text-[hsl(var(--signal-load))]">Moved{movedMeta ? ` · from ${weekDays.find((day) => day.iso === movedMeta.fromDate)?.weekday ?? movedMeta.fromDate}` : ""}</span>
                    ) : (
                      <SessionStatusChip status={session.status} compact />
                    );

                  const reviewableCompleted = session.displayType !== "completed_activity" && session.status === "completed";
                  const extraActivityId = state === "extra" ? getActivityId(session.id) : null;
                  const isClickable = reviewableCompleted || Boolean(extraActivityId);
                  const showCompletedFooter = state === "completed" || state === "assigned_from_upload" || state === "extra";
                  const cardTitle = state === "unmatched_upload" ? "Uploaded workout" : getSessionTitle(session);

                  return (
                    <article
                      key={session.id}
                      className={`rounded-[8px] border px-2 py-1.5 text-xs transition ${isClickable ? "cursor-pointer hover:border-[rgba(255,255,255,0.06)] focus-visible:border-[rgba(255,255,255,0.06)] focus-visible:outline-none" : ""}`}
                      style={{
                        background: cardBackground,
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderLeftWidth: "2px",
                        borderLeftColor: leftBorderColor
                      }}
                      onClick={() => {
                        if (reviewableCompleted) router.push(`/sessions/${session.id}`);
                        else if (extraActivityId) router.push(`/sessions/activity-${extraActivityId}`);
                      }}
                      onKeyDown={(event) => {
                        if (!isClickable) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (reviewableCompleted) router.push(`/sessions/${session.id}`);
                          else if (extraActivityId) router.push(`/sessions/activity-${extraActivityId}`);
                        }
                      }}
                      role={isClickable ? "link" : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: disciplineTone.bg, color: disciplineTone.text, borderColor: disciplineTone.border }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: disciplineTone.dot }} />
                            {discipline.label}
                          </span>
                          {(session.is_key || session.role?.toLowerCase() === "key") ? (
                            <span className="rounded-full border border-[rgba(255,180,60,0.3)] bg-[rgba(255,180,60,0.08)] px-1.5 py-0.5 text-[9px] font-medium text-[hsl(var(--warning))]">Key</span>
                          ) : null}
                        </div>
                        <SessionActionMenu
                          session={session}
                          state={state}
                          onMove={() => setMoveSource(session)}
                          onOpen={() => setDetailSession(session)}
                          onAssign={() => setAssignSource(session)}
                          onToggleSkip={() => {
                            startTransition(() => {
                              void (async () => {
                                try {
                                  if (session.status === "skipped") await clearSkippedAction({ sessionId: session.id });
                                  else await markSkippedAction({ sessionId: session.id });
                                  router.refresh();
                                } catch {
                                  setToast("Could not update skipped state");
                                }
                              })();
                            });
                          }}
                        />
                      </div>
                      <p className="mt-1 min-h-[1.5rem] font-medium leading-snug">{cardTitle}</p>
                      <p className="mt-0 text-[11px] text-muted">{session.duration} min{state === "unmatched_upload" ? ` · logged ${uploadDateFormatter.format(new Date(`${session.created_at}`))}` : ""}</p>
                      {isNeedsAttentionCard && !showCompletedFooter ? (
                        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[var(--color-warning)]">
                          <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-[var(--color-warning)]" />
                          <span>{state === "skipped" ? "Needs attention" : "Needs review"}</span>
                        </div>
                      ) : null}
                      {showCompletedFooter ? (
                        <div className="mt-1 flex items-center border-t border-[rgba(255,255,255,0.06)] pt-1 text-[10px]">
                          <span className="inline-flex w-full items-center justify-center gap-1 rounded-full border border-[rgba(52,211,153,0.25)] bg-[rgba(52,211,153,0.12)] px-[10px] py-[3px] text-[11px] font-medium text-success">
                            <span aria-hidden="true">✓</span>
                            {state === "extra" ? "Extra" : "Completed"}
                          </span>
                        </div>
                      ) : state === "unmatched_upload" ? (
                        <div className="mt-2 border-t border-[hsl(var(--accent-performance)/0.18)] pt-1.5">
                          <button
                            type="button"
                            onClick={() => setAssignSource(session)}
                            className="w-full rounded-md border border-[hsl(var(--accent-performance)/0.26)] bg-[hsl(var(--accent-performance)/0.05)] px-2 py-1 text-[11px] font-medium text-accent transition hover:bg-[hsl(var(--accent-performance)/0.1)]"
                          >
                            Review upload
                          </button>
                        </div>
                      ) : !isNeedsAttentionCard ? (
                        <div className="mt-1 flex items-center justify-end">{stateBadge}</div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </article>

      {quickAddDate ? <QuickAddModal initialDate={quickAddDate} weekDays={weekDays} onClose={() => setQuickAddDate(null)} /> : null}
      {moveSource ? <MoveModal session={moveSource} weekDays={weekDays} onClose={() => setMoveSource(null)} onMove={moveSession} /> : null}
      {assignSource ? (
        <AssignUploadModal
          upload={assignSource}
          weekDays={weekDays}
          candidateSessions={localSessions.filter((session) => session.displayType !== "completed_activity")}
          onClose={() => setAssignSource(null)}
          onAssigned={(selectedSessionId) => {
            setLocalSessions((prev) =>
              prev
                .filter((session) => session.id !== assignSource.id)
                .map((session) =>
                  session.id === selectedSessionId
                    ? {
                        ...session,
                        status: "completed",
                        linkedActivityCount: Math.max(session.linkedActivityCount ?? 0, 0) + 1
                      }
                    : session
                )
            );
            setDismissedIssues((prev) => prev.filter((issueId) => issueId !== getIssueId("unmatched_upload", assignSource.id)));
            setAssignSource(null);
            router.refresh();
            setToast("Upload assigned to session");
          }}
          onMarkedExtra={() => {
            const id = assignSource.id;
            setLocalSessions((prev) =>
              prev.map((session) => (session.id === id ? { ...session, isUnplanned: true } : session))
            );
            setExtraActivityIds((prev) => [...prev, id]);
            setDismissedIssues((prev) => [...prev, getIssueId("unmatched_upload", id), getIssueId("extra_workout", id)]);
            setAssignSource(null);
            router.refresh();
            setToast("Marked as extra workout");
          }}
          onError={() => setToast("Could not assign upload")}
        />
      ) : null}
      {detailSession ? <DetailsModal session={detailSession} onClose={() => setDetailSession(null)} /> : null}
      {toast ? <p className="text-xs text-accent">{toast}</p> : null}
      {isPending ? <p className="text-xs text-muted">Saving…</p> : null}
    </section>
  );
}

function QuickAddModal({ initialDate, weekDays, onClose }: { initialDate: string; weekDays: WeekDay[]; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ date: initialDate, sport: "run", type: "", duration: "45", notes: "" });

  return (
    <TaskModal onClose={onClose} title="Add session" description="Create a planned workout for this week.">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(() => {
            void (async () => {
              try {
                await quickAddSessionAction({
                  date: form.date,
                  sport: form.sport as "swim" | "bike" | "run" | "strength",
                  type: form.type,
                  duration: Number(form.duration),
                  notes: form.notes
                });
                onClose();
                router.refresh();
              } catch {
                // no-op
              }
            })();
          });
        }}
      >
        <select value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm">
          {weekDays.map((day) => <option key={day.iso} value={day.iso}>{day.weekday} · {day.label}</option>)}
        </select>
        <select value={form.sport} onChange={(e) => setForm((prev) => ({ ...prev, sport: e.target.value }))} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm">
          <option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option><option value="strength">Strength</option>
        </select>
        <input value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))} placeholder="Workout title (optional)" className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm" />
        <input value={form.duration} onChange={(e) => setForm((prev) => ({ ...prev, duration: e.target.value }))} type="number" min={1} max={300} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2 border-t border-[hsl(var(--border))] pt-3">
          <button type="button" onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button disabled={isPending} className="btn-primary px-2 py-1 text-xs">Save</button>
        </div>
      </form>
    </TaskModal>
  );
}

function MoveModal({ session, weekDays, onClose, onMove }: { session: CalendarSession; weekDays: WeekDay[]; onClose: () => void; onMove: (session: CalendarSession, newDate: string) => void }) {
  const [date, setDate] = useState(session.date);
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    <TaskSheet onClose={onClose} title={`Move ${getSessionTitle(session)}`} description="Move this planned session to a different day this week.">
      <div className="space-y-3">
        <select value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm">
          {weekDays.map((day) => (
            <option key={day.iso} value={day.iso}>
              {day.weekday} · {day.label}
              {day.iso >= todayIso ? " · open" : ""}
            </option>
          ))}
        </select>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] pt-3">
          <button type="button" onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button type="button" onClick={() => { onMove(session, date); onClose(); }} className="btn-primary px-2 py-1 text-xs">Move here</button>
        </div>
      </div>
    </TaskSheet>
  );
}

function AssignUploadModal({
  upload,
  weekDays,
  candidateSessions,
  onClose,
  onAssigned,
  onMarkedExtra,
  onError
}: {
  upload: CalendarSession;
  weekDays: WeekDay[];
  candidateSessions: CalendarSession[];
  onClose: () => void;
  onAssigned: (selectedSessionId: string) => void;
  onMarkedExtra: () => void;
  onError: () => void;
}) {
  const [selectedSessionId, setSelectedSessionId] = useState(() => getSuggestedSessionId(upload, candidateSessions));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSelectedSessionId(getSuggestedSessionId(upload, candidateSessions));
  }, [candidateSessions, upload]);

  return (
    <TaskSheet
      onClose={onClose}
      title="Upload needs review"
      description="Choose where this workout belongs in your calendar."
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-[hsl(var(--accent-performance)/0.3)] bg-[hsl(var(--accent-performance)/0.08)] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Uploaded workout</p>
          <p className="mt-1 text-sm font-semibold text-[hsl(var(--text-primary))]">
            {getDisciplineMeta(upload.sport).label} · {upload.duration} min
          </p>
          <p className="mt-1 text-xs text-muted">Logged {uploadDateFormatter.format(new Date(`${upload.created_at}`))}</p>
        </div>
        {candidateSessions.length === 0 ? (
          <p className="text-xs text-muted">No planned sessions in this week. Add or move a planned session first.</p>
        ) : (
          <select value={selectedSessionId} onChange={(e) => setSelectedSessionId(e.target.value)} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm">
            {candidateSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {(weekDays.find((day) => day.iso === session.date)?.weekday ?? session.date)} · {getSessionTitle(session)} · {session.duration} min
              </option>
            ))}
          </select>
        )}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
          <p className="text-xs font-medium text-[hsl(var(--text-primary))]">Mark as extra / unplanned</p>
          <p className="mt-1 text-xs text-muted">This workout wasn&apos;t part of your training plan.</p>
          <button
            type="button"
            disabled={isSaving}
            onClick={async () => {
              const activityId = getActivityId(upload.id);
              if (!activityId) { onError(); return; }
              setIsSaving(true);
              try {
                await markActivityExtraAction({ activityId });
                onMarkedExtra();
              } catch {
                onError();
              } finally {
                setIsSaving(false);
              }
            }}
            className="btn-secondary mt-2 px-2 py-1 text-xs"
          >
            Mark as extra
          </button>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] pt-3">
          <button type="button" onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button
            type="button"
            disabled={isSaving || !selectedSessionId || candidateSessions.length === 0}
            onClick={async () => {
              if (!selectedSessionId) return;
              setIsSaving(true);
              try {
                if (upload.source?.uploadId) {
                  // FIT/TCX upload — use the upload attach API
                  const response = await fetch(`/api/uploads/activities/${upload.source.uploadId}/attach`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ plannedSessionId: selectedSessionId, actor: "athlete", mode: "override" })
                  });
                  if (!response.ok) throw new Error("failed");
                } else {
                  // Strava import or other source — use the direct link action
                  const activityId = getActivityId(upload.id);
                  if (!activityId) throw new Error("no activity id");
                  const result = await linkActivityAction(activityId, selectedSessionId);
                  if (result.error) throw new Error(result.error);
                }
                onAssigned(selectedSessionId);
              } catch {
                onError();
              } finally {
                setIsSaving(false);
              }
            }}
            className="btn-primary px-2 py-1 text-xs"
          >
            Assign to session
          </button>
        </div>
      </div>
    </TaskSheet>
  );
}

function DetailsModal({ session, onClose }: { session: CalendarSession; onClose: () => void }) {
  const state = session.displayType === "completed_activity" ? "Extra workout" : session.status;
  const executionScoreRaw = session.executionResult?.executionScore ?? session.executionResult?.execution_score;
  const executionScore = typeof executionScoreRaw === "number" ? Math.round(executionScoreRaw) : null;
  const executionScoreBandRaw = session.executionResult?.executionScoreBand ?? session.executionResult?.execution_score_band;
  const executionScoreBand = typeof executionScoreBandRaw === "string" ? executionScoreBandRaw : null;
  const executionSummary = session.executionResult?.executionScoreSummary ?? session.executionResult?.summary;
  const nextAction = session.executionResult?.recommendedNextAction ?? session.executionResult?.recommended_next_action;
  const provisional = Boolean(session.executionResult?.executionScoreProvisional ?? session.executionResult?.execution_score_provisional);
  const [markingExtra, setMarkingExtra] = useState(false);
  const [markedExtra, setMarkedExtra] = useState(false);

  return (
    <TaskSheet
      onClose={onClose}
      title={getSessionTitle(session)}
      description={`${getDisciplineMeta(session.sport).label} · ${session.duration} min`}
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">Status: {state}</p>
        {executionScore !== null && executionScoreBand ? (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Execution Score</p>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${
                  executionScoreBand === "On target"
                    ? "border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))]"
                    : executionScoreBand === "Partial match"
                      ? "border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] text-[hsl(var(--warning))]"
                      : "border-[hsl(var(--danger)/0.3)] bg-[hsl(var(--danger)/0.08)] text-[hsl(var(--danger))]"
                }`}
              >
                {executionScoreBand}
              </span>
            </div>
            <p className="mt-1 text-base font-semibold text-[hsl(var(--text-primary))]">{executionScore} · {executionScoreBand}{provisional ? " · Provisional" : ""}</p>
            {(executionSummary || nextAction) ? (
              <div className="mt-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-2.5 py-2">
                {executionSummary ? <p className="text-xs text-muted">{executionSummary}</p> : null}
                {nextAction ? <p className="mt-1 text-xs font-medium text-[hsl(var(--text-primary))]">Next step: {nextAction}</p> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <p className="text-xs text-muted">Detailed execution scoring is still provisional. Use schedule status and session notes for now.</p>
          </div>
        )}
        {session.notes ? <p className="rounded-lg bg-[hsl(var(--surface-subtle))] p-2 text-xs text-muted">{session.notes}</p> : null}
        {session.displayType === "completed_activity" ? (
          <div className="pt-1">
            {markedExtra ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(52,211,153,0.25)] bg-[rgba(52,211,153,0.12)] px-3 py-1.5 text-xs font-medium text-success">
                <span aria-hidden="true">✓</span> Marked as extra
              </span>
            ) : (
              <button
                type="button"
                disabled={markingExtra}
                onClick={async () => {
                  const activityId = getActivityId(session.id);
                  if (!activityId) { setMarkingExtra(false); return; }
                  setMarkingExtra(true);
                  try {
                    await markActivityExtraAction({ activityId });
                    setMarkedExtra(true);
                  } catch {
                    setMarkingExtra(false);
                  }
                }}
                className="rounded-full border border-[rgba(255,255,255,0.16)] bg-transparent px-3 py-1.5 text-xs text-muted transition hover:border-[rgba(255,255,255,0.3)] hover:text-foreground disabled:opacity-50"
              >
                {markingExtra ? "Marking…" : "Mark as extra"}
              </button>
            )}
          </div>
        ) : null}
        <div className="sticky bottom-0 pt-2 text-right">
          <button onClick={onClose} className="btn-secondary px-3 text-xs">Close</button>
        </div>
      </div>
    </TaskSheet>
  );
}

function TaskOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-black/55 backdrop-blur-[2px]">
      <button type="button" aria-label="Close overlay" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} />
      {children}
    </div>
  );
}

function TaskSheet({ children, title, description, onClose }: { children: React.ReactNode; title: string; description?: string; onClose: () => void }) {
  return (
    <TaskOverlay onClose={onClose}>
      <aside className="relative ml-auto flex min-h-screen w-full flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl sm:max-w-xl">
        <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle)/0.22)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Calendar task</p>
              <p className="mt-1 text-base font-semibold">{title}</p>
              {description ? (
                <p className="mt-2 max-w-md rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--bg-elevated)/0.82)] px-3 py-2 text-xs text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] rounded-md border border-[hsl(var(--border))] px-3 text-xs text-muted hover:text-foreground lg:min-h-0 lg:min-w-0 lg:px-2 lg:py-1">Close</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </aside>
    </TaskOverlay>
  );
}

function TaskModal({ children, title, description, onClose }: { children: React.ReactNode; title: string; description?: string; onClose: () => void }) {
  return (
    <TaskOverlay onClose={onClose}>
      <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
        <section className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-2xl">
          <header className="mb-4 border-b border-[hsl(var(--border))] pb-3">
            <p className="text-base font-semibold">{title}</p>
            {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
          </header>
          {children}
        </section>
      </div>
    </TaskOverlay>
  );
}
