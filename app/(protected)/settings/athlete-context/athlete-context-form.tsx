"use client";

import { useEffect, useState } from "react";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { sortAthleteFtpHistory, type AthleteFtpHistoryEntry } from "@/lib/athlete-ftp";

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
    <>
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
        <button type="submit" disabled={isSaving} className="btn-primary disabled:opacity-60">
          {isSaving ? "Saving..." : compact ? "Save context" : "Save athlete context"}
        </button>
        {message ? <p className="text-sm text-muted">{message}</p> : null}
      </div>
    </form>

    <FtpSection initialFtp={snapshot.ftp} />
    </>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  ramp_test: "Ramp test",
  estimated: "Estimated"
};

function FtpSection({ initialFtp }: { initialFtp: AthleteContextSnapshot["ftp"] }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [history, setHistory] = useState<AthleteFtpHistoryEntry[]>([]);
  const [ftpValue, setFtpValue] = useState("");
  const [ftpSource, setFtpSource] = useState("manual");
  const [ftpNotes, setFtpNotes] = useState("");
  const [ftpDate, setFtpDate] = useState(todayIso);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    fetch("/api/athlete-ftp")
      .then((res) => res.json())
      .then((data: { history?: AthleteFtpHistoryEntry[] }) => {
        if (data.history) setHistory(sortAthleteFtpHistory(data.history));
      })
      .catch(() => {});
  }, []);

  const orderedHistory = sortAthleteFtpHistory(history);
  const currentFtp = orderedHistory[0] ?? (initialFtp ? { value: initialFtp.value, source: initialFtp.source, recorded_at: initialFtp.recordedAt, created_at: null, id: "", notes: null } : null);

  async function handleFtpSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const watts = parseInt(ftpValue, 10);
    if (isNaN(watts) || watts < 50 || watts > 1999) {
      setMessage("Enter a value between 50 and 1999 watts.");
      return;
    }
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/athlete-ftp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: watts, source: ftpSource, notes: ftpNotes || null, recorded_at: ftpDate })
      });
      const data = (await response.json()) as { error?: string; entry?: AthleteFtpHistoryEntry };
      if (!response.ok) throw new Error(data.error ?? "Could not save FTP.");
      if (data.entry) setHistory((prev) => sortAthleteFtpHistory([...prev, data.entry!]));
      setFtpValue("");
      setFtpNotes("");
      setFtpDate(todayIso);
      setMessage("FTP saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save FTP.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="border-t border-[hsl(var(--border))] pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Bike FTP</h3>
          {currentFtp ? (
            <p className="text-sm text-muted">
              Current: <span className="font-mono text-[hsl(var(--foreground))]">{currentFtp.value}W</span>
              {" "}· {SOURCE_LABELS[currentFtp.source] ?? currentFtp.source} · {currentFtp.recorded_at}
            </p>
          ) : (
            <p className="text-sm text-muted">Not set — add your FTP for power-zone guidance.</p>
          )}
        </div>
        {history.length > 1 ? (
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs text-muted underline-offset-2 hover:underline">
            {showHistory ? "Hide history" : `History (${history.length})`}
          </button>
        ) : null}
      </div>

      {showHistory && history.length > 1 ? (
        <ul className="space-y-1">
          {orderedHistory.slice(1).map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 text-sm text-muted font-mono">
              <span>{entry.recorded_at}</span>
              <span>{entry.value}W</span>
              <span className="font-sans">{SOURCE_LABELS[entry.source] ?? entry.source}</span>
              {entry.notes ? <span className="font-sans truncate max-w-xs">{entry.notes}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleFtpSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="text-muted">New FTP (watts)</span>
          <input
            type="number"
            min={50}
            max={1999}
            value={ftpValue}
            onChange={(e) => setFtpValue(e.target.value)}
            placeholder="e.g. 265"
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Source</span>
          <select value={ftpSource} onChange={(e) => setFtpSource(e.target.value)} className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2">
            <option value="manual">Manual</option>
            <option value="ramp_test">Ramp test</option>
            <option value="estimated">Estimated</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Date</span>
          <input
            type="date"
            value={ftpDate}
            onChange={(e) => setFtpDate(e.target.value)}
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Notes (optional)</span>
          <input
            value={ftpNotes}
            onChange={(e) => setFtpNotes(e.target.value)}
            placeholder="e.g. post base block"
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={isSaving || !ftpValue} className="btn-primary disabled:opacity-60">
            {isSaving ? "Saving..." : "Save FTP"}
          </button>
          {message ? <p className="text-sm text-muted">{message}</p> : null}
        </div>
      </form>
    </div>
  );
}
