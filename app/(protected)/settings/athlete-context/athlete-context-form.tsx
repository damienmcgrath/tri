"use client";

import { useState } from "react";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";

type Props = {
  snapshot: AthleteContextSnapshot;
  compact?: boolean;
};

function joinLines(values: string[]) {
  return values.join("\n");
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function AthleteContextForm({ snapshot, compact = false }: Props) {
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [experienceLevel, setExperienceLevel] = useState(snapshot.declared.experienceLevel.value ?? "");
  const [goalType, setGoalType] = useState(snapshot.goals.goalType ?? "");
  const [priorityEventName, setPriorityEventName] = useState(snapshot.goals.priorityEventName ?? "");
  const [priorityEventDate, setPriorityEventDate] = useState(snapshot.goals.priorityEventDate ?? "");
  const [limiters, setLimiters] = useState(joinLines(snapshot.declared.limiters.map((item) => item.value)));
  const [strongestDisciplines, setStrongestDisciplines] = useState(joinLines(snapshot.declared.strongestDisciplines));
  const [weakestDisciplines, setWeakestDisciplines] = useState(joinLines(snapshot.declared.weakestDisciplines));
  const [weeklyConstraints, setWeeklyConstraints] = useState(joinLines(snapshot.declared.weeklyConstraints));
  const [injuryNotes, setInjuryNotes] = useState(snapshot.declared.injuryNotes ?? "");
  const [coachingPreference, setCoachingPreference] = useState(snapshot.declared.coachingPreference ?? "");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/athlete-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          experienceLevel: experienceLevel || null,
          goalType: goalType || null,
          priorityEventName: priorityEventName || null,
          priorityEventDate: priorityEventDate || null,
          limiters: splitLines(limiters),
          strongestDisciplines: splitLines(strongestDisciplines),
          weakestDisciplines: splitLines(weakestDisciplines),
          weeklyConstraints: splitLines(weeklyConstraints),
          injuryNotes: injuryNotes || null,
          coachingPreference: coachingPreference || null
        })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not save athlete context.");
      }
      setMessage("Saved athlete context.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save athlete context.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className={`grid gap-3 ${compact ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3"}`}>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Experience level</span>
          <select value={experienceLevel} onChange={(event) => setExperienceLevel(event.target.value)} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2">
            <option value="">Select</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Goal type</span>
          <select value={goalType} onChange={(event) => setGoalType(event.target.value)} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2">
            <option value="">Select</option>
            <option value="finish">Finish</option>
            <option value="perform">Perform</option>
            <option value="qualify">Qualify</option>
            <option value="build">Build</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Coaching style</span>
          <select value={coachingPreference} onChange={(event) => setCoachingPreference(event.target.value)} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2">
            <option value="">Select</option>
            <option value="direct">Direct</option>
            <option value="balanced">Balanced</option>
            <option value="supportive">Supportive</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Priority event</span>
          <input value={priorityEventName} onChange={(event) => setPriorityEventName(event.target.value)} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Priority event date</span>
          <input type="date" value={priorityEventDate} onChange={(event) => setPriorityEventDate(event.target.value)} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2" />
        </label>
      </div>

      <div className={`grid gap-3 ${compact ? "md:grid-cols-2" : "md:grid-cols-2"}`}>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Biggest limiters</span>
          <textarea value={limiters} onChange={(event) => setLimiters(event.target.value)} rows={compact ? 3 : 4} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2" placeholder="One per line" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Weekly constraints</span>
          <textarea value={weeklyConstraints} onChange={(event) => setWeeklyConstraints(event.target.value)} rows={compact ? 3 : 4} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2" placeholder="One per line" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Strongest disciplines</span>
          <textarea value={strongestDisciplines} onChange={(event) => setStrongestDisciplines(event.target.value)} rows={compact ? 2 : 3} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2" placeholder="One per line" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Weakest disciplines</span>
          <textarea value={weakestDisciplines} onChange={(event) => setWeakestDisciplines(event.target.value)} rows={compact ? 2 : 3} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2" placeholder="One per line" />
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-muted">Injury or caution notes</span>
        <textarea value={injuryNotes} onChange={(event) => setInjuryNotes(event.target.value)} rows={3} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2" />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={isSaving} className="rounded-full bg-[hsl(var(--accent))] px-4 py-2 text-sm font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-60">
          {isSaving ? "Saving..." : compact ? "Save context" : "Save athlete context"}
        </button>
        {message ? <p className="text-sm text-muted">{message}</p> : null}
      </div>
    </form>
  );
}
