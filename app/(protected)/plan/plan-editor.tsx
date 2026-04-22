"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { getOptionalSessionRoleLabel, getSessionDisplayName } from "@/lib/training/session";
import { getSessionIntentLabel } from "@/lib/training/semantics";
import { computeSessionIntensityProfile, computeWeeklyIntensitySummary, getVisualWeight, type SessionIntensityProfile } from "@/lib/training/intensity-profile";
import { computeTssFromDuration } from "@/lib/training/load";
import { IntensityBar } from "./components/intensity-bar";
import { WeeklyIntensityHeader } from "./components/weekly-intensity-header";
import { BlockContextCard } from "./components/block-context-card";
import { BlockOverview } from "./components/block-overview";
import {
  createSessionAction,
  deleteSessionAction,
  deleteWeekAction,
  duplicateWeekForwardAction,
  shiftWeekAction,
  updateSessionAction,
  updateWeekAction
} from "./actions";
import { addDays, weekRangeLabel } from "@/lib/date-utils";

type Plan = { id: string; name: string; start_date: string; duration_weeks: number };
type TrainingBlock = {
  id: string;
  plan_id: string | null;
  season_id: string | null;
  name: string;
  block_type: "Base" | "Build" | "Peak" | "Taper" | "Race" | "Recovery" | "Transition";
  start_date: string;
  end_date: string;
  sort_order: number;
  target_race_id: string | null;
  notes: string | null;
};
type TrainingWeek = {
  id: string;
  plan_id: string;
  block_id: string | null;
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
  blocks?: TrainingBlock[];
  weeks: TrainingWeek[];
  sessions: Session[];
  selectedPlanId?: string;
  selectedBlockId?: string;
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
    swim: { bg: "color-mix(in oklch, var(--color-swim) 10%, transparent)", text: "var(--color-swim)", dot: "var(--color-swim)", border: "transparent" },
    bike: { bg: "color-mix(in oklch, var(--color-bike) 10%, transparent)", text: "var(--color-bike)", dot: "var(--color-bike)", border: "transparent" },
    run: { bg: "color-mix(in oklch, var(--color-run) 10%, transparent)", text: "var(--color-run)", dot: "var(--color-run)", border: "transparent" },
    strength: { bg: "color-mix(in oklch, var(--color-strength) 10%, transparent)", text: "var(--color-strength)", dot: "var(--color-strength)", border: "transparent" },
    other: { bg: "rgba(255,255,255,0.06)", text: "rgba(255,255,255,0.65)", dot: "rgba(255,255,255,0.65)", border: "transparent" }
  };

  return tones[sport] ?? tones.other;
}

function disciplineBorderColor(sport: string) {
  const tones: Record<string, string> = {
    run: "var(--color-run)",
    swim: "var(--color-swim)",
    bike: "var(--color-bike)",
    strength: "var(--color-strength)"
  };

  return tones[sport] ?? "rgba(255,255,255,0.24)";
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

  const tones: Record<string, { marker: string; className: string }> = {
    Key: { marker: "◆", className: "border-[hsl(var(--accent-performance)/0.42)] bg-[hsl(var(--accent-performance)/0.13)] text-accent" },
    Supporting: { marker: "•", className: "border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-muted" },
    Recovery: { marker: "○", className: "border-emerald-400/45 bg-emerald-500/10 text-emerald-200" },
    Optional: { marker: "+", className: "border-sky-400/45 bg-sky-500/10 text-sky-200" }
  };

  return tones[role] ?? null;
}

function sessionRoleSortWeight(role: ReturnType<typeof getOptionalSessionRoleLabel>) {
  if (role === "Key") return 4;
  if (role === "Recovery") return 3;
  if (role === "Supporting") return 2;
  if (role === "Optional") return 1;
  return 0;
}

function normalizeFocusText(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

  const [topIntent, topIntentCount = 0] = [...intentCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  const hasRecoveryPattern = weekIntent === "Recovery"
    || restDays >= 2
    || roleCounts.recovery >= Math.max(2, Math.ceil(sessionCount * 0.34));

  if (hasRecoveryPattern) {
    return roleCounts.key > 0 ? "Recovery with one controlled quality touch" : "Recovery and aerobic reset";
  }

  if (roleCounts.key >= 2 && topIntent) return `${topIntent} progression across key sessions`;
  if (roleCounts.key === 1 && topIntent) return `${topIntent} anchored by one key session`;
  if (roleCounts.key >= 2) return "Quality progression across multiple key sessions";

  if (topIntent && topIntentCount >= 2) {
    return `${topIntent} emphasis through the week`;
  }

  const ranked = disciplineTotals
    .filter((item) => item.minutes > 0 && item.sport !== "other")
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 2)
    .map((item) => getDisciplineMeta(item.sport).label.toLowerCase());

  if (ranked.length === 2) return `${ranked[0]} + ${ranked[1]} emphasis`;
  if (ranked.length === 1) return `${ranked[0]} emphasis`;

  return "";
}

export function PlanEditor({
  plans,
  blocks = [],
  weeks,
  sessions,
  selectedPlanId,
  selectedBlockId,
  initialWeekId
}: PlanEditorProps) {
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const planBlocks = blocks
    .filter((block) => block.plan_id === selectedPlan?.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const allPlanWeeks = weeks
    .filter((week) => week.plan_id === selectedPlan?.id)
    .sort((a, b) => a.week_index - b.week_index);

  const [currentBlockId, setCurrentBlockId] = useState<string | null>(selectedBlockId ?? null);
  useEffect(() => {
    if (!planBlocks.length) {
      setCurrentBlockId(null);
      return;
    }
    if (currentBlockId && planBlocks.some((block) => block.id === currentBlockId)) return;
    setCurrentBlockId(selectedBlockId ?? planBlocks[0].id);
  }, [planBlocks, selectedBlockId, currentBlockId]);

  const activeBlock = planBlocks.find((block) => block.id === currentBlockId) ?? null;
  const planWeeks = activeBlock
    ? allPlanWeeks.filter((week) => week.block_id === activeBlock.id)
    : allPlanWeeks;
  const [selectedWeekId, setSelectedWeekId] = useState(() => resolveInitialWeekId(planWeeks, initialWeekId));
  const [quickAddDay, setQuickAddDay] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSavingQuickAdd, setIsSavingQuickAdd] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [weekActionOpen, setWeekActionOpen] = useState(false);
  const [isDuplicating, startDuplicateTransition] = useTransition();
  const [duplicateToast, setDuplicateToast] = useState<string | null>(null);

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

  // Compute intensity profiles for current week sessions
  const { sessionProfileMap, weekIntensitySummary } = useMemo(() => {
    const rawProfiles = weekSessions.map((s) =>
      computeSessionIntensityProfile({
        id: s.id,
        sport: s.sport,
        type: s.type,
        target: s.target,
        notes: s.notes,
        durationMinutes: s.duration_minutes,
        intentCategory: s.intent_category ?? null
      })
    );
    const maxStress = Math.max(...rawProfiles.map((p) => p.rawStress), 1);
    const profiles: SessionIntensityProfile[] = rawProfiles.map((p) => ({
      ...p,
      visualWeight: getVisualWeight(p.rawStress, maxStress)
    }));
    const profileMap = new Map<string, SessionIntensityProfile>();
    for (const p of profiles) profileMap.set(p.sessionId, p);

    const summary = selectedWeek
      ? computeWeeklyIntensitySummary(profiles, selectedWeek.week_start_date)
      : null;

    return { sessionProfileMap: profileMap, weekIntensitySummary: summary };
  }, [weekSessions, selectedWeek]);

  const totalMinutes = weekSessions.reduce((sum, s) => sum + s.duration_minutes, 0);
  const keySessions = weekSessions.filter((session) => getOptionalSessionRoleLabel(session) === "Key").length;

  const blockOverviewWeeks = useMemo(() => {
    if (!activeBlock) return [];
    return planWeeks.map((week) => {
      const weekSess = sessions.filter((s) => s.week_id === week.id);
      const rawProfiles = weekSess.map((s) =>
        computeSessionIntensityProfile({
          id: s.id,
          sport: s.sport,
          type: s.type,
          target: s.target,
          notes: s.notes,
          durationMinutes: s.duration_minutes,
          intentCategory: s.intent_category ?? null
        })
      );
      const maxStress = Math.max(...rawProfiles.map((p) => p.rawStress), 1);
      const profiles: SessionIntensityProfile[] = rawProfiles.map((p) => ({
        ...p,
        visualWeight: getVisualWeight(p.rawStress, maxStress)
      }));
      const summary = profiles.length
        ? computeWeeklyIntensitySummary(profiles, week.week_start_date)
        : null;
      return {
        weekIndex: week.week_index,
        weekStartDate: week.week_start_date,
        focus: week.focus,
        summary
      };
    });
  }, [activeBlock, planWeeks, sessions]);

  const blockSummary = useMemo(() => {
    if (!activeBlock) return null;
    const weekIds = new Set(planWeeks.map((w) => w.id));
    const blockSessions = sessions.filter((s) => weekIds.has(s.week_id));
    const planned = blockSessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
    const completed = blockSessions
      .filter((s) => s.status === "completed")
      .reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
    const completionPct = planned > 0 ? Math.round((completed / planned) * 100) : 0;
    const todayIso = getLocalTodayIso();
    const weeksTotal = planWeeks.length;
    const weeksElapsed = planWeeks.filter((w) => w.week_start_date <= todayIso).length;
    return {
      plannedMinutes: planned,
      completedMinutes: completed,
      completionPct,
      weeksTotal,
      weeksElapsed: Math.min(weeksElapsed, weeksTotal)
    };
  }, [activeBlock, planWeeks, sessions]);

  const previousWeekTotalMinutes = useMemo(() => {
    if (!previousWeek) return null;
    const end = addDays(previousWeek.week_start_date, 6);
    return sessions
      .filter((s) => s.date >= previousWeek.week_start_date && s.date <= end)
      .reduce((sum, s) => sum + s.duration_minutes, 0);
  }, [previousWeek, sessions]);

  const volumeDelta = previousWeekTotalMinutes !== null ? totalMinutes - previousWeekTotalMinutes : null;

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
        const roleCounts = daySessions.reduce(
          (counts, session) => {
            const role = getOptionalSessionRoleLabel(session);
            if (role === "Key") counts.key += 1;
            if (role === "Recovery") counts.recovery += 1;
            if (role === "Optional") counts.optional += 1;
            return counts;
          },
          { key: 0, recovery: 0, optional: 0 }
        );
        return {
          iso,
          label: weekdayFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
          date: shortDateFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
          sessions: daySessions,
          totalMinutes: totalDayMinutes,
          isRest: daySessions.length === 0,
          roleCounts
        };
      })
    : [];

  const restDays = weekDays.filter((day) => day.isRest).length;
  const explicitWeekFocus = plannerFocusFromNotes(weekDraft.notes);
  const derivedWeekFocus = derivedWeekFocusLabel(weekDraft.focus, weekSessions, disciplineTotals, restDays);
  const weekFocusLabel = (explicitWeekFocus || derivedWeekFocus).trim();
  const normalizedBlock = normalizeFocusText(weekDraft.focus);
  const normalizedFocus = normalizeFocusText(weekFocusLabel);
  const displayWeekFocus = weekFocusLabel && normalizedFocus && !normalizedFocus.includes(normalizedBlock) ? weekFocusLabel : "";
  const weekFocusSource = explicitWeekFocus ? "Planner focus" : displayWeekFocus ? "Derived focus" : "";
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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <p className="label-base text-[10px] text-accent">Plan</p>
            <h2 className="text-lg font-semibold">Week {selectedWeek.week_index} · {weekDraft.focus}</h2>
            <p className="text-sm text-muted">{weekRangeLabel(selectedWeek.week_start_date)} · Planned {totalMinutes} min</p>
          </div>
          {/* F25: week pager (prev / select / next) is one group, Save
              and Actions are week-scoped commands. A visual gap keeps
              Tab from overshooting from "→" straight onto "Actions". */}
          <div className="flex flex-wrap items-center gap-4">
            <div
              role="group"
              aria-label="Week pager"
              className="flex flex-wrap items-center gap-2"
            >
              <button
                type="button"
                aria-label="Previous week"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-3 text-xs text-[rgba(255,255,255,0.7)] disabled:opacity-40 lg:min-h-0 lg:min-w-0 lg:px-2 lg:py-1"
                onClick={() => previousWeek && setSelectedWeekId(previousWeek.id)}
                disabled={!previousWeek}
              >
                ←
              </button>
              <select value={selectedWeek.id} onChange={(event) => setSelectedWeekId(event.target.value)} className="input-base flex-1 py-1.5 text-xs sm:flex-none sm:w-auto" aria-label="Select plan week">
                {planWeeks.map((week) => (
                  <option key={week.id} value={week.id}>Week {week.week_index} ({weekRangeLabel(week.week_start_date)})</option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Next week"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-3 text-xs text-[rgba(255,255,255,0.7)] disabled:opacity-40 lg:min-h-0 lg:min-w-0 lg:px-2 lg:py-1"
                onClick={() => nextWeek && setSelectedWeekId(nextWeek.id)}
                disabled={!nextWeek}
              >
                →
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isWeekDirty ? <button form="week-details-form" className="btn-primary px-3 text-xs">Save</button> : null}
              <button
                type="button"
                onClick={() => setWeekActionOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={weekActionOpen}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-[rgba(255,255,255,0.20)] bg-transparent px-3 text-xs text-[rgba(255,255,255,0.7)] lg:min-h-0 lg:py-1.5"
              >
                Actions
                <span aria-hidden="true" className={`text-[10px] transition-transform ${weekActionOpen ? "rotate-180" : ""}`}>▾</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {planBlocks.length > 0 ? (
        <section className="surface-subtle px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="card-kicker">Training blocks</p>
            <p className="text-[11px] text-tertiary">{planBlocks.length} block{planBlocks.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {planBlocks.map((block) => {
              const isActive = block.id === currentBlockId;
              const blockWeeksCount = allPlanWeeks.filter((w) => w.block_id === block.id).length;
              return (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => setCurrentBlockId(block.id)}
                  className={`rounded-full border px-3 py-1.5 text-left text-xs transition ${
                    isActive
                      ? "border-[rgba(190,255,0,0.4)] bg-[rgba(190,255,0,0.1)] text-white"
                      : "border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.7)] hover:border-[rgba(255,255,255,0.26)]"
                  }`}
                >
                  <span className="font-medium">{block.name}</span>
                  <span className="ml-2 text-[10px] text-tertiary">
                    {block.block_type} · {blockWeeksCount} wk
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeBlock ? (
        <BlockContextCard
          blockType={activeBlock.block_type}
          blockWeek={Math.max(1, Math.min(blockSummary?.weeksElapsed ?? 1, blockSummary?.weeksTotal ?? 1))}
          blockTotalWeeks={blockSummary?.weeksTotal ?? 0}
          raceName={null}
          daysToRace={null}
          notes={activeBlock.notes}
        />
      ) : null}

      {activeBlock && blockSummary ? (
        <section className="surface-subtle px-4 py-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <p className="card-kicker">Block dates</p>
              <p className="mt-1 text-sm font-medium text-white">
                {weekRangeLabel(activeBlock.start_date)} – {weekRangeLabel(activeBlock.end_date)}
              </p>
            </div>
            <div>
              <p className="card-kicker">Planned volume</p>
              <p className="mt-1 text-sm font-medium text-white">{blockSummary.plannedMinutes} min</p>
            </div>
            <div>
              <p className="card-kicker">Completed</p>
              <p className="mt-1 text-sm font-medium text-white">{blockSummary.completedMinutes} min</p>
            </div>
            <div>
              <p className="card-kicker">Completion</p>
              <p className="mt-1 text-sm font-medium text-white">{blockSummary.completionPct}%</p>
            </div>
          </div>
        </section>
      ) : null}

      {activeBlock && blockOverviewWeeks.length > 0 ? (
        <BlockOverview weeks={blockOverviewWeeks} currentWeekStart={selectedWeek?.week_start_date} />
      ) : null}

      {/* F24: provenance moves to a tooltip — the user doesn't need to
          know whether the focus was planner-set or derived, they need
          to know *what the focus is*. Rest / Key counts fold into a
          compact inline line so the big-label treatment is reserved for
          the focus itself. */}
      <section className="surface-subtle px-4 py-3">
        <div className="grid gap-3 md:grid-cols-[1fr_1.6fr]">
          <div>
            <p className="card-kicker">Block</p>
            <p className="mt-1 text-sm font-medium text-white">{weekDraft.focus}</p>
          </div>
          {displayWeekFocus ? (
            <div>
              <p className="card-kicker inline-flex items-center gap-1.5">
                Week focus
                {weekFocusSource === "Derived focus" ? (
                  <span
                    title="AI-derived from this week's session mix — not an explicit planner setting."
                    aria-label="AI-derived"
                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[rgba(190,255,0,0.35)] text-[9px] leading-none text-[var(--color-accent)]"
                  >
                    ✦
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm font-medium text-white">{displayWeekFocus}</p>
            </div>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-tertiary">
          {restDays} rest day{restDays === 1 ? "" : "s"}
          {keySessions > 0 ? ` · ${keySessions} key session${keySessions === 1 ? "" : "s"}` : ""}
        </p>
        {notePreview ? <p className="mt-3 text-xs text-muted">Week notes: {notePreview}</p> : null}
      </section>

      {weekDays.some((d) => d.totalMinutes > 0) ? (
        <section className="surface-subtle px-4 py-3">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="card-kicker">Daily load shape</p>
            {/* F22: inline sport legend — bar segments encode sport, so
                the reader needs a key to decode "mostly blue Monday". */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-tertiary">
              {(["swim", "bike", "run", "strength"] as const).map((sport) => (
                <span key={sport} className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `var(--color-${sport})` }} aria-hidden="true" />
                  {getDisciplineMeta(sport).label}
                </span>
              ))}
            </div>
          </div>
          {/* F26: week total + delta as the chart's subtitle — the
              "+150 min vs last week" figure was the most interesting
              takeaway on the chart and it was floating unattached. */}
          <p className="mb-2.5 text-[11px] text-muted">
            <span className="tabular-nums text-[rgba(255,255,255,0.78)]">{Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m total</span>
            {volumeDelta !== null ? (
              <>
                {" · "}
                <span className={`tabular-nums ${volumeDelta > 0 ? "text-emerald-300" : volumeDelta < 0 ? "text-rose-300" : "text-muted"}`}>
                  {volumeDelta > 0 ? "▲ " : volumeDelta < 0 ? "▼ " : ""}
                  {volumeDelta > 0 ? `+${volumeDelta}` : volumeDelta}m vs last week
                </span>
              </>
            ) : null}
          </p>
          <div className="flex items-end gap-1.5">
            {(() => {
              // Estimate per-session stress using the duration+intent heuristic so
              // a short-hard Thursday is visually comparable to a long-easy Saturday.
              // Fall back to minutes when no session has a resolvable stress estimate.
              const sessionStress = (session: Session): number => {
                const sport = (session.sport ?? "other") as "run" | "bike" | "swim" | "strength";
                const tss = computeTssFromDuration(session.duration_minutes * 60, sport, session.intent_category ?? null);
                return tss ?? session.duration_minutes;
              };
              const dayStressTotals = weekDays.map((d) => d.sessions.reduce((sum, s) => sum + sessionStress(s), 0));
              const anyStress = dayStressTotals.some((v) => v > 0);
              const maxStress = Math.max(...dayStressTotals, 1);
              const maxMinutes = Math.max(...weekDays.map((d) => d.totalMinutes), 1);
              return weekDays.map((day, dayIndex) => {
                const dayStress = dayStressTotals[dayIndex];
                return (
                <div key={day.iso} className="flex flex-1 flex-col items-center gap-1">
                  <p className="text-[10px] tabular-nums text-tertiary" style={{ visibility: day.totalMinutes > 0 ? "visible" : "hidden" }}>
                    {anyStress ? Math.round(dayStress) : day.totalMinutes}
                  </p>
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: "48px" }}>
                    {(["swim", "bike", "run", "strength", "other"] as const).map((sport) => {
                      const sportSessions = day.sessions.filter((s) => s.sport === sport);
                      if (sportSessions.length === 0) return null;
                      const mins = sportSessions.reduce((sum, s) => sum + s.duration_minutes, 0);
                      const sportStress = sportSessions.reduce((sum, s) => sum + sessionStress(s), 0);
                      const heightPct = anyStress ? (sportStress / maxStress) * 100 : (mins / maxMinutes) * 100;
                      const colors: Record<string, string> = {
                        swim: "var(--color-swim)",
                        bike: "var(--color-bike)",
                        run: "var(--color-run)",
                        strength: "var(--color-strength)",
                        other: "rgba(255,255,255,0.25)"
                      };
                      return (
                        <div
                          key={sport}
                          title={`${sport} · ${mins} min · ~${Math.round(sportStress)} TSS`}
                          style={{ height: `${heightPct}%`, backgroundColor: colors[sport] }}
                        />
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-tertiary">{day.label}</p>
                </div>
                );
              });
            })()}
          </div>
          <p className="mt-1 text-[10px] text-tertiary">Bar height = estimated training stress (TSS) · color = sport.</p>
        </section>
      ) : null}

      {weekIntensitySummary && weekIntensitySummary.sessionCount > 0 ? (
        <section className="surface-subtle px-4 py-3">
          <p className="card-kicker mb-2">Intensity distribution</p>
          <WeeklyIntensityHeader summary={weekIntensitySummary} />
        </section>
      ) : null}

      {weekActionOpen ? (
        <div className="surface-subtle p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
            <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setDuplicateToast(null); startDuplicateTransition(async () => { await duplicateWeekForwardAction(fd); setDuplicateToast("Week duplicated"); setWeekActionOpen(false); }); }} className="space-y-2"><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><label className="label-base">Duplicate to week</label><select name="destinationWeekId" className="input-base" required>{duplicateTargets.map((week) => <option key={week.id} value={week.id}>Week {week.week_index} ({weekRangeLabel(week.week_start_date)})</option>)}</select><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="copyMetadata" defaultChecked /> Copy metadata</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="copySessions" defaultChecked /> Copy sessions</label><button disabled={isDuplicating} className="btn-secondary w-full text-xs">{isDuplicating ? "Duplicating…" : "Duplicate"}</button></form>
            <form action={shiftWeekAction} onSubmit={(event) => { if (!window.confirm("Shift this week and all sessions by +7 days?")) event.preventDefault(); }}><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><input type="hidden" name="direction" value="forward" /><button className="btn-secondary w-full text-xs">Shift +7d</button></form>
            <form action={shiftWeekAction} onSubmit={(event) => { if (!window.confirm("Shift this week and all sessions by -7 days?")) event.preventDefault(); }}><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><input type="hidden" name="direction" value="backward" /><button className="btn-secondary w-full text-xs">Shift -7d</button></form>
            <form action={deleteWeekAction} onSubmit={(event) => { if (!window.confirm("Delete this week and all sessions in it?")) event.preventDefault(); }}><input type="hidden" name="planId" value={selectedPlan.id} /><input type="hidden" name="weekId" value={selectedWeek.id} /><button className="btn-secondary w-full text-xs text-rose-200">Delete week</button></form>
          </div>
        </div>
      ) : null}

      {duplicateToast ? (
        <div className="px-3 py-2 text-xs text-success">{duplicateToast}</div>
      ) : null}

      <form id="week-details-form" action={updateWeekAction} className="hidden">
        <input type="hidden" name="planId" value={selectedPlan.id} />
        <input type="hidden" name="weekId" value={selectedWeek.id} />
        <input type="hidden" name="focus" value={weekDraft.focus} />
        <input type="hidden" name="targetMinutes" value={weekDraft.targetMinutes} />
        <input type="hidden" name="notes" value={weekDraft.notes} />
      </form>

      {/* F21: Week board removed. It duplicated Calendar's week grid while
          explicitly saying "use Calendar for scheduling" — so it was a
          lookup surface at best. Daily Load Shape (above) already shows
          the 7-column duration-by-sport summary in one row, which is
          the only thing Plan-view adds over Calendar. */}

      <details className="surface-subtle p-3">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-medium lg:min-h-0">Week notes & settings</summary>
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
        <div className="fixed inset-0 z-50 w-full overflow-y-auto border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-4 shadow-2xl sm:bottom-0 sm:left-auto sm:top-14 sm:max-w-md sm:p-5">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Add session</h3><button type="button" onClick={() => setQuickAddDay(null)} className="btn-secondary px-3 text-xs">Close</button></div>
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
        <div className="fixed inset-0 z-50 w-full overflow-y-auto border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-4 shadow-2xl sm:bottom-0 sm:left-auto sm:top-14 sm:max-w-md sm:p-5">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Edit session</h3><button type="button" onClick={() => setActiveSessionId(null)} className="btn-secondary px-3 text-xs">Close</button></div>
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
