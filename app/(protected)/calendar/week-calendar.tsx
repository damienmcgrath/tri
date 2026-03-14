"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AdaptationDecisionPanel, AdaptationStrip } from "@/components/training/calendar-adaptation";
import { StatusPill } from "@/components/training/status-pill";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getSessionDisplayName } from "@/lib/training/session";
import { buildWeekStateSummary } from "@/lib/training/week-state";
import { SESSION_LIFECYCLE_META, type SessionLifecycleState } from "@/lib/training/semantics";
import { clearSkippedAction, markActivityExtraAction, markSkippedAction, moveSessionAction, quickAddSessionAction } from "@/app/(protected)/calendar/actions";

type SessionStatus = SessionLifecycleState;
type FilterStatus = "all" | SessionStatus | "extra";
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
type AdaptationDecisionState = "pending_decision" | "resolved";
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
  return sessionId.startsWith("activity:") ? sessionId.replace("activity:", "") : null;
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
    return "completed" as const;
  }
  return session.status;
}

function getIssueId(type: AdaptationIssueType, id: string) {
  return `${type}:${id}`;
}

function getAdaptationDecisionKey(weekStart: string) {
  return `calendar-adaptation:${weekStart}`;
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
  state: "planned" | "today" | "completed" | "skipped" | "missed" | "extra";
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
        className="rounded-md border border-[hsl(var(--border))] px-1.5 py-0.5 text-[11px] text-muted hover:text-foreground"
        aria-label="Card actions"
        onClick={() => setOpen((value) => !value)}
      >
        •••
      </button>
      {open ? (
        <div className="absolute right-0 top-7 z-20 w-36 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-1 text-[11px] shadow-lg">
          {session.displayType === "completed_activity" && activityId ? (
            <Link className="block rounded px-2 py-1 hover:bg-[hsl(var(--surface-subtle))]" href={`/sessions/activity/${activityId}`}>
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
          {session.displayType === "completed_activity" ? (
            <button className="block w-full rounded px-2 py-1 text-left hover:bg-[hsl(var(--surface-subtle))]" onClick={() => { onAssign(); setOpen(false); }}>
              Assign to session
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WeekCalendar({
  weekDays,
  sessions,
  completedCount,
  plannedRemainingCount,
  skippedCount,
  extraSessionCount
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
  const [extraActivityIds, setExtraActivityIds] = useState<string[]>([]);
  const [recentMoves, setRecentMoves] = useState<RecentMove[]>([]);
  const [isAdaptationOpen, setIsAdaptationOpen] = useState(false);
  const [adaptationDecision, setAdaptationDecision] = useState<AdaptationDecisionState | null>(null);
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
  const todayIso = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const persisted = window.sessionStorage.getItem(getAdaptationDecisionKey(activeWeekStart));
    if (persisted === "pending_decision" || persisted === "resolved") {
      setAdaptationDecision(persisted);
      return;
    }
    setAdaptationDecision(null);
  }, [activeWeekStart]);

  const withWeek = (targetWeekStart: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (targetWeekStart === currentWeekStart) params.delete("weekStart");
    else params.set("weekStart", targetWeekStart);
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  };

  const weekState = useMemo(
    () =>
      buildWeekStateSummary({
        sessions: localSessions
          .map((session) => {
            const state = getSessionState(session, trackedMoves, extraActivityIds);
            if (session.displayType === "completed_activity" && state !== "extra") {
              return null;
            }
            const storedStatus: "planned" | "completed" | "skipped" =
              state === "completed" || state === "skipped"
                ? state
                : "planned";

            return {
              id: session.id,
              date: session.date,
              title: getSessionTitle(session),
              sport: session.sport,
              durationMinutes: session.duration,
              storedStatus,
              isKey: Boolean(session.is_key),
              isProtected: Boolean(session.is_key),
              isFlexible: session.role === "recovery" || session.role === "optional",
              isOptional: session.role === "optional",
              intentCategory: session.intentCategory ?? null,
              target: null,
              executionResult: session.executionResult ?? null,
              isExtra: state === "extra"
            };
          })
          .filter((session): session is NonNullable<typeof session> => Boolean(session)),
        todayIso
      }),
    [extraActivityIds, localSessions, todayIso, trackedMoves]
  );

  const derivedLifecycleById = useMemo(
    () => new Map(weekState.sessions.map((session) => [session.id, session.lifecycle])),
    [weekState.sessions]
  );

  const effectiveAdaptationState =
    weekState.adaptation === null
      ? "none"
      : adaptationDecision === "resolved"
        ? "resolved"
        : adaptationDecision === "pending_decision"
          ? "pending_decision"
          : weekState.adaptation.state;

  const filteredSessions = useMemo(() => {
    return localSessions.filter((session) => {
      const sportMatch = sportFilter === "all" || session.sport === sportFilter;
      const state = derivedLifecycleById.get(session.id) ?? getSessionState(session, trackedMoves, extraActivityIds);
      const statusMatch = statusFilter === "all" || state === statusFilter;
      return sportMatch && statusMatch;
    });
  }, [derivedLifecycleById, extraActivityIds, localSessions, sportFilter, statusFilter, trackedMoves]);

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

  function persistAdaptationDecision(nextDecision: AdaptationDecisionState) {
    setAdaptationDecision(nextDecision);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(getAdaptationDecisionKey(activeWeekStart), nextDecision);
    }
  }

  function resolveAdaptation() {
    persistAdaptationDecision("resolved");
    setIsAdaptationOpen(false);
  }

  function deferAdaptation() {
    persistAdaptationDecision("pending_decision");
    setIsAdaptationOpen(false);
  }

  function applyAdaptation() {
    const recommendation = weekState.adaptation;
    if (!recommendation) return;

    if (recommendation.operation === "move_session") {
      const targetSession = localSessions.find(
        (session) => recommendation.affectedSessionIds.includes(session.id) && session.displayType !== "completed_activity"
      );
      if (targetSession) {
        setMoveSource(targetSession);
        setIsAdaptationOpen(false);
        return;
      }
    }

    if (recommendation.operation === "drop_session") {
      const targetSession = localSessions.find(
        (session) =>
          recommendation.affectedSessionIds.includes(session.id) &&
          session.displayType !== "completed_activity" &&
          session.status !== "completed" &&
          session.status !== "skipped"
      );

      if (!targetSession) {
        resolveAdaptation();
        return;
      }

      startTransition(() => {
        void (async () => {
          try {
            await markSkippedAction({ sessionId: targetSession.id });
            setLocalSessions((prev) =>
              prev.map((session) =>
                session.id === targetSession.id
                  ? {
                      ...session,
                      status: "skipped",
                      notes: session.notes ? `${session.notes}\n[Skipped ${todayIso}]` : `[Skipped ${todayIso}]`
                    }
                  : session
              )
            );
            resolveAdaptation();
            setToast("Week adjustment applied");
            router.refresh();
          } catch {
            setToast("Could not apply recommendation");
          }
        })();
      });
      return;
    }

    resolveAdaptation();
    setToast("Week adjustment saved");
  }

  return (
    <section className="space-y-3">
      <header className="surface-subtle flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <p className="text-sm font-semibold">{dayFormatter.format(new Date(`${weekDays[0].iso}T00:00:00.000Z`))} – {dayFormatter.format(new Date(`${weekDays[6].iso}T00:00:00.000Z`))}</p>
          <Link href={withWeek(addDays(activeWeekStart, -7))} className="btn-secondary px-2 py-1 text-xs">Prev</Link>
          <Link href={withWeek(currentWeekStart)} className="btn-secondary px-2 py-1 text-xs">This week</Link>
          <Link href={withWeek(addDays(activeWeekStart, 7))} className="btn-secondary px-2 py-1 text-xs">Next</Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="sr-only" htmlFor="sport-filter">Discipline filter</label>
          <select id="sport-filter" value={sportFilter} onChange={(e) => setSportFilter(e.target.value as SportFilter)} className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1">
            <option value="all">All disciplines</option><option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option><option value="strength">Strength</option>
          </select>
          <label className="sr-only" htmlFor="status-filter">Status filter</label>
          <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FilterStatus)} className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1">
            <option value="all">All statuses</option><option value="today">Today</option><option value="planned">Planned</option><option value="completed">Completed</option><option value="skipped">Skipped</option><option value="missed">Missed</option><option value="extra">Extra</option>
          </select>
          <button onClick={() => setQuickAddDate(weekDays[0]?.iso)} className="btn-primary px-2 py-1 text-xs">Add session</button>
          <span className="rounded-full border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--surface-subtle)/0.45)] px-2 py-0.5 text-[11px] text-muted">
            {weekState.counts.completed} completed · {weekState.counts.remaining} remaining · {weekState.counts.missed} missed · {weekState.counts.extra} extra
          </span>
        </div>
      </header>

      {weekState.adaptation ? (
        <>
          <AdaptationStrip
            state={effectiveAdaptationState}
            whatChanged={weekState.adaptation.whatChanged}
            whyItMatters={weekState.adaptation.whyItMatters}
            recommendation={weekState.adaptation.recommendation}
            onReview={() => setIsAdaptationOpen((current) => !current)}
            secondaryAction={
              effectiveAdaptationState === "pending_decision" ? (
                <p className="text-xs text-muted">Decision saved for later. Come back after you review the rest of the week.</p>
              ) : effectiveAdaptationState === "resolved" ? (
                <p className="text-xs text-muted">Decision logged. The rest of the week can stay focused on execution.</p>
              ) : null
            }
          />
          {isAdaptationOpen ? (
            <section className="surface p-5">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Current week state</p>
                    <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">
                      {weekState.counts.completed} completed · {weekState.counts.remaining} remaining · {weekState.counts.missed} missed · {weekState.counts.extra} extra
                    </p>
                    <p className="mt-2 text-sm text-muted">{weekState.focusStatement}</p>
                  </div>
                  <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] p-4">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Affected sessions</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {weekState.sessions
                        .filter((session) => weekState.adaptation?.affectedSessionIds.includes(session.id))
                        .map((session) => {
                          const meta = SESSION_LIFECYCLE_META[session.lifecycle];
                          return (
                            <div key={session.id} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2">
                              <p className="text-sm font-medium text-[hsl(var(--text-primary))]">{session.title}</p>
                              <div className="mt-2">
                                <StatusPill label={meta.label} tone={meta.tone} icon={meta.icon} compact />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
                <AdaptationDecisionPanel
                  title={weekState.adaptation.whatChanged}
                  summary={weekState.adaptation.recommendation}
                  rationale={weekState.adaptation.rationale}
                  onApply={applyAdaptation}
                  onKeep={resolveAdaptation}
                  onLater={deferAdaptation}
                  applyLabel={weekState.adaptation.primaryLabel}
                />
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {unmatchedUploads.length > 0 ? (
        <section className="surface-subtle p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Uploads needing assignment</p>
              <p className="mt-1 text-sm text-muted">These workouts are secondary to week repair. Assign them once the week decision is clear.</p>
            </div>
            <p className="text-xs text-muted">{unmatchedUploads.length} open</p>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {unmatchedUploads.map((upload) => (
              <div key={upload.id} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-3">
                <p className="text-sm font-semibold text-[hsl(var(--text-primary))]">Uploaded workout</p>
                <p className="mt-1 text-xs text-muted">{getDisciplineMeta(upload.sport).label} · {upload.duration} min · logged {uploadDateFormatter.format(new Date(`${upload.created_at}`))}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {upload.source?.uploadId ? (
                    <button onClick={() => setAssignSource(upload)} className="btn-secondary px-3 py-1.5 text-xs">Assign to session</button>
                  ) : null}
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
                            setDismissedIssues((prev) => [...prev, getIssueId("unmatched_upload", upload.id)]);
                            setToast("Marked as extra workout");
                            router.refresh();
                          } catch {
                            setToast("Could not mark activity as extra");
                          }
                        })();
                      });
                    }}
                    className="btn-secondary px-3 py-1.5 text-xs"
                  >
                    Mark extra
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <article className="grid gap-2 lg:grid-cols-7">
        {weekDays.map((day) => {
          const daySessions = sessionsByDay[day.iso] ?? [];
          const metrics = dayMetrics.find((metric) => metric.day === day.iso);
          const isToday = day.iso === todayIso;
          const plannedDaySessions = weekState.sessions.filter((session) => session.date === day.iso && !session.isExtra);
          const dayHasMissed = plannedDaySessions.some((session) => session.lifecycle === "missed");
          const dayHasToday = plannedDaySessions.some((session) => session.lifecycle === "today");
          const dayAllCompleted = plannedDaySessions.length > 0 && plannedDaySessions.every((session) => session.lifecycle === "completed");
          const dayAllSkipped = plannedDaySessions.length > 0 && plannedDaySessions.every((session) => session.lifecycle === "skipped");
          const dayLabel = dayHasToday
            ? "Today"
            : dayHasMissed
              ? "Missed"
              : dayAllCompleted
                ? "Completed"
                : dayAllSkipped
                  ? "Skipped"
                  : metrics?.availableDay || plannedDaySessions.length === 0
                    ? "Recovery"
                    : "Planned";
          const dayTone = dayHasMissed
            ? "text-[hsl(var(--signal-risk))]"
            : dayHasToday
              ? "text-accent"
              : dayAllCompleted
                ? "text-[hsl(var(--success))]"
                : "text-muted";

          return (
            <section key={day.iso} className="surface-card h-full rounded-2xl border border-[hsl(var(--border))] p-2">
              <div className="mb-2 min-h-[86px] border-b border-[hsl(var(--border))] pb-2">
                <p className="text-xs uppercase tracking-[0.14em] text-muted">{day.weekday}</p>
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{day.label}</p>
                  {isToday ? <span className="rounded-full bg-[hsl(var(--accent-performance)/0.2)] px-2 py-0.5 text-[10px] text-accent">Today</span> : null}
                </div>
                <p className="mt-1 text-xs text-muted">{metrics?.completedMin ?? 0}/{metrics?.plannedMin ?? 0} min</p>
                <p className={`mt-1 text-[11px] ${dayTone}`}>{dayLabel}</p>
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
                  const state = derivedLifecycleById.get(session.id) ?? getSessionState(session, trackedMoves, extraActivityIds);
                  const discipline = getDisciplineMeta(session.sport);
                  const disciplineTone = calendarDisciplineChipTone(session.sport);
                  const toneClass =
                    state === "completed"
                      ? "border-[hsl(var(--signal-ready)/0.38)] bg-[hsl(var(--signal-ready)/0.08)]"
                      : state === "skipped"
                        ? "border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)]"
                        : state === "missed"
                          ? "border-[hsl(var(--signal-risk)/0.45)] bg-[hsl(var(--signal-risk)/0.08)]"
                          : state === "today"
                            ? "border-[hsl(var(--accent-performance)/0.45)] bg-[hsl(var(--accent-performance)/0.10)]"
                        : state === "extra"
                          ? "border-[hsl(var(--accent-performance)/0.45)] bg-[hsl(var(--accent-performance)/0.10)]"
                          : session.displayType === "completed_activity"
                            ? "border-[hsl(var(--accent-performance)/0.42)] bg-[linear-gradient(180deg,hsl(var(--accent-performance)/0.12),hsl(var(--accent-performance)/0.05))] shadow-[inset_0_1px_0_hsl(var(--accent-performance)/0.12)]"
                            : "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))]";

                  const reviewableCompleted = session.displayType !== "completed_activity" && session.status === "completed";
                  const stateMeta = SESSION_LIFECYCLE_META[state];
                  const needsAssignment = session.displayType === "completed_activity" && !session.isUnplanned && !extraActivityIds.includes(session.id);
                  const cardTitle = needsAssignment ? "Uploaded workout" : getSessionTitle(session);

                  return (
                    <article
                      key={session.id}
                      className={`rounded-xl border px-2 py-1.5 text-xs transition ${toneClass} ${reviewableCompleted ? "cursor-pointer hover:-translate-y-[1px] hover:border-[hsl(var(--signal-ready)/0.54)] hover:shadow-[0_8px_22px_-16px_hsl(var(--signal-ready)/0.65)] focus-visible:-translate-y-[1px] focus-visible:border-[hsl(var(--signal-ready)/0.54)] focus-visible:shadow-[0_8px_22px_-16px_hsl(var(--signal-ready)/0.65)] focus-visible:outline-none" : ""}`}
                      onClick={() => {
                        if (reviewableCompleted) router.push(`/sessions/${session.id}`);
                      }}
                      onKeyDown={(event) => {
                        if (!reviewableCompleted) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/sessions/${session.id}`);
                        }
                      }}
                      role={reviewableCompleted ? "link" : undefined}
                      tabIndex={reviewableCompleted ? 0 : undefined}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: disciplineTone.bg, color: disciplineTone.text, borderColor: disciplineTone.border }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: disciplineTone.dot }} />
                          {discipline.label}
                        </span>
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
                                  if (session.status === "skipped") {
                                    await clearSkippedAction({ sessionId: session.id });
                                    setLocalSessions((prev) => prev.map((item) => item.id === session.id ? { ...item, status: "planned" } : item));
                                  } else {
                                    await markSkippedAction({ sessionId: session.id });
                                    setLocalSessions((prev) => prev.map((item) => item.id === session.id ? { ...item, status: "skipped" } : item));
                                  }
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
                      <p className="mt-0 text-[11px] text-muted">{session.duration} min{needsAssignment ? ` · logged ${uploadDateFormatter.format(new Date(`${session.created_at}`))}` : ""}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[hsl(var(--border)/0.7)] pt-1.5">
                        <StatusPill label={stateMeta.label} tone={stateMeta.tone} icon={stateMeta.icon} compact />
                        {needsAssignment ? <StatusPill label="Needs review" tone="info" compact /> : null}
                        {movedMeta ? (
                          <StatusPill
                            label={`Moved${movedMeta.fromDate ? ` from ${weekDays.find((day) => day.iso === movedMeta.fromDate)?.weekday ?? movedMeta.fromDate}` : ""}`}
                            tone="info"
                            compact
                          />
                        ) : null}
                        {session.is_key ? <StatusPill label="Key session" tone="attention" compact /> : null}
                      </div>
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
  onError
}: {
  upload: CalendarSession;
  weekDays: WeekDay[];
  candidateSessions: CalendarSession[];
  onClose: () => void;
  onAssigned: (selectedSessionId: string) => void;
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
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] pt-3">
          <button type="button" onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button
            type="button"
            disabled={isSaving || !selectedSessionId || !upload.source?.uploadId || candidateSessions.length === 0}
            onClick={async () => {
              if (!upload.source?.uploadId || !selectedSessionId) return;
              setIsSaving(true);
              try {
                const response = await fetch(`/api/uploads/activities/${upload.source.uploadId}/attach`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ plannedSessionId: selectedSessionId, actor: "athlete", mode: "override" })
                });

                if (!response.ok) throw new Error("failed");
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
        <div className="sticky bottom-0 pt-2 text-right">
          <button onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Close</button>
        </div>
      </div>
    </TaskSheet>
  );
}

function TaskOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/55 backdrop-blur-[2px]">
      <button type="button" aria-label="Close overlay" className="absolute inset-0 min-h-full w-full cursor-default" onClick={onClose} />
      {children}
    </div>
  );
}

function TaskSheet({ children, title, description, onClose }: { children: React.ReactNode; title: string; description?: string; onClose: () => void }) {
  return (
    <TaskOverlay onClose={onClose}>
      <aside className="relative ml-auto flex min-h-screen w-full max-w-xl flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl">
        <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle)/0.22)] px-5 py-4">
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
            <button type="button" onClick={onClose} className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs text-muted hover:text-foreground">Close</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
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
