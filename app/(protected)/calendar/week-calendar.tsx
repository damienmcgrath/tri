"use client";

import Link from "next/link";
import { ReactNode, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { clearSkippedAction, markSkippedAction, moveSessionAction, quickAddSessionAction, swapSessionDayAction } from "@/app/(protected)/calendar/actions";

type SessionStatus = "planned" | "completed" | "skipped";
type FilterStatus = "all" | SessionStatus;
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
};

type WeekDay = { iso: string; weekday: string; label: string };

const sports = ["swim", "bike", "run", "strength"] as const;
const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" });

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function parseTarget(notes: string | null) {
  if (!notes) return "";
  const firstLine = notes.split("\n")[0]?.trim() ?? "";
  return firstLine.replace(/\[skipped\s\d{4}-\d{2}-\d{2}\]/i, "").trim();
}

function isSkipped(notes: string | null) {
  return /\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(notes ?? "");
}

export function WeekCalendar({
  weekDays,
  sessions,
  weekStart,
  isCurrentWeek,
  raceCountdown
}: {
  weekDays: WeekDay[];
  sessions: CalendarSession[];
  weekStart: string;
  isCurrentWeek: boolean;
  raceCountdown: number | null;
}) {
  const router = useRouter();
  const [sportFilter, setSportFilter] = useState<SportFilter>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
  const [swapSource, setSwapSource] = useState<CalendarSession | null>(null);
  const [moveSource, setMoveSource] = useState<CalendarSession | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [orderByDay, setOrderByDay] = useState<Record<string, string[]>>(() =>
    weekDays.reduce<Record<string, string[]>>((acc, day) => {
      acc[day.iso] = sessions.filter((s) => s.date === day.iso).map((s) => s.id);
      return acc;
    }, {})
  );

  const sessionsById = useMemo(() => Object.fromEntries(sessions.map((session) => [session.id, session])), [sessions]);

  const filteredIdsByDay = useMemo(() => {
    return weekDays.reduce<Record<string, string[]>>((acc, day) => {
      const sourceIds = orderByDay[day.iso] ?? [];
      acc[day.iso] = sourceIds.filter((id) => {
        const session = sessionsById[id];
        if (!session) return false;
        const sportMatch = sportFilter === "all" || session.sport === sportFilter;
        const statusMatch = statusFilter === "all" || session.status === statusFilter;
        return sportMatch && statusMatch;
      });
      return acc;
    }, {});
  }, [orderByDay, sessionsById, sportFilter, statusFilter, weekDays]);

  const totals = useMemo(() => {
    const planned = sessions.reduce((sum, session) => sum + session.duration, 0);
    const completed = sessions.filter((session) => session.status === "completed").reduce((sum, session) => sum + session.duration, 0);
    return { planned, completed, remaining: Math.max(planned - completed, 0) };
  }, [sessions]);

  const progressBySport = useMemo(
    () =>
      sports.map((sport) => {
        const planned = sessions.filter((session) => session.sport === sport).reduce((sum, session) => sum + session.duration, 0);
        const completed = sessions
          .filter((session) => session.sport === sport && session.status === "completed")
          .reduce((sum, session) => sum + session.duration, 0);
        return { sport, planned, completed };
      }),
    [sessions]
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const prevWeek = new Date(`${weekStart}T00:00:00.000Z`);
  prevWeek.setUTCDate(prevWeek.getUTCDate() - 7);
  const nextWeek = new Date(`${weekStart}T00:00:00.000Z`);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);

  function weekLink(iso: string) {
    return `/calendar?weekStart=${iso}`;
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const activeIdValue = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;

    const activeSession = sessionsById[activeIdValue];
    if (!activeSession) return;

    const fromDay = activeSession.date;
    const targetDay = overId.startsWith("day:") ? overId.replace("day:", "") : sessionsById[overId]?.date;

    if (!targetDay) return;

    if (fromDay === targetDay) {
      if (!sessionsById[overId]) return;
      const current = orderByDay[fromDay] ?? [];
      const oldIndex = current.indexOf(activeIdValue);
      const newIndex = current.indexOf(overId);
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        setOrderByDay((prev) => ({ ...prev, [fromDay]: arrayMove(current, oldIndex, newIndex) }));
      }
      return;
    }

    const toList = orderByDay[targetDay] ?? [];
    const insertIndex = sessionsById[overId] ? toList.indexOf(overId) : toList.length;

    setOrderByDay((prev) => {
      const next = { ...prev };
      next[fromDay] = (next[fromDay] ?? []).filter((id) => id !== activeIdValue);
      const nextTarget = [...(next[targetDay] ?? [])];
      const safeIndex = insertIndex < 0 ? nextTarget.length : insertIndex;
      nextTarget.splice(safeIndex, 0, activeIdValue);
      next[targetDay] = nextTarget;
      return next;
    });

    startTransition(() => {
      void (async () => {
      try {
        await moveSessionAction({ sessionId: activeSession.id, newDate: targetDay });
        setToast("Session moved");
        router.refresh();
      } catch {
        setToast("Could not move session");
        router.refresh();
      }
      })();
    });
  }

  return (
    <section className="space-y-3">
      <header className="surface sticky top-2 z-20 space-y-3 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Week of {dayFormatter.format(new Date(`${weekDays[0].iso}T00:00:00.000Z`))}</p>
            <p className="text-sm font-semibold">
              {dayFormatter.format(new Date(`${weekDays[0].iso}T00:00:00.000Z`))}–{dayFormatter.format(new Date(`${weekDays[6].iso}T00:00:00.000Z`))}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={weekLink(prevWeek.toISOString().slice(0, 10))} className="btn-secondary px-3 py-1.5 text-xs">Prev week</Link>
            <Link href="/calendar" className={`btn-secondary px-3 py-1.5 text-xs ${isCurrentWeek ? "border-cyan-400/60" : ""}`}>Current week</Link>
            <Link href={weekLink(nextWeek.toISOString().slice(0, 10))} className="btn-secondary px-3 py-1.5 text-xs">Next week</Link>
            <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setQuickAddDate(todayIso)}>
              Add session
            </button>
            {raceCountdown !== null ? (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-100">Race in {raceCountdown}d</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(["all", "swim", "bike", "run", "strength"] as const).map((item) => (
              <button
                key={item}
                className={`rounded-full border px-3 py-1 text-xs ${sportFilter === item ? "border-cyan-300 bg-cyan-500/15 text-cyan-100" : "border-[hsl(var(--border))] text-muted"}`}
                onClick={() => setSportFilter(item)}
              >
                {item === "all" ? "All" : getDisciplineMeta(item).label}
              </button>
            ))}
          </div>
          <select aria-label="Status filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FilterStatus)} className="input-base w-auto py-1 text-xs">
            <option value="all">All statuses</option>
            <option value="planned">Pending</option>
            <option value="completed">Completed</option>
            <option value="skipped">Missed</option>
          </select>
        </div>
      </header>

      <article className="surface px-4 py-3">
        <div className="grid gap-2 md:grid-cols-6">
          <div className="surface-subtle p-3 md:col-span-2">
            <p className="text-xs uppercase tracking-wide text-muted">Week volume</p>
            <p className="mt-1 text-lg font-semibold">Completed {totals.completed} / {totals.planned} min</p>
            <p className="text-xs text-muted">{formatMinutes(totals.completed)} / {formatMinutes(totals.planned)} • {totals.remaining} min remaining</p>
          </div>
          {progressBySport.map((item) => {
            const discipline = getDisciplineMeta(item.sport);
            const ratio = item.planned ? Math.min(100, (item.completed / item.planned) * 100) : 0;
            return (
              <div key={item.sport} className="surface-subtle p-3">
                <p className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${discipline.className}`}>{discipline.label}</p>
                <p className="mt-1 text-xs">{item.completed}/{item.planned} min</p>
                <div className="mt-2 h-1.5 rounded-full bg-black/30">
                  <div className="h-full rounded-full bg-cyan-300/80" style={{ width: `${ratio}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </article>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <article className="grid gap-3 xl:grid-cols-7">
          {weekDays.map((day) => {
            const ids = filteredIdsByDay[day.iso] ?? [];
            const visibleIds = expandedDays[day.iso] ? ids : ids.slice(0, 2);
            const hiddenCount = Math.max(ids.length - visibleIds.length, 0);
            const planned = (orderByDay[day.iso] ?? []).map((id) => sessionsById[id]).filter(Boolean).reduce((sum, s) => sum + s.duration, 0);
            const completed = (orderByDay[day.iso] ?? [])
              .map((id) => sessionsById[id])
              .filter((s) => s?.status === "completed")
              .reduce((sum, s) => sum + (s?.duration ?? 0), 0);

            return (
              <DayDropZone key={day.iso} id={`day:${day.iso}`} isActive={activeId !== null}>
                <section className="surface min-h-[260px] p-3">
                  <div className={`border-b pb-2 ${day.iso === todayIso ? "border-cyan-300/70 shadow-[0_2px_0_0_rgba(34,211,238,0.45)]" : "border-[hsl(var(--border))]"}`}>
                    <p className="text-xs uppercase tracking-wide text-muted">{day.weekday}</p>
                    <p className="text-sm font-semibold">{day.label}</p>
                    <p className="text-xs text-muted">{planned === 0 ? "Rest" : `${completed}/${planned} min`}</p>
                  </div>

                  <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                    <div className="mt-2 space-y-2">
                      {visibleIds.length === 0 ? (
                        <button onClick={() => setQuickAddDate(day.iso)} className="w-full rounded-xl border border-dashed border-[hsl(var(--border))] px-2 py-6 text-xs text-muted hover:border-cyan-400/50 hover:text-cyan-100">
                          + Add
                        </button>
                      ) : (
                        visibleIds.map((id) => {
                          const session = sessionsById[id];
                          if (!session) return null;
                          return (
                            <SortableSessionCard
                              key={session.id}
                              session={session}
                              onSkip={() => {
                                startTransition(() => {
                                  void (async () => {
                                    try {
                                      if (session.status === "skipped") {
                                        await clearSkippedAction({ sessionId: session.id });
                                        setToast("Skipped status removed");
                                      } else {
                                        await markSkippedAction({ sessionId: session.id });
                                        setToast("Session marked skipped");
                                      }
                                    } catch {
                                      setToast(session.status === "skipped" ? "Could not undo skipped status" : "Could not mark session as missed");
                                    }
                                    router.refresh();
                                  })();
                                });
                              }}
                              onMove={() => setMoveSource(session)}
                              onSwap={() => setSwapSource(session)}
                            />
                          );
                        })
                      )}
                    </div>
                  </SortableContext>

                  {hiddenCount > 0 ? (
                    <button className="mt-2 text-xs text-cyan-200 hover:underline" onClick={() => setExpandedDays((prev) => ({ ...prev, [day.iso]: true }))}>
                      +{hiddenCount} more
                    </button>
                  ) : ids.length > 2 && expandedDays[day.iso] ? (
                    <button className="mt-2 text-xs text-muted hover:text-cyan-200" onClick={() => setExpandedDays((prev) => ({ ...prev, [day.iso]: false }))}>
                      Collapse
                    </button>
                  ) : null}
                </section>
              </DayDropZone>
            );
          })}
        </article>
      </DndContext>

      {quickAddDate ? (
        <QuickAddModal
          date={quickAddDate}
          onClose={() => setQuickAddDate(null)}
          onSubmit={(payload) => {
            startTransition(() => {
              void (async () => {
                try {
                  await quickAddSessionAction(payload);
                  setToast("Session added");
                  setQuickAddDate(null);
                } catch {
                  setToast("Could not add session");
                }
                router.refresh();
              })();
            });
          }}
        />
      ) : null}

      {moveSource ? (
        <MoveModal
          session={moveSource}
          days={weekDays}
          onClose={() => setMoveSource(null)}
          onMove={(newDate) => {
            startTransition(() => {
              void (async () => {
                try {
                  await moveSessionAction({ sessionId: moveSource.id, newDate });
                  setToast("Session moved");
                  setMoveSource(null);
                } catch {
                  setToast("Could not move session");
                }
                router.refresh();
              })();
            });
          }}
        />
      ) : null}

      {swapSource ? (
        <SwapModal
          session={swapSource}
          sessions={sessions}
          onClose={() => setSwapSource(null)}
          onSwap={(targetSessionId) => {
            startTransition(() => {
              void (async () => {
                try {
                  await swapSessionDayAction({ sourceSessionId: swapSource.id, targetSessionId });
                  setToast("Sessions swapped");
                  setSwapSource(null);
                } catch {
                  setToast("Could not swap sessions");
                }
                router.refresh();
              })();
            });
          }}
        />
      ) : null}

      {toast ? <p className="fixed bottom-4 right-4 rounded-xl border border-cyan-400/50 bg-slate-900/90 px-3 py-2 text-xs text-cyan-100">{toast}</p> : null}
      {isPending ? <p className="text-xs text-muted">Saving changes…</p> : null}
    </section>
  );
}

function DayDropZone({ children, id, isActive }: { children: ReactNode; id: string; isActive: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${isOver ? "rounded-2xl ring-1 ring-cyan-300/70" : ""} ${isActive ? "transition" : ""}`}>
      {children}
    </div>
  );
}

function SortableSessionCard({
  session,
  onSkip,
  onMove,
  onSwap
}: {
  session: CalendarSession;
  onSkip: () => void;
  onMove: () => void;
  onSwap: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: session.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  const discipline = getDisciplineMeta(session.sport);
  const target = parseTarget(session.notes);
  const skipped = session.status === "skipped" || isSkipped(session.notes);

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`surface-subtle p-2 ${isDragging ? "opacity-60" : ""} ${session.status === "completed" ? "opacity-70" : ""} ${skipped ? "bg-slate-900/70" : ""}`}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${discipline.className}`}>{discipline.label}</span>
            <p className={`mt-1 truncate text-sm font-medium ${skipped ? "line-through opacity-80" : ""}`}>{session.type}</p>
            <p className="text-xl font-semibold leading-tight">{session.duration} min</p>
            {target ? <p className="line-clamp-1 text-[11px] text-muted">{target}</p> : null}
          </div>
          <p className="shrink-0 rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[11px] text-cyan-100">
            {session.status === "planned" ? "Pending" : session.status === "completed" ? "✓ Done" : "Skipped"}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <button className="btn-secondary px-1.5 py-1" onClick={onMove} aria-label="Move session">
            Move
          </button>
          <button className="btn-secondary px-1.5 py-1" onClick={onSwap} aria-label="Swap session day">
            Swap
          </button>
          <button className="btn-secondary px-1.5 py-1" onClick={onSkip} aria-label={session.status === "skipped" ? "Undo skipped status" : "Mark session skipped"}>
            {session.status === "skipped" ? "Undo" : "Missed"}
          </button>
        </div>
      </div>
      <button className="mt-2 w-full rounded-lg border border-dashed border-[hsl(var(--border))] px-2 py-1 text-[10px] text-muted" {...attributes} {...listeners} aria-label={`Drag ${session.type}`}>
        Drag to reschedule
      </button>
    </article>
  );
}

function QuickAddModal({
  date,
  onClose,
  onSubmit
}: {
  date: string;
  onClose: () => void;
  onSubmit: (payload: { date: string; sport: "swim" | "bike" | "run" | "strength" | "other"; type?: string; duration: number; notes?: string }) => void;
}) {
  const [sport, setSport] = useState<"swim" | "bike" | "run" | "strength" | "other">("run");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("45");
  const [notes, setNotes] = useState("");
  const parsedDuration = Number(duration);
  const isDurationValid = Number.isInteger(parsedDuration) && parsedDuration >= 1;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/65 p-3">
      <div className="surface w-full max-w-md p-4">
        <h3 className="text-base font-semibold">Quick Add • {dayFormatter.format(new Date(`${date}T00:00:00.000Z`))}</h3>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["swim", "bike", "run", "strength"] as const).map((item) => (
              <button key={item} onClick={() => setSport(item)} className={`rounded-full px-3 py-1 text-xs ${sport === item ? getDisciplineMeta(item).className : "border border-[hsl(var(--border))] text-muted"}`}>
                {getDisciplineMeta(item).label}
              </button>
            ))}
          </div>
          <input className="input-base" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
          <input className="input-base" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Planned minutes" type="number" min={1} step={1} required />
          {!isDurationValid ? <p className="text-[11px] text-rose-300">Enter whole minutes (min 1).</p> : null}
          <input className="input-base" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Target / Notes (optional)" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary px-3 py-1.5 text-xs"
            disabled={!isDurationValid}
            onClick={() => {
              if (!isDurationValid) {
                return;
              }

              onSubmit({ date, sport, type: title, duration: parsedDuration, notes });
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function MoveModal({
  session,
  days,
  onClose,
  onMove
}: {
  session: CalendarSession;
  days: WeekDay[];
  onClose: () => void;
  onMove: (newDate: string) => void;
}) {
  const [date, setDate] = useState(session.date);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/65 p-3">
      <div className="surface w-full max-w-sm p-4">
        <h3 className="text-base font-semibold">Move session</h3>
        <select className="input-base mt-3" value={date} onChange={(e) => setDate(e.target.value)}>
          {days.map((day) => (
            <option key={day.iso} value={day.iso}>
              {day.weekday} • {day.label}
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={onClose}>Cancel</button>
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => onMove(date)}>Move</button>
        </div>
      </div>
    </div>
  );
}

function SwapModal({
  session,
  sessions,
  onClose,
  onSwap
}: {
  session: CalendarSession;
  sessions: CalendarSession[];
  onClose: () => void;
  onSwap: (targetSessionId: string) => void;
}) {
  const options = sessions.filter((item) => item.id !== session.id);
  const [selected, setSelected] = useState(options[0]?.id ?? "");
  const grouped = options.reduce<Record<string, CalendarSession[]>>((acc, item) => {
    acc[item.date] = [...(acc[item.date] ?? []), item];
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/65 p-3">
      <div className="surface w-full max-w-md p-4">
        <h3 className="text-base font-semibold">Swap with another session</h3>
        <select className="input-base mt-3" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {Object.entries(grouped).map(([day, daySessions]) => (
            <optgroup key={day} label={dayFormatter.format(new Date(`${day}T00:00:00.000Z`))}>
              {daySessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {getDisciplineMeta(item.sport).label} • {item.type}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={onClose}>Cancel</button>
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => onSwap(selected)} disabled={!selected}>Swap</button>
        </div>
      </div>
    </div>
  );
}
