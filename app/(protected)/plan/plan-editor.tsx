"use client";

import { useEffect, useMemo, useState } from "react";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import {
  createPlanAction,
  createSessionAction,
  deleteSessionAction,
  deleteWeekAction,
  duplicateWeekForwardAction,
  shiftWeekAction,
  updateSessionAction,
  updateWeekAction
} from "./actions";

type Plan = {
  id: string;
  name: string;
  start_date: string;
  duration_weeks: number;
};

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
  duration_minutes: number;
  notes: string | null;
  distance_value: number | null;
  distance_unit: string | null;
  status: "planned" | "completed" | "skipped";
};

type PlanEditorProps = {
  plans: Plan[];
  weeks: TrainingWeek[];
  sessions: Session[];
  selectedPlanId?: string;
};

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

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

export function PlanEditor({ plans, weeks, sessions, selectedPlanId }: PlanEditorProps) {
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const planWeeks = weeks.filter((week) => week.plan_id === selectedPlan?.id).sort((a, b) => a.week_index - b.week_index);
  const [selectedWeekId, setSelectedWeekId] = useState(planWeeks[0]?.id ?? "");
  const selectedWeek = planWeeks.find((week) => week.id === selectedWeekId) ?? planWeeks[0];
  const [quickAddDay, setQuickAddDay] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const weekSessions = useMemo(
    () => sessions.filter((session) => session.week_id === selectedWeek?.id).sort((a, b) => a.date.localeCompare(b.date)),
    [sessions, selectedWeek?.id]
  );

  const totalMinutes = weekSessions.reduce((sum, session) => sum + session.duration_minutes, 0);

  const disciplineTotals = ["swim", "bike", "run", "strength", "other"].map((sport) => ({
    sport,
    minutes: weekSessions.filter((session) => session.sport === sport).reduce((sum, session) => sum + session.duration_minutes, 0)
  }));

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
    if (!planWeeks.length) {
      setSelectedWeekId("");
      return;
    }

    const hasSelectedWeek = planWeeks.some((week) => week.id === selectedWeekId);
    if (!hasSelectedWeek) {
      setSelectedWeekId(planWeeks[0].id);
    }
  }, [planWeeks, selectedWeekId]);

  return (
    <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="surface p-4">
        <h1 className="text-xl font-semibold">Plan Builder</h1>
        <p className="mt-1 text-sm text-muted">Plan → Training Weeks → Sessions</p>

        <div className="mt-4">
          <h2 className="text-xs uppercase tracking-[0.2em] text-cyan-300">Create plan</h2>
          <form action={createPlanAction} className="mt-2 space-y-2">
            <label className="label-base" htmlFor="plan-name">Plan name</label>
            <input id="plan-name" name="name" required className="input-base" />
            <label className="label-base" htmlFor="plan-start">Start Monday</label>
            <input id="plan-start" name="startDate" type="date" required className="input-base" />
            <label className="label-base" htmlFor="plan-duration">Duration (weeks)</label>
            <input id="plan-duration" name="durationWeeks" type="number" min={1} max={52} defaultValue={12} required className="input-base" />
            <button className="btn-primary w-full">Create plan with weeks</button>
          </form>
        </div>

        <div className="mt-5 space-y-2">
          <h2 className="text-xs uppercase tracking-[0.2em] text-cyan-300">Plan selector</h2>
          {plans.length === 0 ? <p className="text-sm text-muted">No plans yet. Create your first plan.</p> : null}
          {plans.map((plan) => (
            <a
              key={plan.id}
              href={`/plan?plan=${plan.id}`}
              className={`block rounded-xl border px-3 py-2 ${selectedPlan?.id === plan.id ? "border-cyan-400/60 bg-cyan-500/10" : "border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"}`}
            >
              <p className="font-medium">{plan.name}</p>
              <p className="text-xs text-muted">{plan.start_date} · {plan.duration_weeks} weeks</p>
            </a>
          ))}
        </div>

        {selectedPlan ? (
          <div className="mt-5">
            <h2 className="text-xs uppercase tracking-[0.2em] text-cyan-300">Weeks</h2>
            <ul className="mt-2 space-y-2">
              {planWeeks.map((week) => {
                const minutes = sessions
                  .filter((session) => session.week_id === week.id)
                  .reduce((sum, session) => sum + session.duration_minutes, 0);

                return (
                  <li key={week.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedWeekId(week.id)}
                      className={`w-full rounded-xl border p-3 text-left ${selectedWeek?.id === week.id ? "border-cyan-400/70 bg-cyan-500/10" : "border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">Week {week.week_index}</p>
                        <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-100">{week.focus}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{weekRangeLabel(week.week_start_date)}</p>
                      <p className="mt-1 text-xs text-muted">{minutes} planned min</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </aside>

      <main className="space-y-4">
        {!selectedPlan || !selectedWeek ? (
          <article className="surface p-8 text-center">
            <h2 className="text-xl font-semibold">{selectedPlan ? "No weeks found" : "No plan selected"}</h2>
            <p className="mt-2 text-sm text-muted">
              {selectedPlan
                ? "This plan has no week rows yet. Re-run migrations and create weeks, then refresh."
                : "Create a plan in the sidebar to generate training weeks automatically."}
            </p>
          </article>
        ) : (
          <>
            <header className="surface p-5">
              <h2 className="text-2xl font-semibold">Plan: {selectedPlan.name} → Week {selectedWeek.week_index} ({weekRangeLabel(selectedWeek.week_start_date)})</h2>
            </header>

            <article className="surface p-5">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <form action={updateWeekAction} className="space-y-3">
                  <input type="hidden" name="planId" value={selectedPlan.id} />
                  <input type="hidden" name="weekId" value={selectedWeek.id} />

                  <label className="label-base" htmlFor="focus">Week focus</label>
                  <select id="focus" name="focus" defaultValue={selectedWeek.focus} className="input-base">
                    <option>Build</option>
                    <option>Recovery</option>
                    <option>Taper</option>
                    <option>Race</option>
                    <option>Custom</option>
                  </select>

                  <label className="label-base" htmlFor="notes">Coach notes</label>
                  <textarea id="notes" name="notes" defaultValue={selectedWeek.notes ?? ""} className="input-base min-h-24" />

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label-base" htmlFor="targetMinutes">Target minutes</label>
                      <input id="targetMinutes" name="targetMinutes" type="number" min={0} defaultValue={selectedWeek.target_minutes ?? ""} className="input-base" />
                    </div>
                    <div>
                      <label className="label-base" htmlFor="targetTss">Target TSS</label>
                      <input id="targetTss" name="targetTss" type="number" min={0} defaultValue={selectedWeek.target_tss ?? ""} className="input-base" />
                    </div>
                  </div>

                  <button className="btn-primary">Save week metadata</button>
                </form>

                <div className="space-y-3">
                  <div className="surface-subtle p-3">
                    <p className="text-xs uppercase tracking-wide text-muted">Planned minutes</p>
                    <p className="mt-1 text-2xl font-semibold">{totalMinutes}</p>
                  </div>
                  <div className="surface-subtle p-3">
                    <p className="text-xs uppercase tracking-wide text-muted">Discipline breakdown</p>
                    <div className="mt-2 space-y-2">
                      {disciplineTotals.map((item) => {
                        const meta = getDisciplineMeta(item.sport);
                        const pct = Math.round((item.minutes / maxDisciplineMinutes) * 100);
                        return (
                          <div key={item.sport}>
                            <p className="text-xs">{meta.label} · {item.minutes} min</p>
                            <div className="mt-1 h-1.5 rounded-full bg-[hsl(var(--bg-card))]">
                              <div className="h-full rounded-full bg-cyan-400/80" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <form action={duplicateWeekForwardAction}>
                      <input type="hidden" name="planId" value={selectedPlan.id} />
                      <input type="hidden" name="weekId" value={selectedWeek.id} />
                      <button className="btn-secondary w-full text-xs">Duplicate week →</button>
                    </form>
                    <form action={shiftWeekAction}>
                      <input type="hidden" name="planId" value={selectedPlan.id} />
                      <input type="hidden" name="weekId" value={selectedWeek.id} />
                      <input type="hidden" name="direction" value="forward" />
                      <button className="btn-secondary w-full text-xs">Shift +7d</button>
                    </form>
                    <form action={shiftWeekAction}>
                      <input type="hidden" name="planId" value={selectedPlan.id} />
                      <input type="hidden" name="weekId" value={selectedWeek.id} />
                      <input type="hidden" name="direction" value="backward" />
                      <button className="btn-secondary w-full text-xs">Shift -7d</button>
                    </form>
                    <form action={deleteWeekAction}>
                      <input type="hidden" name="planId" value={selectedPlan.id} />
                      <input type="hidden" name="weekId" value={selectedWeek.id} />
                      <button className="btn-secondary w-full text-xs">Delete week</button>
                    </form>
                  </div>
                </div>
              </div>
            </article>

            <article className="surface p-5">
              <h3 className="text-lg font-semibold">Week schedule (Mon–Sun)</h3>
              <div className="mt-3 grid gap-3 xl:grid-cols-7">
                {weekDays.map((day) => (
                  <section key={day.iso} className="surface-subtle p-3">
                    <p className="text-xs uppercase tracking-wide text-muted">{day.label}</p>
                    <p className="text-sm font-medium">{day.date}</p>
                    <p className="mt-1 text-xs text-muted">{day.totalMinutes} min</p>

                    <div className="mt-3 space-y-2">
                      {day.sessions.length === 0 ? (
                        <button type="button" onClick={() => setQuickAddDay(day.iso)} className="w-full rounded-lg border border-dashed border-cyan-400/40 px-2 py-2 text-xs text-cyan-200">
                          + Add
                        </button>
                      ) : (
                        <>
                          {day.sessions.map((session) => {
                            const meta = getDisciplineMeta(session.sport);
                            return (
                              <button key={session.id} type="button" onClick={() => setActiveSessionId(session.id)} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-2 text-left">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${meta.className}`}>{meta.label}</span>
                                <p className="mt-1 text-xs font-semibold">{session.type}</p>
                                <p className="text-xs text-muted">{session.duration_minutes} min</p>
                              </button>
                            );
                          })}
                          <button type="button" onClick={() => setQuickAddDay(day.iso)} className="w-full rounded-lg border border-dashed border-cyan-400/40 px-2 py-1 text-xs text-cyan-200">+ Add</button>
                        </>
                      )}
                    </div>
                  </section>
                ))}
              </div>

              {weekSessions.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-muted">Start building Week {selectedWeek.week_index}. Add your first session to any day.</p>
              ) : null}
            </article>
          </>
        )}
      </main>

      {selectedWeek && quickAddDay ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
          <div className="surface w-full max-w-xl p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Quick Add Session</h3>
              <button type="button" onClick={() => setQuickAddDay(null)} className="btn-secondary px-3 py-1 text-xs">Close</button>
            </div>
            <form action={createSessionAction} className="mt-4 space-y-3">
              <input type="hidden" name="planId" value={selectedPlan?.id} />
              <input type="hidden" name="weekId" value={selectedWeek.id} />

              <label className="label-base" htmlFor="quick-day">Day</label>
              <input id="quick-day" name="date" type="date" defaultValue={quickAddDay} className="input-base" required />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-base" htmlFor="quick-discipline">Discipline</label>
                  <select id="quick-discipline" name="sport" defaultValue="run" className="input-base">
                    <option value="swim">Swim</option>
                    <option value="bike">Bike</option>
                    <option value="run">Run</option>
                    <option value="strength">Strength</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label-base" htmlFor="quick-duration">Duration (min)</label>
                  <input id="quick-duration" name="durationMinutes" type="number" min={1} className="input-base" required />
                </div>
              </div>

              <details className="surface-subtle p-3">
                <summary className="cursor-pointer text-sm text-cyan-200">Optional distance</summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input name="distanceValue" type="number" min={0.01} step="0.01" className="input-base" placeholder="Distance" />
                  <select name="distanceUnit" className="input-base" defaultValue="">
                    <option value="">Unit</option>
                    <option value="m">m</option>
                    <option value="km">km</option>
                    <option value="mi">mi</option>
                    <option value="yd">yd</option>
                  </select>
                </div>
              </details>

              <label className="label-base" htmlFor="quick-type">Type / target</label>
              <input id="quick-type" name="sessionType" className="input-base" required />

              <label className="label-base" htmlFor="quick-notes">Notes</label>
              <textarea id="quick-notes" name="notes" className="input-base min-h-20" />

              <button className="btn-primary w-full">Add session</button>
            </form>
          </div>
        </div>
      ) : null}

      {activeSession && selectedWeek ? (
        <div className="fixed inset-y-0 right-0 z-30 w-full max-w-md border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Session details</h3>
            <button type="button" onClick={() => setActiveSessionId(null)} className="btn-secondary px-3 py-1 text-xs">Close</button>
          </div>

          <form action={updateSessionAction} className="mt-4 space-y-3">
            <input type="hidden" name="sessionId" value={activeSession.id} />
            <input type="hidden" name="planId" value={activeSession.plan_id} />
            <input type="hidden" name="weekId" value={activeSession.week_id} />

            <label className="label-base">Day</label>
            <input name="date" type="date" defaultValue={activeSession.date} className="input-base" required />

            <label className="label-base">Discipline</label>
            <select name="sport" defaultValue={activeSession.sport} className="input-base" required>
              <option value="swim">Swim</option>
              <option value="bike">Bike</option>
              <option value="run">Run</option>
              <option value="strength">Strength</option>
              <option value="other">Other</option>
            </select>

            <label className="label-base">Duration (min)</label>
            <input name="durationMinutes" type="number" min={1} defaultValue={activeSession.duration_minutes} className="input-base" required />

            <div className="grid grid-cols-2 gap-3">
              <input name="distanceValue" type="number" min={0.01} step="0.01" defaultValue={activeSession.distance_value ?? ""} className="input-base" placeholder="Distance" />
              <select name="distanceUnit" defaultValue={activeSession.distance_unit ?? ""} className="input-base">
                <option value="">Unit</option>
                <option value="m">m</option>
                <option value="km">km</option>
                <option value="mi">mi</option>
                <option value="yd">yd</option>
              </select>
            </div>

            <label className="label-base">Type / target</label>
            <input name="sessionType" defaultValue={activeSession.type} className="input-base" required />

            <label className="label-base">Status</label>
            <select name="status" defaultValue={activeSession.status} className="input-base">
              <option value="planned">Planned</option>
              <option value="completed">Completed</option>
              <option value="skipped">Skipped</option>
            </select>

            <label className="label-base">Notes</label>
            <textarea name="notes" defaultValue={activeSession.notes ?? ""} className="input-base min-h-20" />

            <div className="flex gap-2">
              <button className="btn-primary flex-1">Save changes</button>
              <button formAction={deleteSessionAction} className="btn-secondary px-3">Delete</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
