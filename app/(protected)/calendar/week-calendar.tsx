"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { SessionStatusChip } from "@/lib/ui/status-chip";
import { clearSkippedAction, markSkippedAction, moveSessionAction, quickAddSessionAction } from "@/app/(protected)/calendar/actions";

type SessionStatus = "planned" | "completed" | "skipped";
type FilterStatus = "all" | SessionStatus | "extra";
type SportFilter = "all" | "swim" | "bike" | "run" | "strength";

type CalendarSession = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration: number;
  notes: string | null;
  created_at: string;
  status: SessionStatus;
  linkedActivityCount?: number;
  linkedStats?: { durationMin: number; distanceKm: number; avgHr: number | null; avgPower: number | null } | null;
  unassignedSameDayCount?: number;
  is_key?: boolean;
  displayType?: "planned_session" | "completed_activity";
};

type WeekDay = { iso: string; weekday: string; label: string };

const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });

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


function getActivityId(sessionId: string) {
  return sessionId.startsWith("activity:") ? sessionId.replace("activity:", "") : null;
}

function getSessionState(session: CalendarSession) {
  if (session.displayType === "completed_activity") {
    return "extra" as const;
  }
  return session.status;
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
  const [toast, setToast] = useState<string | null>(null);
  const [dismissedStripIds, setDismissedStripIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [localSessions, setLocalSessions] = useState<CalendarSession[]>(sessions);

  useEffect(() => setLocalSessions(sessions), [sessions]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
      const state = getSessionState(session);
      const statusMatch = statusFilter === "all" || state === statusFilter;
      return sportMatch && statusMatch;
    });
  }, [localSessions, sportFilter, statusFilter]);

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
        const extras = all.filter((session) => session.displayType === "completed_activity");
        const plannedMin = planned.reduce((sum, item) => sum + item.duration, 0);
        const completedMin = planned.filter((item) => item.status === "completed").reduce((sum, item) => sum + item.duration, 0);
        const skipped = planned.filter((item) => item.status === "skipped" || isSkipped(item.notes)).length;
        const openCapacity = plannedMin <= 50;
        const isRest = planned.length === 0;
        const fullyDone = planned.length > 0 && planned.every((item) => item.status === "completed");
        return { day: day.iso, plannedMin, completedMin, skipped, extras: extras.length, openCapacity, isRest, fullyDone };
      }),
    [localSessions, weekDays]
  );

  const unmatchedUploads = localSessions
    .filter((session) => session.displayType === "completed_activity" && !dismissedStripIds.includes(session.id))
    .slice(0, 3);
  const skippedToResolve = localSessions
    .filter((session) => session.displayType !== "completed_activity" && session.status === "skipped" && !dismissedStripIds.includes(session.id))
    .slice(0, 2);

  const hasAdaptation = unmatchedUploads.length > 0 || skippedToResolve.length > 0 || extraSessionCount > 0;

  const absorbDay = dayMetrics.find((day) => day.openCapacity && !day.isRest)?.day ?? weekDays[0]?.iso;

  function moveSession(session: CalendarSession, newDate: string) {
    if (session.date === newDate) return;
    startTransition(() => {
      void (async () => {
        try {
          await moveSessionAction({ sessionId: session.id, newDate });
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
          <Link href={withWeek(addDays(activeWeekStart, -7))} className="btn-secondary px-2 py-1 text-xs">Prev</Link>
          <Link href={withWeek(currentWeekStart)} className="btn-secondary px-2 py-1 text-xs">Current</Link>
          <Link href={withWeek(addDays(activeWeekStart, 7))} className="btn-secondary px-2 py-1 text-xs">Next</Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="sr-only" htmlFor="sport-filter">Discipline filter</label>
          <select id="sport-filter" value={sportFilter} onChange={(e) => setSportFilter(e.target.value as SportFilter)} className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1">
            <option value="all">All disciplines</option><option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option><option value="strength">Strength</option>
          </select>
          <label className="sr-only" htmlFor="status-filter">Status filter</label>
          <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FilterStatus)} className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1">
            <option value="all">All states</option><option value="planned">Planned</option><option value="completed">Completed</option><option value="skipped">Skipped</option><option value="extra">Extra</option>
          </select>
          <button onClick={() => setQuickAddDate(weekDays[0]?.iso)} className="btn-primary px-2 py-1 text-xs">Add session</button>
          <span className="text-muted">{completedCount} completed · {plannedRemainingCount} remaining · {skippedCount} skipped · {extraSessionCount} extra</span>
        </div>
      </header>

      {hasAdaptation ? (
        <section className="surface-subtle space-y-2 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.14em] text-accent">Adaptation strip</p>
          <div className="grid gap-2 md:grid-cols-2">
            {unmatchedUploads.map((upload) => (
              <div key={upload.id} className="rounded-xl border border-[hsl(var(--accent-performance)/0.32)] bg-[hsl(var(--accent-performance)/0.08)] p-2 text-xs">
                <p className="font-semibold">Unmatched upload</p>
                <p className="text-muted">{getDisciplineMeta(upload.sport).label} · {upload.duration} min · uploaded {new Date(upload.created_at).toLocaleDateString()}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {getActivityId(upload.id) ? <Link href={`/activities/${getActivityId(upload.id)}`} className="btn-secondary px-2 py-1 text-[11px]">Assign to planned</Link> : null}
                  <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setDismissedStripIds((prev) => [...prev, upload.id])}>Mark as extra</button>
                  <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setDismissedStripIds((prev) => [...prev, upload.id])}>Dismiss</button>
                </div>
              </div>
            ))}
            {skippedToResolve.map((session) => (
              <div key={session.id} className="rounded-xl border border-[hsl(var(--signal-risk)/0.38)] bg-[hsl(var(--signal-risk)/0.08)] p-2 text-xs">
                <p className="font-semibold">Skipped session</p>
                <p className="text-muted">{session.type} · {session.duration} min</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => absorbDay && moveSession(session, absorbDay)}>Move to absorb day</button>
                  <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setDismissedStripIds((prev) => [...prev, session.id])}>Keep skipped</button>
                  <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setDismissedStripIds((prev) => [...prev, session.id])}>Dismiss</button>
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
          const isToday = day.iso === new Date().toISOString().slice(0, 10);
          return (
            <section key={day.iso} className="surface-card h-full rounded-2xl border border-[hsl(var(--border))] p-2">
              <div className="mb-2 border-b border-[hsl(var(--border))] pb-2">
                <p className="text-xs uppercase tracking-[0.14em] text-muted">{day.weekday}</p>
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{day.label}</p>
                  {isToday ? <span className="rounded-full bg-[hsl(var(--accent-performance)/0.2)] px-2 py-0.5 text-[10px] text-accent">Today</span> : null}
                </div>
                <p className="text-xs text-muted">{metrics?.completedMin ?? 0}/{metrics?.plannedMin ?? 0} min</p>
                <p className="text-[11px] text-muted">{metrics?.isRest ? "Rest" : metrics?.fullyDone ? "Completed day" : metrics?.openCapacity ? "Open capacity" : "Load set"}</p>
              </div>

              <div className="space-y-2">
                {daySessions.length === 0 ? <button onClick={() => setQuickAddDate(day.iso)} className="w-full rounded-xl border border-dashed border-[hsl(var(--border))] py-3 text-xs text-muted">+ Drop / add session</button> : null}
                {daySessions.map((session) => {
                  const state = getSessionState(session);
                  return (
                    <article key={session.id} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-2 text-xs">
                      <div className="flex items-center justify-between gap-1">
                        <p className="font-medium">{session.type}</p>
                        {state === "extra" ? <span className="rounded-full border border-[hsl(var(--signal-load)/0.4)] px-1.5 py-0.5 text-[10px] text-[hsl(var(--signal-load))]">Extra</span> : <SessionStatusChip status={session.status} compact />}
                      </div>
                      <p className="text-muted">{getDisciplineMeta(session.sport).label} · {session.duration} min</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {session.displayType !== "completed_activity" ? <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setMoveSource(session)}>Move</button> : null}
                        {session.displayType !== "completed_activity" ? (
                          <button
                            className="btn-secondary px-2 py-1 text-[11px]"
                            onClick={() => {
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
                          >
                            {session.status === "skipped" || isSkipped(session.notes) ? "Unskip" : "Skip"}
                          </button>
                        ) : null}
                        {session.displayType === "completed_activity" && getActivityId(session.id) ? <Link href={`/activities/${getActivityId(session.id)}`} className="btn-secondary px-2 py-1 text-[11px]">Assign upload</Link> : null}
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
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/50 p-4">
      <form
        className="surface-card w-full max-w-md space-y-2 rounded-2xl p-4"
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
        <p className="font-semibold">Add session</p>
        <select value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm">
          {weekDays.map((day) => <option key={day.iso} value={day.iso}>{day.weekday} · {day.label}</option>)}
        </select>
        <select value={form.sport} onChange={(e) => setForm((prev) => ({ ...prev, sport: e.target.value }))} className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm">
          <option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option><option value="strength">Strength</option>
        </select>
        <input value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))} placeholder="Session title" className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm" />
        <input value={form.duration} onChange={(e) => setForm((prev) => ({ ...prev, duration: e.target.value }))} type="number" min={1} max={300} className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button disabled={isPending} className="btn-primary px-2 py-1 text-xs">Save</button>
        </div>
      </form>
    </div>
  );
}

function MoveModal({ session, weekDays, onClose, onMove }: { session: CalendarSession; weekDays: WeekDay[]; onClose: () => void; onMove: (session: CalendarSession, newDate: string) => void }) {
  const [date, setDate] = useState(session.date);
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/50 p-4">
      <div className="surface-card w-full max-w-sm space-y-2 rounded-2xl p-4">
        <p className="font-semibold">Move {session.type}</p>
        <select value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm">
          {weekDays.map((day) => <option key={day.iso} value={day.iso}>{day.weekday} · {day.label}</option>)}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button type="button" onClick={() => { onMove(session, date); onClose(); }} className="btn-primary px-2 py-1 text-xs">Move</button>
        </div>
      </div>
    </div>
  );
}
