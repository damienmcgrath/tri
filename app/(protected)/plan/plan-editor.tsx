"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import {
  bulkReorderSessionsAction,
  createPlanAction,
  createSessionAction,
  deletePlanAction,
  deleteSessionAction,
  deleteWeekAction,
  duplicateWeekForwardAction,
  shiftWeekAction,
  updateSessionAction,
  updateWeekAction
} from "./actions";

type Plan = { id: string; name: string; start_date: string; duration_weeks: number };
type TrainingWeek = {
  id: string;
  plan_id: string;
  week_index: number;
  week_start_date: string;
  focus: "Build" | "Recovery" | "Taper" | "Race" | "Custom";
  notes: string | null;
  target_minutes: number | null;
  target_tss: number | null;
};
type Session = {
  id: string;
  plan_id: string;
  week_id: string;
  date: string;
  sport: string;
  type: string;
  target: string | null;
  duration_minutes: number;
  day_order: number | null;
  notes: string | null;
  distance_value: number | null;
  distance_unit: string | null;
  status: "planned" | "completed" | "skipped";
};

type PlanEditorProps = { plans: Plan[]; weeks: TrainingWeek[]; sessions: Session[]; selectedPlanId?: string };

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

const templates = [
  { label: "Easy Run 45", sport: "run", duration: 45, type: "Easy", target: "Z2" },
  { label: "Long Run 90", sport: "run", duration: 90, type: "Long", target: "Steady" },
  { label: "Z2 Ride 60", sport: "bike", duration: 60, type: "Endurance", target: "Z2" },
  { label: "Long Ride 180", sport: "bike", duration: 180, type: "Long", target: "Z2 low" },
  { label: "Endurance Swim 45", sport: "swim", duration: 45, type: "Endurance", target: "Aerobic" },
  { label: "Strength 30", sport: "strength", duration: 30, type: "Strength", target: "Core + mobility" }
];

const sports = ["swim", "bike", "run", "strength", "other"] as const;

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekRangeLabel(weekStartDate: string) {
  const start = new Date(`${weekStartDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${shortDateFormatter.format(start)} – ${shortDateFormatter.format(end)}`;
}

function withNormalizedOrder(items: Session[]) {
  const grouped = new Map<string, Session[]>();
  for (const item of items) {
    const list = grouped.get(item.date) ?? [];
    list.push(item);
    grouped.set(item.date, list);
  }
  const normalized: Session[] = [];
  for (const [date, list] of grouped.entries()) {
    list
      .sort((a, b) => (a.day_order ?? 999) - (b.day_order ?? 999))
      .forEach((item, index) => normalized.push({ ...item, date, day_order: index }));
  }
  return normalized;
}



function DayDropZone({ iso, children }: { iso: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${iso}` });
  return (
    <div ref={setNodeRef} className={isOver ? "rounded-lg ring-1 ring-cyan-300/60" : ""}>
      {children}
    </div>
  );
}

function SortableSessionCard({ session, onOpen }: { session: Session; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `session-${session.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const meta = getDisciplineMeta(session.sport);

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      onClick={() => onOpen(session.id)}
      className={`group w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-2 text-left ${isDragging ? "opacity-30" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${meta.className}`}>{meta.label}</span>
        <span
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
          className="cursor-grab rounded-md px-1 text-xs text-muted opacity-0 group-hover:opacity-100"
          aria-label="Drag session"
        >
          ⋮⋮
        </span>
      </div>
      <p className="mt-1 text-xs font-semibold">{session.type || "Session"}</p>
      {session.target ? <p className="text-[11px] text-cyan-200">{session.target}</p> : null}
      <p className="text-xs text-muted">{session.duration_minutes} min</p>
    </button>
  );
}

export function PlanEditor({ plans, weeks, sessions, selectedPlanId }: PlanEditorProps) {
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const planWeeks = weeks.filter((week) => week.plan_id === selectedPlan?.id).sort((a, b) => a.week_index - b.week_index);
  const [selectedWeekId, setSelectedWeekId] = useState(planWeeks[0]?.id ?? "");
  const selectedWeek = planWeeks.find((week) => week.id === selectedWeekId) ?? planWeeks[0];
  const [quickAddDay, setQuickAddDay] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const [weekActionOpen, setWeekActionOpen] = useState(false);
  const [localSessions, setLocalSessions] = useState<Session[]>([]);

  useEffect(() => {
    setLocalSessions(withNormalizedOrder(sessions.filter((session) => session.week_id === selectedWeek?.id)));
  }, [sessions, selectedWeek?.id]);

  const weekSessions = useMemo(
    () => [...localSessions].sort((a, b) => a.date.localeCompare(b.date) || (a.day_order ?? 999) - (b.day_order ?? 999)),
    [localSessions]
  );

  const totalMinutes = weekSessions.reduce((sum, session) => sum + session.duration_minutes, 0);
  const targetMinutes = selectedWeek?.target_minutes ?? 0;
  const minuteDelta = totalMinutes - targetMinutes;

  const disciplineTotals = ["swim", "bike", "run", "strength", "other"]
    .map((sport) => ({ sport, minutes: weekSessions.filter((session) => session.sport === sport).reduce((sum, s) => sum + s.duration_minutes, 0) }))
    .filter((item) => item.sport !== "other" || item.minutes > 0);

  const maxDisciplineMinutes = Math.max(...disciplineTotals.map((item) => item.minutes), 1);

  const weekDays = selectedWeek
    ? Array.from({ length: 7 }).map((_, index) => {
        const iso = addDays(selectedWeek.week_start_date, index);
        const daySessions = weekSessions.filter((session) => session.date === iso);
        return {
          iso,
          label: weekdayFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
          date: shortDateFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
          sessions: daySessions,
          totalMinutes: daySessions.reduce((sum, session) => sum + session.duration_minutes, 0)
        };
      })
    : [];

  const activeSession = weekSessions.find((session) => session.id === activeSessionId);

  useEffect(() => {
    if (!planWeeks.length) return setSelectedWeekId("");
    if (!planWeeks.some((week) => week.id === selectedWeekId)) setSelectedWeekId(planWeeks[0].id);
  }, [planWeeks, selectedWeekId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const persistOrder = (items: Session[]) => {
    if (!selectedPlan || !selectedWeek) return;
    startTransition(async () => {
      await bulkReorderSessionsAction({
        planId: selectedPlan.id,
        weekId: selectedWeek.id,
        updates: items.map((item) => ({ sessionId: item.id, planId: selectedPlan.id, weekId: selectedWeek.id, date: item.date, dayOrder: item.day_order ?? 0 }))
      });
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const activeId = `${event.active.id}`;
    const overId = event.over ? `${event.over.id}` : "";
    if (!activeId.startsWith("session-") || !overId) return;
    const draggedSessionId = activeId.replace("session-", "");
    const dragged = weekSessions.find((session) => session.id === draggedSessionId);
    if (!dragged) return;

    const targetDay = overId.startsWith("day-")
      ? overId.replace("day-", "")
      : weekSessions.find((session) => `session-${session.id}` === overId)?.date;

    if (!targetDay) return;

    const targetList = weekSessions.filter((session) => session.date === targetDay && session.id !== dragged.id);
    const targetIndex = overId.startsWith("session-") ? targetList.findIndex((session) => `session-${session.id}` === overId) : targetList.length;
    const clampedIndex = targetIndex < 0 ? targetList.length : targetIndex;

    const next = weekSessions.filter((session) => session.id !== dragged.id);
    const insertAt = next.findIndex((session) => session.date === targetDay && (session.day_order ?? 0) >= clampedIndex);
    const moved = { ...dragged, date: targetDay };
    if (insertAt === -1) next.push(moved);
    else next.splice(insertAt, 0, moved);

    const normalized = withNormalizedOrder(next);
    setLocalSessions(normalized);
    persistOrder(normalized);
  };

  const duplicateTargets = planWeeks.filter((week) => week.id !== selectedWeek?.id);

  return (
    <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="surface p-4">
        <h1 className="text-xl font-semibold">Plan Builder</h1>
        <p className="mt-1 text-sm text-muted">Plan → Training Weeks → Sessions</p>
        <form action={createPlanAction} className="mt-4 space-y-2">
          <label className="label-base" htmlFor="plan-name">Plan name</label><input id="plan-name" name="name" required className="input-base" />
          <label className="label-base" htmlFor="plan-start">Start Monday</label><input id="plan-start" name="startDate" type="date" required className="input-base" />
          <label className="label-base" htmlFor="plan-duration">Duration (weeks)</label><input id="plan-duration" name="durationWeeks" type="number" min={1} max={52} defaultValue={12} required className="input-base" />
          <button className="btn-primary w-full">Create plan with weeks</button>
        </form>
        <div className="mt-5 space-y-2">
          {plans.map((plan) => (
            <div key={plan.id} className={`flex items-start gap-2 rounded-xl border p-2 ${selectedPlan?.id === plan.id ? "border-cyan-400/60 bg-cyan-500/10" : "border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"}`}>
              <Link href={`/plan?plan=${plan.id}`} className="min-w-0 flex-1 rounded-lg px-1 py-0.5"><p className="font-medium">{plan.name}</p></Link>
              <form action={deletePlanAction} onSubmit={(event) => { if (!window.confirm(`Delete plan "${plan.name}" and all weeks/sessions?`)) event.preventDefault(); }}>
                <input type="hidden" name="planId" value={plan.id} /><button className="btn-secondary px-2 py-1 text-xs">Delete</button>
              </form>
            </div>
          ))}
        </div>
      </aside>

      <main className="space-y-4">
        {selectedPlan && selectedWeek ? (
          <>
            <header className="surface p-5"><h2 className="text-2xl font-semibold">Plan: {selectedPlan.name} → Week {selectedWeek.week_index} ({weekRangeLabel(selectedWeek.week_start_date)})</h2></header>
            <article className="surface p-5">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <form action={updateWeekAction} className="space-y-3">
                  <input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} />
                  <label className="label-base" htmlFor="focus">Week focus</label><select id="focus" name="focus" defaultValue={selectedWeek.focus} className="input-base"><option>Build</option><option>Recovery</option><option>Taper</option><option>Race</option><option>Custom</option></select>
                  <label className="label-base" htmlFor="notes">Coach notes</label><textarea id="notes" name="notes" defaultValue={selectedWeek.notes ?? ""} className="input-base min-h-24" />
                  <div className="grid grid-cols-2 gap-3"><div><label className="label-base" htmlFor="targetMinutes">Target (goal) minutes</label><input id="targetMinutes" name="targetMinutes" type="number" min={0} defaultValue={selectedWeek.target_minutes ?? ""} className="input-base" /></div><div><label className="label-base" htmlFor="targetTss">Target (goal) TSS</label><input id="targetTss" name="targetTss" type="number" min={0} defaultValue={selectedWeek.target_tss ?? ""} className="input-base" /></div></div>
                  <button className="btn-primary">Save week metadata</button>
                </form>
                <div className="space-y-3">
                  <div className="surface-subtle p-3"><p className="text-xs uppercase tracking-wide text-muted">Planned (from sessions)</p><p className="mt-1 text-2xl font-semibold">{totalMinutes}</p><p className="text-xs text-muted">Δ vs target: {minuteDelta > 0 ? "+" : ""}{minuteDelta} min</p></div>
                  <div className="surface-subtle p-3"><p className="text-xs uppercase tracking-wide text-muted">Discipline breakdown</p><div className="mt-2 space-y-2">{disciplineTotals.map((item) => { const meta = getDisciplineMeta(item.sport); const pct = Math.round((item.minutes / maxDisciplineMinutes) * 100); return <div key={item.sport}><p className="text-xs">{meta.label} · {item.minutes} min</p><div className="mt-1 h-1.5 rounded-full bg-[hsl(var(--bg-card))]"><div className="h-full rounded-full bg-cyan-400/80" style={{ width: `${pct}%` }} /></div></div>; })}</div></div>
                  <div className="surface-subtle p-3">
                    <div className="flex items-center justify-between"><p className="text-xs uppercase tracking-wide text-muted">Week actions</p><button type="button" onClick={() => setWeekActionOpen((v) => !v)} aria-expanded={weekActionOpen} className="btn-secondary px-3 py-1 text-xs">⋯</button></div>
                    {weekActionOpen ? (
                      <div className="mt-3 space-y-3 text-sm">
                        <form action={duplicateWeekForwardAction} className="space-y-2"><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><label className="label-base">Duplicate to week</label><select name="destinationWeekId" className="input-base" required>{duplicateTargets.map((week) => <option key={week.id} value={week.id}>Week {week.week_index} ({weekRangeLabel(week.week_start_date)})</option>)}</select><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="copyMetadata" defaultChecked /> Copy metadata</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="copySessions" defaultChecked /> Copy sessions</label><button className="btn-secondary w-full text-xs">Duplicate</button></form>
                        <form action={shiftWeekAction} onSubmit={(event) => { if (!window.confirm("Shift this week and all sessions by +7 days?")) event.preventDefault(); }}><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><input type="hidden" name="direction" value="forward" /><button className="btn-secondary w-full text-xs">Shift +7d</button></form>
                        <form action={shiftWeekAction} onSubmit={(event) => { if (!window.confirm("Shift this week and all sessions by -7 days?")) event.preventDefault(); }}><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><input type="hidden" name="direction" value="backward" /><button className="btn-secondary w-full text-xs">Shift -7d</button></form>
                        <form action={deleteWeekAction} onSubmit={(event) => { if (!window.confirm("Delete this week and all sessions in it?")) event.preventDefault(); }}><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><button className="btn-secondary w-full text-xs text-rose-200">Delete week</button></form>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>

            <article className="surface p-5">
              <h3 className="text-lg font-semibold">Week schedule (Mon–Sun)</h3>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <div className="mt-3 grid gap-3 xl:grid-cols-7">
                  {weekDays.map((day) => {
                    const isExpanded = expandedDays[day.iso] ?? false;
                    const visible = isExpanded ? day.sessions : day.sessions.slice(0, 2);
                    const hiddenCount = Math.max(day.sessions.length - visible.length, 0);
                    return (
                      <section key={day.iso} className="surface-subtle p-3" id={`day-${day.iso}`}>
                        <p className="text-xs uppercase tracking-wide text-muted">{day.label}</p><p className="text-sm font-medium">{day.date}</p><p className="mt-1 text-xs text-muted">{day.totalMinutes} min</p>
                        <SortableContext items={day.sessions.map((session) => `session-${session.id}`)} strategy={rectSortingStrategy}>
                          <DayDropZone iso={day.iso}><div className="mt-3 space-y-2" data-day={day.iso}>
                            {visible.map((session) => <SortableSessionCard key={session.id} session={session} onOpen={setActiveSessionId} />)}
                            {hiddenCount > 0 ? <button type="button" className="w-full text-xs text-cyan-200" onClick={() => setExpandedDays((prev) => ({ ...prev, [day.iso]: true }))}>+{hiddenCount} more</button> : null}
                            {day.sessions.length > 2 && isExpanded ? <button type="button" className="w-full text-xs text-muted" onClick={() => setExpandedDays((prev) => ({ ...prev, [day.iso]: false }))}>Collapse</button> : null}
                            <button type="button" onClick={() => setQuickAddDay(day.iso)} className="w-full rounded-lg border border-dashed border-cyan-400/40 px-2 py-1 text-xs text-cyan-200">+ Add</button>
                          </div></DayDropZone>
                        </SortableContext>
                      </section>
                    );
                  })}
                </div>
                <DragOverlay>{isPending ? <div className="rounded-xl border border-cyan-400/40 bg-[hsl(var(--bg-card))] px-3 py-2 text-xs">Updating…</div> : null}</DragOverlay>
              </DndContext>
            </article>
          </>
        ) : null}
      </main>

      {selectedWeek && quickAddDay ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/55 p-4"><div className="surface w-full max-w-xl p-5">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Quick Add Session</h3><button type="button" onClick={() => setQuickAddDay(null)} className="btn-secondary px-3 py-1 text-xs">Close</button></div>
          <p className="mt-1 text-sm text-muted">Add to {longDateFormatter.format(new Date(`${quickAddDay}T00:00:00.000Z`))}</p>
          <form action={createSessionAction} className="mt-4 space-y-3"><input type="hidden" name="planId" value={selectedPlan?.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><input type="hidden" name="date" value={quickAddDay} />
            <label className="label-base">Template</label><select className="input-base" onChange={(event) => { const t = templates.find((item) => item.label === event.target.value); if (!t) return; const form = event.currentTarget.form; if (!form) return; (form.elements.namedItem("sport") as HTMLInputElement).value = t.sport; (form.elements.namedItem("durationMinutes") as HTMLInputElement).value = String(t.duration); (form.elements.namedItem("sessionType") as HTMLInputElement).value = t.type; (form.elements.namedItem("target") as HTMLInputElement).value = t.target; }}><option value="">Custom</option>{templates.map((template) => <option key={template.label}>{template.label}</option>)}</select>
            <fieldset><legend className="label-base mb-2">Discipline</legend><div className="grid grid-cols-5 gap-2">{sports.map((sport) => { const meta = getDisciplineMeta(sport); return <label key={sport} className={`cursor-pointer rounded-lg border px-2 py-2 text-center text-xs ${meta.className}`}><input defaultChecked={sport === "run"} className="sr-only" type="radio" name="sport" value={sport} />{meta.label}</label>; })}</div></fieldset>
            <label className="label-base">Duration (minutes)</label><input name="durationMinutes" type="number" min={1} required className="input-base" />
            <label className="label-base">Title / Type</label><input name="sessionType" className="input-base" placeholder="Easy, Long, Intervals" />
            <label className="label-base">Target</label><input name="target" className="input-base" placeholder="Z2, 3x10 @ FTP" />
            <details className="surface-subtle p-3"><summary className="cursor-pointer text-sm text-cyan-200">Add distance (optional)</summary><div className="mt-2 grid grid-cols-2 gap-2"><div><label className="label-base">Distance value</label><input name="distanceValue" type="number" min={0.01} step="0.01" className="input-base" /></div><div><label className="label-base">Distance unit</label><select name="distanceUnit" className="input-base" defaultValue=""><option value="">Select unit</option><option value="m">m</option><option value="km">km</option><option value="mi">mi</option><option value="yd">yd</option></select></div></div></details>
            <label className="label-base">Notes</label><textarea name="notes" className="input-base min-h-20" />
            <button className="btn-primary w-full">Add session</button>
          </form>
        </div></div>
      ) : null}

      {activeSession && selectedWeek ? (
        <div className="fixed inset-y-0 right-0 z-30 w-full max-w-md border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-2xl overflow-y-auto">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Edit session</h3><button type="button" onClick={() => setActiveSessionId(null)} className="btn-secondary px-3 py-1 text-xs">Close</button></div>
          <form action={updateSessionAction} className="mt-4 space-y-3"><input type="hidden" name="sessionId" value={activeSession.id} /><input type="hidden" name="planId" value={activeSession.plan_id} /><input type="hidden" name="weekId" value={activeSession.week_id} />
            <label className="label-base">Day</label><input name="date" type="date" defaultValue={activeSession.date} className="input-base" required />
            <label className="label-base">Discipline</label><select name="sport" defaultValue={activeSession.sport} className="input-base" required>{sports.map((sport) => <option key={sport} value={sport}>{getDisciplineMeta(sport).label}</option>)}</select>
            <label className="label-base">Duration (minutes)</label><input name="durationMinutes" type="number" min={1} defaultValue={activeSession.duration_minutes} className="input-base" required />
            <label className="label-base">Title / Type</label><input name="sessionType" defaultValue={activeSession.type} className="input-base" />
            <label className="label-base">Target</label><input name="target" defaultValue={activeSession.target ?? ""} className="input-base" />
            <div className="grid grid-cols-2 gap-3"><div><label className="label-base">Distance value</label><input name="distanceValue" type="number" min={0.01} step="0.01" defaultValue={activeSession.distance_value ?? ""} className="input-base" /></div><div><label className="label-base">Distance unit</label><select name="distanceUnit" defaultValue={activeSession.distance_unit ?? ""} className="input-base"><option value="">Select unit</option><option value="m">m</option><option value="km">km</option><option value="mi">mi</option><option value="yd">yd</option></select></div></div>
            <label className="label-base">Status</label><select name="status" defaultValue={activeSession.status} className="input-base"><option value="planned">Planned</option><option value="completed">Completed</option><option value="skipped">Skipped</option></select>
            <label className="label-base">Notes</label><textarea name="notes" defaultValue={activeSession.notes ?? ""} className="input-base min-h-20" />
            <div className="flex gap-2"><button className="btn-primary flex-1">Save changes</button><button formAction={deleteSessionAction} formMethod="post" onClick={(event) => { if (!window.confirm("Delete this session?")) event.preventDefault(); }} className="btn-secondary px-3">Delete</button></div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
