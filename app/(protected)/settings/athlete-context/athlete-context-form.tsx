"use client";

import { useEffect, useState } from "react";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { sortAthleteFtpHistory, type AthleteFtpHistoryEntry } from "@/lib/athlete-ftp";
import { FtpChart } from "./components/ftp-chart";

// ── helpers ──────────────────────────────────────────────────────────────────

function splitLines(value: string) {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function countLines(value: string) {
  return splitLines(value).length;
}

function joinLines(values: string[]) {
  return values.join("\n");
}

const DISCIPLINES = ["Swim", "Bike", "Run", "Strength"] as const;
type Discipline = (typeof DISCIPLINES)[number];

function parseDisciplines(values: string[]): Discipline[] {
  return values
    .map((v) => DISCIPLINES.find((d) => d.toLowerCase() === v.toLowerCase()))
    .filter((d): d is Discipline => d !== undefined);
}

// ── shared input class ───────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm";
// [color-scheme:dark] makes native date pickers render in dark mode
const dateCls = `${inputCls} [color-scheme:dark]`;

// ── section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="shrink-0 text-xs uppercase tracking-[0.14em] text-zinc-500">
        {children}
      </span>
      <div className="h-px flex-1 bg-[hsl(var(--border))]" />
    </div>
  );
}

// ── coaching style radio cards ───────────────────────────────────────────────

const COACHING_OPTIONS = [
  {
    value: "direct",
    label: "Direct",
    description: "Concise feedback, clear prescriptions, minimal hand-holding",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Mix of analysis and encouragement, adapts to context",
  },
  {
    value: "supportive",
    label: "Supportive",
    description: "Motivational framing, acknowledges effort alongside metrics",
  },
] as const;

function CoachingStyleCards({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5 text-sm">
      <span className="text-muted">Coaching style</span>
      <div className="grid grid-cols-3 gap-2">
        {COACHING_OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(active ? "" : opt.value)}
              style={active ? { backgroundColor: "hsl(var(--accent) / 0.08)" } : undefined}
              className={`rounded-xl border p-3 text-left transition-colors ${
                active
                  ? "border-[hsl(var(--accent))]"
                  : "border-[hsl(var(--border))] hover:border-zinc-500"
              }`}
            >
              <p
                className={`mb-1 text-sm font-medium ${
                  active ? "text-[hsl(var(--accent))]" : ""
                }`}
              >
                {opt.label}
              </p>
              <p className="text-xs leading-snug text-muted">{opt.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── discipline chips ─────────────────────────────────────────────────────────

function DisciplineChips({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: Discipline[];
  onChange: (next: Discipline[]) => void;
}) {
  function toggle(d: Discipline) {
    onChange(
      selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d]
    );
  }
  return (
    <div className="space-y-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex flex-wrap gap-2">
        {DISCIPLINES.map((d) => {
          const active = selected.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggle(d)}
              className={`rounded-full border px-3.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-black"
                  : "border-[hsl(var(--border))] text-muted hover:border-zinc-500 hover:text-[hsl(var(--foreground))]"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── counted textarea ─────────────────────────────────────────────────────────

function CountedTextarea({
  label,
  value,
  onChange,
  rows = 4,
  max,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  max: number;
  placeholder?: string;
}) {
  const count = countLines(value);
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted">{label}</span>
        {count > 0 && (
          <span
            className={`tabular-nums text-xs ${
              count >= max ? "text-[hsl(var(--danger))]" : "text-muted"
            }`}
          >
            {count}/{max}
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={`${inputCls} resize-none`}
      />
    </div>
  );
}

// ── injury notes (collapsible when empty) ────────────────────────────────────

function InjuryNotes({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(!!value);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-sm text-muted underline-offset-2 transition-colors hover:text-[hsl(var(--foreground))] hover:underline"
      >
        + Add injury or caution notes
      </button>
    );
  }

  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted">Injury or caution notes</span>
        {!value && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs text-muted transition-colors hover:text-[hsl(var(--foreground))]"
          >
            Cancel
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={600}
        placeholder="Current injuries, areas to avoid, movement restrictions…"
        className={`${inputCls} resize-none`}
        autoFocus
      />
      {value.length > 0 && (
        <p className="text-right text-xs tabular-nums text-muted">{value.length}/600</p>
      )}
    </div>
  );
}

// ── completeness bar ─────────────────────────────────────────────────────────

function CompletenessBar({
  experienceLevel,
  goalType,
  coachingPreference,
  priorityEventName,
  priorityEventDate,
  limiters,
  weeklyConstraints,
}: {
  experienceLevel: string;
  goalType: string;
  coachingPreference: string;
  priorityEventName: string;
  priorityEventDate: string;
  limiters: string;
  weeklyConstraints: string;
}) {
  const fields = [
    experienceLevel,
    goalType,
    coachingPreference,
    priorityEventName,
    priorityEventDate,
    limiters.trim(),
    weeklyConstraints.trim(),
  ];
  const total = fields.length;
  const filled = fields.filter(Boolean).length;
  if (filled === total) return null;
  const pct = Math.round((filled / total) * 100);
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[hsl(var(--border))]">
        <div
          className="h-full rounded-full bg-[hsl(var(--accent))] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums">
        {filled}/{total} fields set
      </span>
    </div>
  );
}

// ── athlete context form ─────────────────────────────────────────────────────

type Props = {
  snapshot: AthleteContextSnapshot;
  compact?: boolean;
};

export function AthleteContextForm({ snapshot, compact = false }: Props) {
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [experienceLevel, setExperienceLevel] = useState(
    snapshot.declared.experienceLevel.value ?? ""
  );
  const [goalType, setGoalType] = useState(snapshot.goals.goalType ?? "");
  const [priorityEventName, setPriorityEventName] = useState(
    snapshot.goals.priorityEventName ?? ""
  );
  const [priorityEventDate, setPriorityEventDate] = useState(
    snapshot.goals.priorityEventDate ?? ""
  );
  const [limiters, setLimiters] = useState(
    joinLines(snapshot.declared.limiters.map((item) => item.value))
  );
  const [strongestDisciplines, setStrongestDisciplines] = useState<Discipline[]>(
    parseDisciplines(snapshot.declared.strongestDisciplines)
  );
  const [weakestDisciplines, setWeakestDisciplines] = useState<Discipline[]>(
    parseDisciplines(snapshot.declared.weakestDisciplines)
  );
  const [weeklyConstraints, setWeeklyConstraints] = useState(
    joinLines(snapshot.declared.weeklyConstraints)
  );
  const [injuryNotes, setInjuryNotes] = useState(
    snapshot.declared.injuryNotes ?? ""
  );
  const [coachingPreference, setCoachingPreference] = useState(
    snapshot.declared.coachingPreference ?? ""
  );

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
          strongestDisciplines,
          weakestDisciplines,
          weeklyConstraints: splitLines(weeklyConstraints),
          injuryNotes: injuryNotes || null,
          coachingPreference: coachingPreference || null,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save athlete context.");
      setMessage("Saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save athlete context."
      );
    } finally {
      setIsSaving(false);
    }
  }

  const colGrid = compact ? "grid-cols-1 sm:grid-cols-2" : "sm:grid-cols-2";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── Racing Profile ──────────────────────────────────────────────────── */}
      <SectionLabel>Racing Profile</SectionLabel>

      <div className={`grid gap-3 ${colGrid}`}>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Experience level</span>
          <select
            value={experienceLevel}
            onChange={(e) => setExperienceLevel(e.target.value)}
            className={inputCls}
          >
            <option value="">Select</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Goal type</span>
          <select
            value={goalType}
            onChange={(e) => setGoalType(e.target.value)}
            className={inputCls}
          >
            <option value="">Select</option>
            <option value="finish">Finish</option>
            <option value="perform">Perform</option>
            <option value="qualify">Qualify</option>
            <option value="build">Build</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Priority event</span>
          <input
            value={priorityEventName}
            onChange={(e) => setPriorityEventName(e.target.value)}
            placeholder="e.g. Warsaw 70.3"
            className={inputCls}
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Priority event date</span>
          <input
            type="date"
            value={priorityEventDate}
            onChange={(e) => setPriorityEventDate(e.target.value)}
            className={dateCls}
          />
        </label>
      </div>

      {compact ? (
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Coaching style</span>
          <select
            value={coachingPreference}
            onChange={(e) => setCoachingPreference(e.target.value)}
            className={inputCls}
          >
            <option value="">Select</option>
            {COACHING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <CoachingStyleCards value={coachingPreference} onChange={setCoachingPreference} />
      )}

      {/* ── Training Profile ────────────────────────────────────────────────── */}
      <SectionLabel>Training Profile</SectionLabel>

      <div className={`grid gap-3 ${colGrid}`}>
        <CountedTextarea
          label="Biggest limiters"
          value={limiters}
          onChange={setLimiters}
          rows={compact ? 3 : 4}
          max={8}
          placeholder="One per line (e.g. Open water anxiety)"
        />
        <CountedTextarea
          label="Weekly constraints"
          value={weeklyConstraints}
          onChange={setWeeklyConstraints}
          rows={compact ? 3 : 4}
          max={8}
          placeholder="One per line (e.g. Can't train Tuesday evenings)"
        />
      </div>

      <div className={`grid gap-4 ${colGrid}`}>
        <DisciplineChips
          label="Strongest disciplines"
          selected={strongestDisciplines}
          onChange={setStrongestDisciplines}
        />
        <DisciplineChips
          label="Weakest disciplines"
          selected={weakestDisciplines}
          onChange={setWeakestDisciplines}
        />
      </div>

      {/* ── Health Notes ────────────────────────────────────────────────────── */}
      <SectionLabel>Health Notes</SectionLabel>
      <InjuryNotes value={injuryNotes} onChange={setInjuryNotes} />

      {/* ── save ────────────────────────────────────────────────────────────── */}
      <div className="space-y-3 pt-1">
        <CompletenessBar
          experienceLevel={experienceLevel}
          goalType={goalType}
          coachingPreference={coachingPreference}
          priorityEventName={priorityEventName}
          priorityEventDate={priorityEventDate}
          limiters={limiters}
          weeklyConstraints={weeklyConstraints}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="btn-primary disabled:opacity-60"
          >
            {isSaving ? "Saving..." : compact ? "Save context" : "Save athlete context"}
          </button>
          {message ? <p className="text-sm text-muted">{message}</p> : null}
        </div>
      </div>
    </form>
  );
}

// ── FTP section (exported — rendered as its own card in page.tsx) ─────────────

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  ramp_test: "Ramp test",
  estimated: "Estimated",
};

export function FtpSection({
  initialFtp,
}: {
  initialFtp: AthleteContextSnapshot["ftp"];
}) {
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

  const currentFtp =
    history[0] ??
    (initialFtp
      ? {
          value: initialFtp.value,
          source: initialFtp.source,
          recorded_at: initialFtp.recordedAt,
          created_at: null,
          id: "",
          notes: null,
        }
      : null);

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
        body: JSON.stringify({
          value: watts,
          source: ftpSource,
          notes: ftpNotes || null,
          recorded_at: ftpDate,
        }),
      });
      const data = (await response.json()) as { error?: string; entry?: AthleteFtpHistoryEntry };
      if (!response.ok) throw new Error(data.error ?? "Could not save FTP.");
      if (data.entry) setHistory((prev) => sortAthleteFtpHistory([...prev, data.entry!]));
      setFtpValue("");
      setFtpNotes("");
      setFtpDate(todayIso);
      setMessage("FTP logged.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save FTP.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-accent mb-1">
            Physical Metrics
          </p>
          <h3 className="text-sm font-medium">Bike FTP</h3>
          {currentFtp ? (
            <p className="mt-0.5 text-sm text-muted">
              Current:{" "}
              <span className="font-mono text-[hsl(var(--foreground))]">
                {currentFtp.value}W
              </span>{" "}
              · {SOURCE_LABELS[currentFtp.source] ?? currentFtp.source} ·{" "}
              {currentFtp.recorded_at}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-muted">
              Not set — add your FTP for power-zone guidance.
            </p>
          )}
        </div>
        {history.length > 1 && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="shrink-0 text-xs text-muted underline-offset-2 hover:underline"
          >
            {showHistory ? "Hide history" : `History (${history.length})`}
          </button>
        )}
      </div>

      {/* FTP trend chart */}
      {history.length > 0 && <FtpChart entries={history} />}

      {/* history table with deltas */}
      {showHistory && history.length > 1 && (
        <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))]">
                <th className="px-3 py-2 text-left font-normal text-muted">Date</th>
                <th className="px-3 py-2 text-right font-normal text-muted">FTP</th>
                <th className="px-3 py-2 text-right font-normal text-muted">Change</th>
                <th className="px-3 py-2 text-left font-normal text-muted">Source</th>
                <th className="hidden px-3 py-2 text-left font-normal text-muted sm:table-cell">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry, i) => {
                const delta =
                  i < history.length - 1
                    ? entry.value - history[i + 1].value
                    : null;
                return (
                  <tr
                    key={entry.id}
                    className="border-b border-[hsl(var(--border))] last:border-0"
                  >
                    <td className="px-3 py-2 font-mono text-muted">
                      {entry.recorded_at}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-medium">
                      {entry.value}W
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {delta !== null ? (
                        <span
                          className={
                            delta > 0
                              ? "text-[hsl(var(--success))]"
                              : delta < 0
                                ? "text-[hsl(var(--danger))]"
                                : "text-muted"
                          }
                        >
                          {delta > 0 ? "+" : ""}
                          {delta}W
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {SOURCE_LABELS[entry.source] ?? entry.source}
                    </td>
                    <td className="hidden px-3 py-2 text-muted sm:table-cell">
                      {entry.notes ? (
                        <span className="block max-w-[160px] truncate">
                          {entry.notes}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* log new reading */}
      <form onSubmit={handleFtpSubmit} className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
          {currentFtp ? "Log new reading" : "Set FTP"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Watts</span>
            <input
              type="number"
              min={50}
              max={1999}
              value={ftpValue}
              onChange={(e) => setFtpValue(e.target.value)}
              placeholder="e.g. 265"
              className={inputCls}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Source</span>
            <select
              value={ftpSource}
              onChange={(e) => setFtpSource(e.target.value)}
              className={inputCls}
            >
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
              className={dateCls}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Notes (optional)</span>
            <input
              value={ftpNotes}
              onChange={(e) => setFtpNotes(e.target.value)}
              placeholder="e.g. post base block"
              className={inputCls}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSaving || !ftpValue}
            className="btn-primary disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Log FTP"}
          </button>
          {message && <p className="text-sm text-muted">{message}</p>}
        </div>
      </form>
    </div>
  );
}
