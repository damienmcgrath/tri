"use client";

import { useEffect, useMemo, useState } from "react";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { getOptionalSessionRoleLabel, getSessionDisplayName } from "@/lib/training/session";
import { getSessionIntentLabel } from "@/lib/training/semantics";
import {
  createSessionAction,
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
type SessionRole = "Key" | "Supporting" | "Recovery" | "Optional" | "key" | "supporting" | "recovery" | "optional";
type Session = {
  id: string;
  plan_id: string;
  week_id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  discipline?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  target: string | null;
  intent_category?: string | null;
  source_metadata?: { uploadId?: string | null; assignmentId?: string | null; assignedBy?: "planner" | "upload" | "coach" | null } | null;
  execution_result?: { status?: "matched_intent" | "partial_intent" | "missed_intent" | null; summary?: string | null } | null;
  duration_minutes: number;
  day_order: number | null;
  notes: string | null;
  distance_value: number | null;
  distance_unit: string | null;
  status: "planned" | "completed" | "skipped";
  is_key?: boolean | null;
  session_role?: SessionRole | null;
};

type PlanEditorProps = {
  plans: Plan[];
  weeks: TrainingWeek[];
  sessions: Session[];
  selectedPlanId?: string;
  initialWeekId?: string;
};

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

const templates = [
  { label: "Easy Run 45", sport: "run", duration: 45, type: "Easy Run", target: "Z2" },
  { label: "Long Run 90", sport: "run", duration: 90, type: "Long Run", target: "Steady" },
  { label: "Power Bike 60", sport: "bike", duration: 60, type: "Power Bike", target: "3x10 @ FTP" },
  { label: "Long Ride 180", sport: "bike", duration: 180, type: "Long Ride", target: "Z2 low" },
  { label: "Aerobic Swim 45", sport: "swim", duration: 45, type: "Aerobic Swim", target: "Aerobic" },
  { label: "General Strength 30", sport: "strength", duration: 30, type: "General Strength", target: "Core + mobility" }
];

const sports = ["swim", "bike", "run", "strength", "other"] as const;
const sessionRoles: SessionRole[] = ["Key", "Supporting", "Recovery", "Optional"];

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

function getLocalTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveInitialWeekId(weeks: TrainingWeek[], explicitWeekId?: string) {
  if (!weeks.length) return "";

  if (explicitWeekId && weeks.some((week) => week.id === explicitWeekId)) {
    return explicitWeekId;
  }

  const todayIso = getLocalTodayIso();
  const byStartDate = [...weeks].sort((a, b) => a.week_start_date.localeCompare(b.week_start_date));

  const currentWeek = byStartDate.find((week) => {
    const weekEnd = addDays(week.week_start_date, 6);
    return week.week_start_date <= todayIso && todayIso <= weekEnd;
  });

  if (currentWeek) return currentWeek.id;

  const upcomingWeek = byStartDate.find((week) => week.week_start_date > todayIso);
  if (upcomingWeek) return upcomingWeek.id;

  const mostRecentPastWeek = [...byStartDate].reverse().find((week) => week.week_start_date < todayIso);
  return mostRecentPastWeek?.id ?? byStartDate[0].id;
}

function disciplineChipTone(sport: string) {
  const tones: Record<string, { bg: string; text: string; dot: string; border: string }> = {
    swim: { bg: "rgba(86,182,217,0.22)", text: "#BFE9F8", dot: "#78CCE8", border: "rgba(86,182,217,0.35)" },
    bike: { bg: "rgba(107,170,117,0.2)", text: "#C9E8CF", dot: "#8AC896", border: "rgba(107,170,117,0.34)" },
    run: { bg: "rgba(196,135,114,0.2)", text: "#F0D3C8", dot: "#D9A995", border: "rgba(196,135,114,0.34)" },
    strength: { bg: "rgba(154,134,200,0.22)", text: "#E2D7F8", dot: "#BDA8E8", border: "rgba(154,134,200,0.36)" },
    other: { bg: "rgba(148,163,184,0.2)", text: "#E2E8F0", dot: "#CBD5E1", border: "rgba(148,163,184,0.35)" }
  };

  return tones[sport] ?? tones.other;
}

function plannerFocusFromNotes(notes: string) {
  const trimmed = notes.trim();
  if (!trimmed) return "";

  const focusMatch = trimmed.match(/^(?:focus|week focus)\s*:\s*(.+)$/i);
  if (focusMatch?.[1]) {
    return focusMatch[1].trim();
  }

  const firstLine = trimmed.split(/\n+/)[0]?.trim() ?? "";
  if (firstLine.length > 0 && firstLine.length <= 48) {
    return firstLine;
  }

  return "";
}

function getSessionIntentCue(intentCategory?: string | null) {
  if (!intentCategory) return null;

  const normalizedIntent = intentCategory.trim().toLowerCase();
  if (!normalizedIntent) return null;

  const hasKnownIntent = [
    "z2_endurance",
    "recovery",
    "threshold",
    "aerobic_swim",
    "technique_swim",
    "strength_maintenance",
    "long_endurance",
    "tempo",
    "intervals",
    "easy_run",
    "easy_bike",
    "endurance_ride",
    "endurance_swim"
  ].includes(normalizedIntent);

  if (hasKnownIntent) {
    return getSessionIntentLabel(normalizedIntent as Parameters<typeof getSessionIntentLabel>[0]);
  }

  return intentCategory
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getSessionRoleCue(role: ReturnType<typeof getOptionalSessionRoleLabel>) {
  if (!role) return null;

  const tones: Record<string, { short: string; className: string }> = {
    Key: { short: "K", className: "border-[hsl(var(--accent-performance)/0.42)] text-accent" },
    Supporting: { short: "S", className: "border-[hsl(var(--border))] text-muted" },
    Recovery: { short: "R", className: "border-emerald-400/45 text-emerald-200" },
    Optional: { short: "O", className: "border-sky-400/45 text-sky-200" }
  };

  return tones[role] ?? null;
}

function derivedWeekFocusLabel(
  weekIntent: TrainingWeek["focus"],
  sessions: Session[],
  disciplineTotals: Array<{ sport: string; minutes: number }>,
  restDays: number
) {
  const sessionCount = sessions.length;
  const roleCounts = sessions.reduce(
    (counts, session) => {
      const role = getOptionalSessionRoleLabel(session);
      if (role === "Key") counts.key += 1;
      if (role === "Supporting") counts.supporting += 1;
      if (role === "Recovery") counts.recovery += 1;
      if (role === "Optional") counts.optional += 1;
      return counts;
    },
    { key: 0, supporting: 0, recovery: 0, optional: 0 }
  );

  const intentCounts = sessions.reduce((counts, session) => {
    const intent = getSessionIntentCue(session.intent_category);
    if (!intent) return counts;
    counts.set(intent, (counts.get(intent) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  const topIntent = [...intentCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const hasRecoveryPattern = weekIntent === "Recovery"
    || restDays >= 2
    || roleCounts.recovery >= Math.max(2, Math.ceil(sessionCount * 0.34));

  if (hasRecoveryPattern) {
    return roleCounts.key > 0 ? "Recovery with one controlled quality touch" : "Recovery and aerobic reset";
  }

  if (roleCounts.key >= 2 && topIntent) return `${topIntent} progression across key sessions`;
  if (roleCounts.key === 1 && topIntent) return `${topIntent} anchored by one key session`;
  if (roleCounts.key >= 2) return "Quality progression across multiple key sessions";

  const ranked = disciplineTotals
    .filter((item) => item.minutes > 0 && item.sport !== "other")
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 2)
    .map((item) => getDisciplineMeta(item.sport).label.toLowerCase());

  if (ranked.length === 2) return `${ranked[0]} + ${ranked[1]} emphasis`;
  if (ranked.length === 1) return `${ranked[0]} emphasis`;

  return "";
}

export function PlanEditor({ plans, weeks, sessions, selectedPlanId, initialWeekId }: PlanEditorProps) {
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const planWeeks = weeks.filter((week) => week.plan_id === selectedPlan?.id).sort((a, b) => a.week_index - b.week_index);
  const [selectedWeekId, setSelectedWeekId] = useState(() => resolveInitialWeekId(planWeeks, initialWeekId));
  const [quickAddDay, setQuickAddDay] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSavingQuickAdd, setIsSavingQuickAdd] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [weekActionOpen, setWeekActionOpen] = useState(false);

  const selectedWeek = planWeeks.find((week) => week.id === selectedWeekId) ?? planWeeks[0];
  const selectedWeekIndex = selectedWeek ? planWeeks.findIndex((week) => week.id === selectedWeek.id) : -1;
  const previousWeek = selectedWeekIndex > 0 ? planWeeks[selectedWeekIndex - 1] : null;
  const nextWeek = selectedWeekIndex >= 0 && selectedWeekIndex < planWeeks.length - 1 ? planWeeks[selectedWeekIndex + 1] : null;

  const [weekDraft, setWeekDraft] = useState({
    focus: selectedWeek?.focus ?? "Build",
    targetMinutes: selectedWeek?.target_minutes ? String(selectedWeek.target_minutes) : "",
    notes: selectedWeek?.notes ?? ""
  });

  useEffect(() => {
    if (!planWeeks.length) return setSelectedWeekId("");
    if (!planWeeks.some((week) => week.id === selectedWeekId)) {
      setSelectedWeekId(resolveInitialWeekId(planWeeks, initialWeekId));
    }
  }, [initialWeekId, planWeeks, selectedWeekId]);

  useEffect(() => {
    if (!selectedWeek) return;
    setWeekDraft({
      focus: selectedWeek.focus,
      targetMinutes: selectedWeek.target_minutes ? String(selectedWeek.target_minutes) : "",
      notes: selectedWeek.notes ?? ""
    });
  }, [selectedWeek]);

  const weekSessions = useMemo(
    () => sessions
      .filter((session) => session.week_id === selectedWeek?.id)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.day_order ?? 99) - (b.day_order ?? 99)),
    [selectedWeek?.id, sessions]
  );

  const totalMinutes = weekSessions.reduce((sum, s) => sum + s.duration_minutes, 0);
  const keySessions = weekSessions.filter((session) => getOptionalSessionRoleLabel(session) === "Key").length;

  const disciplineTotals = ["swim", "bike", "run", "strength", "other"]
    .map((sport) => ({
      sport,
      minutes: weekSessions.filter((session) => session.sport === sport).reduce((sum, s) => sum + s.duration_minutes, 0)
    }))
    .filter((item) => item.sport !== "other" || item.minutes > 0);

  const weekDays = selectedWeek
    ? Array.from({ length: 7 }).map((_, index) => {
        const iso = addDays(selectedWeek.week_start_date, index);
        const daySessions = weekSessions.filter((session) => session.date === iso);
        const totalDayMinutes = daySessions.reduce((sum, session) => sum + session.duration_minutes, 0);
        const hasKeySession = daySessions.some((session) => getOptionalSessionRoleLabel(session) === "Key");
        return {
          iso,
          label: weekdayFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
          date: shortDateFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
          sessions: daySessions,
          totalMinutes: totalDayMinutes,
          isRest: daySessions.length === 0,
          hasKeySession
        };
      })
    : [];

  const restDays = weekDays.filter((day) => day.isRest).length;
  const explicitWeekFocus = plannerFocusFromNotes(weekDraft.notes);
  const derivedWeekFocus = derivedWeekFocusLabel(weekDraft.focus, weekSessions, disciplineTotals, restDays);
  const weekFocusLabel = (explicitWeekFocus || derivedWeekFocus).trim();
  const normalizedBlock = weekDraft.focus.trim().toLowerCase();
  const normalizedFocus = weekFocusLabel.toLowerCase();
  const displayWeekFocus = weekFocusLabel && normalizedFocus !== normalizedBlock ? weekFocusLabel : "";
  const isWeekDirty = Boolean(
    selectedWeek && (
      weekDraft.focus !== selectedWeek.focus
      || weekDraft.targetMinutes !== (selectedWeek.target_minutes ? String(selectedWeek.target_minutes) : "")
      || weekDraft.notes !== (selectedWeek.notes ?? "")
    )
  );

  const duplicateTargets = planWeeks.filter((week) => week.id !== selectedWeek?.id);
  const activeSession = weekSessions.find((session) => session.id === activeSessionId);
  const notePreview = weekDraft.notes.trim();

  async function handleQuickAddSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingQuickAdd(true);

    try {
      await createSessionAction(new FormData(event.currentTarget));
      setQuickAddDay(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not add session");
    } finally {
      setIsSavingQuickAdd(false);
    }
  }

  async function handleSessionUpdateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSession(true);

    try {
      await updateSessionAction(new FormData(event.currentTarget));
      setActiveSessionId(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not save session");
    } finally {
      setIsSavingSession(false);
    }
  }

  async function handleSessionDelete(sessionId: string) {
    if (!window.confirm("Delete this session?")) {
      return;
    }

    setIsDeletingSession(true);

    try {
      const formData = new FormData();
      formData.set("sessionId", sessionId);
      await deleteSessionAction(formData);
      setActiveSessionId(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not delete session");
    } finally {
      setIsDeletingSession(false);
    }
  }

  if (!selectedPlan || !selectedWeek) {
    return <div className="surface p-4 text-sm text-muted">Create a plan to start programming weeks.</div>;
  }

  return (
    <section className="space-y-4">
      <header className="surface-subtle px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.14em] text-muted">Plan</p>
            <h2 className="text-lg font-semibold">Week {selectedWeek.week_index} · {weekDraft.focus}</h2>
            <p className="text-sm text-muted">{weekRangeLabel(selectedWeek.week_start_date)} · Planned {totalMinutes} min</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => previousWeek && setSelectedWeekId(previousWeek.id)} disabled={!previousWeek}>←</button>
            <select value={selectedWeek.id} onChange={(event) => setSelectedWeekId(event.target.value)} className="input-base w-auto py-1.5 text-xs" aria-label="Select plan week">
              {planWeeks.map((week) => (
                <option key={week.id} value={week.id}>Week {week.week_index} ({weekRangeLabel(week.week_start_date)})</option>
              ))}
            </select>
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => nextWeek && setSelectedWeekId(nextWeek.id)} disabled={!nextWeek}>→</button>
            {isWeekDirty ? <button form="week-details-form" className="btn-primary px-3 py-1.5 text-xs">Save</button> : null}
            <button type="button" onClick={() => setWeekActionOpen((v) => !v)} className="btn-secondary px-3 py-1.5 text-xs">Actions</button>
          </div>
        </div>
      </header>

      <section className="surface-subtle px-4 py-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Block</p>
            <p className="mt-1 text-sm">{weekDraft.focus}</p>
          </div>
          {displayWeekFocus ? (
            <div className="md:col-span-2">
              <p className="text-xs uppercase tracking-wide text-muted">Week focus</p>
              <p className="mt-1 text-sm">{displayWeekFocus}</p>
            </div>
          ) : null}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Rest days</p>
            <p className="mt-1 text-sm">{restDays}</p>
          </div>
          {keySessions > 0 ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Key sessions</p>
              <p className="mt-1 text-sm">{keySessions}</p>
            </div>
          ) : null}
        </div>
        {notePreview ? <p className="mt-3 text-xs text-muted">Week notes: {notePreview}</p> : null}
      </section>

      {weekActionOpen ? (
        <div className="surface-subtle p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
            <form action={duplicateWeekForwardAction} className="space-y-2"><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><label className="label-base">Duplicate to week</label><select name="destinationWeekId" className="input-base" required>{duplicateTargets.map((week) => <option key={week.id} value={week.id}>Week {week.week_index} ({weekRangeLabel(week.week_start_date)})</option>)}</select><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="copyMetadata" defaultChecked /> Copy metadata</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="copySessions" defaultChecked /> Copy sessions</label><button className="btn-secondary w-full text-xs">Duplicate</button></form>
            <form action={shiftWeekAction} onSubmit={(event) => { if (!window.confirm("Shift this week and all sessions by +7 days?")) event.preventDefault(); }}><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><input type="hidden" name="direction" value="forward" /><button className="btn-secondary w-full text-xs">Shift +7d</button></form>
            <form action={shiftWeekAction} onSubmit={(event) => { if (!window.confirm("Shift this week and all sessions by -7 days?")) event.preventDefault(); }}><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><input type="hidden" name="direction" value="backward" /><button className="btn-secondary w-full text-xs">Shift -7d</button></form>
            <form action={deleteWeekAction} onSubmit={(event) => { if (!window.confirm("Delete this week and all sessions in it?")) event.preventDefault(); }}><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><button className="btn-secondary w-full text-xs text-rose-200">Delete week</button></form>
          </div>
        </div>
      ) : null}

      <form id="week-details-form" action={updateWeekAction} className="hidden">
        <input type="hidden" name="planId" value={selectedPlan.id} />
        <input type="hidden" name="weekId" value={selectedWeek.id} />
        <input type="hidden" name="focus" value={weekDraft.focus} />
        <input type="hidden" name="targetMinutes" value={weekDraft.targetMinutes} />
        <input type="hidden" name="notes" value={weekDraft.notes} />
      </form>

      <article className="surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Week board (Mon–Sun)</h3>
          <p className="text-xs text-muted">For scheduling changes, use Calendar.</p>
        </div>

        <div className="hidden gap-3 lg:grid lg:grid-cols-7">
          {weekDays.map((day) => (
            <section key={day.iso} className={`group/day flex min-h-[236px] min-w-0 flex-col p-2.5 ${day.isRest ? "surface-subtle opacity-80" : "surface-subtle"}`}>
              <div className="mb-1.5 flex items-start justify-between border-b border-[hsl(var(--border))] pb-1.5">
                <div><p className="text-xs uppercase tracking-wide text-muted">{day.label}</p><p className="text-sm font-medium">{day.date}</p></div>
                <div className="text-right">
                  <p className="text-xs text-muted">{day.totalMinutes} min</p>
                  {day.isRest ? <p className="text-[11px] text-muted/90">Rest</p> : null}
                  {!day.isRest && day.hasKeySession ? <p className="text-[11px] text-accent">Key day</p> : null}
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                {day.sessions.map((session) => {
                  const meta = getDisciplineMeta(session.sport);
                  const role = getOptionalSessionRoleLabel(session);
                  const roleCue = getSessionRoleCue(role);
                  const intentCue = getSessionIntentCue(session.intent_category);
                  return (
                    <button key={session.id} type="button" onClick={() => setActiveSessionId(session.id)} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-2 py-2 text-left hover:border-[hsl(var(--accent-performance)/0.5)]">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
                          style={{
                            backgroundColor: disciplineChipTone(session.sport).bg,
                            color: disciplineChipTone(session.sport).text,
                            borderColor: disciplineChipTone(session.sport).border
                          }}
                        >
                          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: disciplineChipTone(session.sport).dot }} />
                          <span>{meta.label}</span>
                        </span>
                        {roleCue ? (
                          <span title={role ?? undefined} className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${roleCue.className}`}>{roleCue.short}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs font-semibold leading-snug">{getSessionDisplayName({ sessionName: session.session_name ?? session.type, discipline: session.discipline ?? session.sport, subtype: session.subtype ?? session.target, workoutType: session.workout_type, intentCategory: session.intent_category, source: session.source_metadata, executionResult: session.execution_result })}</p>
                      {intentCue ? <p className="text-[11px] text-muted">Intent: {intentCue}</p> : null}
                      <p className="text-[11px] text-muted">{session.duration_minutes} min{session.target ? ` · ${session.target}` : ""}</p>
                    </button>
                  );
                })}
                {day.sessions.length === 0 ? <p className="py-4 text-center text-xs text-muted">Rest day · planned recovery window</p> : null}
              </div>
              <button type="button" onClick={() => setQuickAddDay(day.iso)} className="mt-2 w-fit text-left text-[11px] text-muted transition group-hover/day:text-accent focus-visible:text-accent">＋ Add</button>
            </section>
          ))}
        </div>

        <div className="space-y-3 lg:hidden">
          {weekDays.map((day) => (
            <section key={day.iso} className={`group/day p-2.5 ${day.isRest ? "surface-subtle opacity-80" : "surface-subtle"}`}>
              <div className="mb-1.5 flex items-center justify-between border-b border-[hsl(var(--border))] pb-1.5">
                <p className="text-sm font-semibold">{day.label} · {day.date}</p>
                <p className="text-xs text-muted">{day.totalMinutes} min{day.isRest ? " · Rest" : day.hasKeySession ? " · Key day" : ""}</p>
              </div>
              <div className="space-y-1.5">
                {day.sessions.map((session) => {
                  const role = getOptionalSessionRoleLabel(session);
                  const roleCue = getSessionRoleCue(role);
                  const intentCue = getSessionIntentCue(session.intent_category);
                  return (
                    <button key={session.id} type="button" onClick={() => setActiveSessionId(session.id)} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-2 py-2 text-left text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
                          style={{
                            backgroundColor: disciplineChipTone(session.sport).bg,
                            color: disciplineChipTone(session.sport).text,
                            borderColor: disciplineChipTone(session.sport).border
                          }}
                        >
                          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: disciplineChipTone(session.sport).dot }} />
                          <span>{getDisciplineMeta(session.sport).label}</span>
                        </span>
                        {roleCue ? (
                          <span title={role ?? undefined} className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${roleCue.className}`}>{roleCue.short}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 font-semibold leading-snug">{getSessionDisplayName({ sessionName: session.session_name ?? session.type, discipline: session.discipline ?? session.sport, subtype: session.subtype ?? session.target, workoutType: session.workout_type, intentCategory: session.intent_category, source: session.source_metadata, executionResult: session.execution_result })}</p>
                      {intentCue ? <p className="text-[11px] text-muted">Intent: {intentCue}</p> : null}
                      <p className="text-muted">{session.duration_minutes} min</p>
                    </button>
                  );
                })}
                {day.sessions.length === 0 ? <p className="py-2 text-xs text-muted">Rest day · planned recovery window.</p> : null}
              </div>
              <button type="button" onClick={() => setQuickAddDay(day.iso)} className="mt-1.5 text-[11px] text-muted transition group-hover/day:text-accent focus-visible:text-accent">＋ Add</button>
            </section>
          ))}
        </div>
      </article>

      <details className="surface-subtle p-3">
        <summary className="cursor-pointer text-sm font-medium">Week notes & settings</summary>
        <div className="mt-2">
          <p className="text-xs text-muted">Discipline totals: {disciplineTotals.map((item) => `${getDisciplineMeta(item.sport).label} ${item.minutes}m`).join(" · ") || "No sessions yet"}</p>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <label className="label-base">Focus</label>
            <select className="input-base" value={weekDraft.focus} onChange={(event) => setWeekDraft((prev) => ({ ...prev, focus: event.target.value as TrainingWeek["focus"] }))}><option>Build</option><option>Recovery</option><option>Taper</option><option>Race</option><option>Custom</option></select>
          </div>
          <div>
            <label className="label-base">Target minutes</label>
            <input className="input-base" type="number" min={0} value={weekDraft.targetMinutes} onChange={(event) => setWeekDraft((prev) => ({ ...prev, targetMinutes: event.target.value }))} />
          </div>
          <div>
            <label className="label-base">Week note</label>
            <textarea className="input-base min-h-20" value={weekDraft.notes} onChange={(event) => setWeekDraft((prev) => ({ ...prev, notes: event.target.value }))} />
          </div>
        </div>
      </details>

      {quickAddDay ? (
        <div className="fixed bottom-0 right-0 top-14 z-20 w-full max-w-md border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-2xl overflow-y-auto">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Add session</h3><button type="button" onClick={() => setQuickAddDay(null)} className="btn-secondary px-3 py-1 text-xs">Close</button></div>
          <p className="mt-1 text-xs text-muted">{longDateFormatter.format(new Date(`${quickAddDay}T00:00:00.000Z`))}</p>
          <form action={createSessionAction} onSubmit={handleQuickAddSubmit} className="mt-4 space-y-3"><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><input type="hidden" name="date" value={quickAddDay} />
            <label className="label-base">Template</label><select className="input-base" onChange={(event) => { const t = templates.find((item) => item.label === event.target.value); if (!t) return; const form = event.currentTarget.form; if (!form) return; (form.elements.namedItem("sport") as HTMLInputElement).value = t.sport; (form.elements.namedItem("durationMinutes") as HTMLInputElement).value = String(t.duration); (form.elements.namedItem("sessionType") as HTMLInputElement).value = t.type; (form.elements.namedItem("target") as HTMLInputElement).value = t.target; }}><option value="">Custom</option>{templates.map((template) => <option key={template.label}>{template.label}</option>)}</select>
            <label className="label-base">Discipline</label><select className="input-base" name="sport" defaultValue="run">{sports.map((sport) => <option key={sport} value={sport}>{getDisciplineMeta(sport).label}</option>)}</select>
            <label className="label-base">Session name</label><input name="sessionType" className="input-base" placeholder="Easy Run, Power Bike, Aerobic Swim" />
            <label className="label-base">Duration (minutes)</label><input name="durationMinutes" type="number" min={1} required className="input-base" />
            <label className="label-base">Target</label><input name="target" className="input-base" placeholder="Z2, 4x8 threshold, etc" />
            <label className="label-base">Role (optional)</label>
            <select name="sessionRole" className="input-base" defaultValue=""><option value="">No role</option>{sessionRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select>
            <label className="label-base">Notes</label><textarea name="notes" className="input-base min-h-20" />
            <button disabled={isSavingQuickAdd} className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-70">{isSavingQuickAdd ? "Saving..." : "Add session"}</button>
          </form>
        </div>
      ) : null}

      {activeSession ? (
        <div className="fixed bottom-0 right-0 top-14 z-20 w-full max-w-md border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-2xl overflow-y-auto">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Edit session</h3><button type="button" onClick={() => setActiveSessionId(null)} className="btn-secondary px-3 py-1 text-xs">Close</button></div>
          <form action={updateSessionAction} onSubmit={handleSessionUpdateSubmit} className="mt-4 space-y-3"><input type="hidden" name="sessionId" value={activeSession.id} /><input type="hidden" name="planId" value={activeSession.plan_id} /><input type="hidden" name="weekId" value={activeSession.week_id} />
            <label className="label-base">Day</label><input name="date" type="date" defaultValue={activeSession.date} className="input-base" required />
            <label className="label-base">Discipline</label><select name="sport" defaultValue={activeSession.sport} className="input-base" required>{sports.map((sport) => <option key={sport} value={sport}>{getDisciplineMeta(sport).label}</option>)}</select>
            <label className="label-base">Session name</label><input name="sessionType" defaultValue={activeSession.type ?? ""} className="input-base" />
            <label className="label-base">Duration (minutes)</label><input name="durationMinutes" type="number" min={1} defaultValue={activeSession.duration_minutes} className="input-base" required />
            <label className="label-base">Target</label><input name="target" defaultValue={activeSession.target ?? ""} className="input-base" />
            <label className="label-base">Role (optional)</label>
            <select name="sessionRole" className="input-base" defaultValue={activeSession.session_role ?? (activeSession.is_key ? "Key" : "")}><option value="">No role</option>{sessionRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select>
            <label className="label-base">Status</label><select name="status" defaultValue={activeSession.status} className="input-base"><option value="planned">Planned</option><option value="completed">Completed</option><option value="skipped">Skipped</option></select>
            <label className="label-base">Notes</label><textarea name="notes" defaultValue={activeSession.notes ?? ""} className="input-base min-h-20" />
            <div className="flex gap-2"><button disabled={isSavingSession || isDeletingSession} className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-70">{isSavingSession ? "Saving..." : "Save changes"}</button><button type="button" disabled={isSavingSession || isDeletingSession} onClick={() => void handleSessionDelete(activeSession.id)} className="btn-secondary px-3 disabled:cursor-not-allowed disabled:opacity-70">{isDeletingSession ? "Deleting..." : "Delete"}</button></div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
