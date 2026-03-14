"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SessionStatusChip } from "@/lib/ui/status-chip";
import { getSessionDisplayName } from "@/lib/training/session";
import { getDayStateLabel, type SessionLifecycleState } from "@/lib/training/semantics";
import { clearSkippedAction, confirmSkippedAction, markActivityExtraAction, markSkippedAction, moveSessionAction, quickAddSessionAction } from "@/app/(protected)/calendar/actions";
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
    swim: { bg: "rgba(74,126,150,0.18)", text: "#D2EAF3", dot: "#8BC1D4", border: "rgba(100,151,173,0.28)" },
    bike: { bg: "rgba(84,115,88,0.18)", text: "#D5E4D7", dot: "#97B79B", border: "rgba(108,138,111,0.28)" },
    run: { bg: "rgba(138,96,68,0.2)", text: "#E9D6C8", dot: "#C49673", border: "rgba(161,114,84,0.3)" },
    strength: { bg: "rgba(112,102,76,0.19)", text: "#E5DBC5", dot: "#C7B184", border: "rgba(137,124,94,0.28)" },
    other: { bg: "rgba(94,102,112,0.18)", text: "#DCE2EA", dot: "#B5BEC9", border: "rgba(117,126,137,0.28)" }
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
        className="calendar-card-action px-1.5 py-0.5 text-[11px]"
        aria-label="Card actions"
        onClick={() => setOpen((value) => !value)}
      >
        •••
      </button>
      {open ? (
        <div className="calendar-card-menu absolute right-0 top-7 z-20 w-36 p-1 text-[11px]">
          {session.displayType === "completed_activity" && activityId ? (
            <Link className="calendar-card-menu-item" href={`/sessions/activity/${activityId}`}>
              Open details
            </Link>
          ) : session.displayType !== "completed_activity" && session.status === "completed" ? (
            <Link className="calendar-card-menu-item" href={`/sessions/${session.id}`}>
              Open details
            </Link>
          ) : (
            <button className="calendar-card-menu-item" onClick={() => { onOpen(); setOpen(false); }}>
              Open details
            </button>
          )}
          {session.displayType !== "completed_activity" ? (
            <button className="calendar-card-menu-item" onClick={() => { onMove(); setOpen(false); }}>
              Move
            </button>
          ) : null}
          {session.displayType !== "completed_activity" ? (
            <button className="calendar-card-menu-item" onClick={() => { onToggleSkip(); setOpen(false); }}>
              {state === "skipped" ? "Mark planned" : "Mark skipped"}
            </button>
          ) : null}
          {session.displayType === "completed_activity" ? (
            <button className="calendar-card-menu-item" onClick={() => { onAssign(); setOpen(false); }}>
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
    <section className="performance-page space-y-3">
      <header className="calendar-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <p className="calendar-toolbar-range">{dayFormatter.format(new Date(`${weekDays[0].iso}T00:00:00.000Z`))} – {dayFormatter.format(new Date(`${weekDays[6].iso}T00:00:00.000Z`))}</p>
          <Link href={withWeek(addDays(activeWeekStart, -7))} className="btn-secondary performance-btn-secondary px-2 py-1 text-xs">Prev</Link>
          <Link href={withWeek(currentWeekStart)} className="btn-secondary performance-btn-secondary px-2 py-1 text-xs">This week</Link>
          <Link href={withWeek(addDays(activeWeekStart, 7))} className="btn-secondary performance-btn-secondary px-2 py-1 text-xs">Next</Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="sr-only" htmlFor="sport-filter">Discipline filter</label>
          <select id="sport-filter" value={sportFilter} onChange={(e) => setSportFilter(e.target.value as SportFilter)} className="calendar-control px-2 py-1">
            <option value="all">All disciplines</option><option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option><option value="strength">Strength</option>
          </select>
          <label className="sr-only" htmlFor="status-filter">Status filter</label>
          <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FilterStatus)} className="calendar-control px-2 py-1">
            <option value="all">All statuses</option><option value="planned">Planned</option><option value="completed">Completed</option><option value="skipped">Skipped</option><option value="moved">Moved</option><option value="extra">Extra</option>
          </select>
          <button onClick={() => setQuickAddDate(weekDays[0]?.iso)} className="btn-primary performance-btn-primary px-2 py-1 text-xs">Add session</button>
          <span className="calendar-toolbar-summary">{completedCount} done · {plannedRemainingCount} remaining · {skippedCount} skipped · {extraSessionCount} extra</span>
        </div>
      </header>

      {hasAdaptation ? (
        <section className="calendar-attention-banner px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="performance-eyebrow text-[hsl(var(--performance-attention))]">Needs attention</p>
            <p className="calendar-attention-count">
              {unmatchedUploads.length + skippedToResolve.length + movedItems.length + extraItems.length} open
            </p>
          </div>
          <div className="flex flex-col gap-1.5 text-xs">
            {unmatchedUploads.map((upload) => (
              <div key={upload.id} className="calendar-alert-item flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between" data-tone="upload">
                <div className="min-w-0">
                  <p className="font-semibold text-[hsl(var(--text-primary))]">Upload needs review</p>
                  <p className="text-[11px] text-muted">{getDisciplineMeta(upload.sport).label} · {upload.duration} min · logged {uploadDateFormatter.format(new Date(`${upload.created_at}`))}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] md:justify-end">
                  {upload.source?.uploadId ? (
                    <button onClick={() => setAssignSource(upload)} className="calendar-inline-action">Assign to session</button>
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
                    className="calendar-inline-action calendar-inline-action--quiet"
                  >
                    Mark extra
                  </button>
                  <button onClick={() => setDismissedIssues((prev) => [...prev, getIssueId("unmatched_upload", upload.id)])} className="calendar-inline-action calendar-inline-action--quiet">Dismiss</button>
                </div>
              </div>
            ))}
            {skippedToResolve.map((session) => (
              <div key={session.id} className="calendar-alert-item flex flex-col gap-2 md:flex-row md:items-center md:justify-between" data-tone="skip">
                <div className="min-w-0">
                  <p className="font-semibold">Skipped session</p>
                  <p className="text-muted">{weekDays.find((day) => day.iso === session.date)?.weekday} {getSessionTitle(session)} · {session.duration} min</p>
                  <p className="text-muted">Suggested move: {absorbDayLabel}</p>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 md:justify-end">
                  <button onClick={() => setMoveSource(session)} className="calendar-inline-action">Move to another day</button>
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
                    className="calendar-inline-action calendar-inline-action--quiet"
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
                <div key={`move-${move.sessionId}`} className="calendar-alert-item flex flex-col gap-2 md:flex-row md:items-center md:justify-between" data-tone="move">
                  <div className="min-w-0">
                    <p className="font-semibold">Moved session</p>
                    <p className="text-muted">{getSessionTitle(session)} moved from {weekDays.find((day) => day.iso === move.fromDate)?.weekday ?? move.fromDate}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 md:justify-end">
                    <button onClick={() => setDetailSession(session)} className="calendar-inline-action">Review</button>
                    <button onClick={() => setDismissedIssues((prev) => [...prev, getIssueId("moved_session", move.sessionId)])} className="calendar-inline-action calendar-inline-action--quiet">Dismiss</button>
                  </div>
                </div>
              );
            })}
            {extraItems.map((item) => (
              <div key={`extra-${item.id}`} className="calendar-alert-item flex flex-col gap-2 md:flex-row md:items-center md:justify-between" data-tone="extra">
                <div className="min-w-0">
                  <p className="font-semibold">Extra workout logged</p>
                  <p className="text-muted">{getDisciplineMeta(item.sport).label} · {item.duration} min</p>
                </div>
                <button onClick={() => setDismissedIssues((prev) => [...prev, getIssueId("extra_workout", item.id)])} className="calendar-inline-action calendar-inline-action--quiet">Dismiss</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <article className="calendar-day-grid grid lg:grid-cols-7">
        {weekDays.map((day) => {
          const daySessions = sessionsByDay[day.iso] ?? [];
          const metrics = dayMetrics.find((metric) => metric.day === day.iso);
          const isToday = day.iso === todayIso;
          const isFuture = day.iso > todayIso;
          const isPast = day.iso < todayIso;
          const needsAttention = Boolean(metrics && (metrics.skipped > 0 || (isPast && metrics.hasPlanned && !metrics.fullyDone)));
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
          const dayTone = needsAttention ? "attention" : isToday ? "today" : "neutral";

          return (
            <section key={day.iso} className="calendar-day-column h-full p-2" data-today={isToday ? "true" : undefined} data-attention={needsAttention ? "true" : undefined}>
              <div className="calendar-day-header mb-2">
                <p className="calendar-day-weekday">{day.weekday}</p>
                <div className="flex items-center justify-between">
                  <p className="calendar-day-date">{day.label}</p>
                  {isToday ? <span className="performance-chip calendar-day-today-chip" data-tone="today">Today</span> : null}
                </div>
                <p className="calendar-day-minutes">{metrics?.completedMin ?? 0}/{metrics?.plannedMin ?? 0} min</p>
                <p className="calendar-day-state" data-tone={dayTone}>{dayLabel}</p>
              </div>

              <div className="space-y-1.5 pt-0.5">
                {daySessions.length === 0 ? (
                  <button onClick={() => setQuickAddDate(day.iso)} className="calendar-empty-slot px-2 py-2.5 text-xs">
                    + Add session
                    <span className="mt-1 block text-[10px] text-tertiary">No items yet — add planned work or log extra activity.</span>
                  </button>
                ) : null}
                {daySessions.map((session) => {
                  const movedMeta = trackedMoves.find((move) => move.sessionId === session.id) ?? (getMovedFromDate(session.notes) ? { fromDate: getMovedFromDate(session.notes) } : null);
                  const state = getSessionState(session, trackedMoves, extraActivityIds);
                  const discipline = getDisciplineMeta(session.sport);
                  const disciplineTone = calendarDisciplineChipTone(session.sport);

                  const stateBadge =
                    state === "extra" ? (
                      <span className="calendar-state-pill" data-tone="extra">Extra</span>
                    ) : state === "unmatched_upload" ? (
                      <span className="calendar-state-pill" data-tone="review">Needs review</span>
                    ) : state === "moved" ? (
                      <span className="calendar-state-pill" data-tone="moved">Moved{movedMeta ? ` · from ${weekDays.find((day) => day.iso === movedMeta.fromDate)?.weekday ?? movedMeta.fromDate}` : ""}</span>
                    ) : (
                      <SessionStatusChip status={session.status} compact className="calendar-session-status" />
                    );

                  const reviewableCompleted = session.displayType !== "completed_activity" && session.status === "completed";
                  const showCompletedFooter = state === "completed" || state === "assigned_from_upload";
                  const cardTitle = state === "unmatched_upload" ? "Uploaded workout" : getSessionTitle(session);

                  return (
                    <article
                      key={session.id}
                      className={`calendar-session-card px-2 py-1.5 text-xs ${reviewableCompleted ? "calendar-session-card--reviewable cursor-pointer" : ""}`}
                      data-state={state}
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
                        <span className="calendar-discipline-chip" style={{ backgroundColor: disciplineTone.bg, color: disciplineTone.text, borderColor: disciplineTone.border }}>
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
                      {showCompletedFooter ? (
                        <div className="calendar-session-footer mt-1 flex items-center text-[10px]">
                          <span className="calendar-state-pill" data-tone="complete">
                            <span aria-hidden="true">✓</span>
                            Completed
                          </span>
                        </div>
                      ) : state === "unmatched_upload" ? (
                        <div className="calendar-session-footer mt-2 pt-1.5">
                          {session.source?.uploadId ? (
                            <button
                              type="button"
                              onClick={() => setAssignSource(session)}
                              className="calendar-inline-cta px-2 py-1 text-[11px] font-medium transition"
                            >
                              Review upload
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-1 flex items-center justify-end">{stateBadge}</div>
                      )}
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
      {toast ? <p className="calendar-toast">{toast}</p> : null}
      {isPending ? <p className="calendar-pending">Saving…</p> : null}
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
        <select value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} className="calendar-control w-full px-3 py-2 text-sm">
          {weekDays.map((day) => <option key={day.iso} value={day.iso}>{day.weekday} · {day.label}</option>)}
        </select>
        <select value={form.sport} onChange={(e) => setForm((prev) => ({ ...prev, sport: e.target.value }))} className="calendar-control w-full px-3 py-2 text-sm">
          <option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option><option value="strength">Strength</option>
        </select>
        <input value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))} placeholder="Workout title (optional)" className="calendar-control w-full px-3 py-2 text-sm" />
        <input value={form.duration} onChange={(e) => setForm((prev) => ({ ...prev, duration: e.target.value }))} type="number" min={1} max={300} className="calendar-control w-full px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2 border-t border-[hsl(var(--performance-border))] pt-3">
          <button type="button" onClick={onClose} className="btn-secondary performance-btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button disabled={isPending} className="btn-primary performance-btn-primary px-2 py-1 text-xs">Save</button>
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
        <select value={date} onChange={(e) => setDate(e.target.value)} className="calendar-control w-full px-3 py-2 text-sm">
          {weekDays.map((day) => (
            <option key={day.iso} value={day.iso}>
              {day.weekday} · {day.label}
              {day.iso >= todayIso ? " · open" : ""}
            </option>
          ))}
        </select>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[hsl(var(--performance-border))] bg-transparent pt-3">
          <button type="button" onClick={onClose} className="btn-secondary performance-btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button type="button" onClick={() => { onMove(session, date); onClose(); }} className="btn-primary performance-btn-primary px-2 py-1 text-xs">Move here</button>
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
        <div className="calendar-callout p-3" data-tone="upload">
          <p className="performance-eyebrow text-[hsl(var(--accent-performance))]">Uploaded workout</p>
          <p className="mt-1 text-sm font-semibold text-[hsl(var(--text-primary))]">
            {getDisciplineMeta(upload.sport).label} · {upload.duration} min
          </p>
          <p className="mt-1 text-xs text-muted">Logged {uploadDateFormatter.format(new Date(`${upload.created_at}`))}</p>
        </div>
        {candidateSessions.length === 0 ? (
          <p className="text-xs text-muted">No planned sessions in this week. Add or move a planned session first.</p>
        ) : (
          <select value={selectedSessionId} onChange={(e) => setSelectedSessionId(e.target.value)} className="calendar-control w-full px-3 py-2 text-sm">
            {candidateSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {(weekDays.find((day) => day.iso === session.date)?.weekday ?? session.date)} · {getSessionTitle(session)} · {session.duration} min
              </option>
            ))}
          </select>
        )}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[hsl(var(--performance-border))] bg-transparent pt-3">
          <button type="button" onClick={onClose} className="btn-secondary performance-btn-secondary px-2 py-1 text-xs">Cancel</button>
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
            className="btn-primary performance-btn-primary px-2 py-1 text-xs"
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
          <div className="calendar-score-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Execution Score</p>
              <span
                className="calendar-state-pill"
                data-tone={executionScoreBand === "On target" ? "complete" : executionScoreBand === "Partial match" ? "extra" : "attention"}
              >
                {executionScoreBand}
              </span>
            </div>
            <p className="mt-1 text-base font-semibold text-[hsl(var(--text-primary))]">{executionScore} · {executionScoreBand}{provisional ? " · Provisional" : ""}</p>
            {(executionSummary || nextAction) ? (
              <div className="calendar-score-summary mt-2 px-2.5 py-2">
                {executionSummary ? <p className="text-xs text-muted">{executionSummary}</p> : null}
                {nextAction ? <p className="mt-1 text-xs font-medium text-[hsl(var(--text-primary))]">Next step: {nextAction}</p> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="calendar-score-card p-3">
            <p className="text-xs text-muted">Detailed execution scoring is still provisional. Use schedule status and session notes for now.</p>
          </div>
        )}
        {session.notes ? <p className="calendar-note-box p-2 text-xs text-muted">{session.notes}</p> : null}
        <div className="sticky bottom-0 pt-2 text-right">
          <button onClick={onClose} className="btn-secondary performance-btn-secondary px-2 py-1 text-xs">Close</button>
        </div>
      </div>
    </TaskSheet>
  );
}

function TaskOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="calendar-overlay fixed inset-0 z-40 overflow-y-auto">
      <button type="button" aria-label="Close overlay" className="absolute inset-0 min-h-full w-full cursor-default" onClick={onClose} />
      {children}
    </div>
  );
}

function TaskSheet({ children, title, description, onClose }: { children: React.ReactNode; title: string; description?: string; onClose: () => void }) {
  return (
    <TaskOverlay onClose={onClose}>
      <aside className="calendar-sheet relative ml-auto flex min-h-screen w-full max-w-xl flex-col">
        <header className="calendar-sheet-header px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="performance-eyebrow text-[hsl(var(--accent-performance))]">Calendar task</p>
              <p className="mt-1 text-base font-semibold">{title}</p>
              {description ? (
                <p className="calendar-sheet-description mt-2 max-w-md px-3 py-2 text-xs text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="calendar-close-button px-2 py-1 text-xs">Close</button>
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
        <section className="calendar-modal w-full max-w-md p-5">
          <header className="calendar-modal-header mb-4 pb-3">
            <p className="text-base font-semibold">{title}</p>
            {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
          </header>
          {children}
        </section>
      </div>
    </TaskOverlay>
  );
}
