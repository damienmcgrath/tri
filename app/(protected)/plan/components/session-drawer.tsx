"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "./sheet";
import {
  getIntentCategoriesForDiscipline,
  isCuratedIntent
} from "@/lib/training/intent-categories";
import { deleteSessionAction, updateSessionDetailsAction } from "../actions";

export type DrawerSession = {
  id: string;
  plan_id: string;
  week_id: string;
  date: string;
  sport: string;
  type: string;
  session_name: string | null;
  intent_category: string | null;
  duration_minutes: number;
  target: string | null;
  notes: string | null;
  session_role: string | null;
  is_key: boolean | null;
};

export type AdaptationEntry = {
  id: string;
  trigger_type: string;
  rationale_text: string;
  created_at: string;
};

type Discipline = "swim" | "bike" | "run" | "strength" | "other";

const DISCIPLINES: ReadonlyArray<{ value: Discipline; label: string }> = [
  { value: "swim", label: "Swim" },
  { value: "bike", label: "Bike" },
  { value: "run", label: "Run" },
  { value: "strength", label: "Strength" },
  { value: "other", label: "Multi" }
];

const ROLES: ReadonlyArray<{ value: "Key" | "Supporting" | "Recovery"; label: string }> = [
  { value: "Key", label: "Key" },
  { value: "Supporting", label: "Supporting" },
  { value: "Recovery", label: "Recovery" }
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

function formatDay(iso: string) {
  return dateFormatter.format(new Date(`${iso}T00:00:00.000Z`));
}

function normaliseDiscipline(value: string): Discipline {
  const lower = value.toLowerCase();
  if (lower === "swim" || lower === "bike" || lower === "run" || lower === "strength") {
    return lower;
  }
  return "other";
}

function normaliseRole(value: string | null | undefined): "Key" | "Supporting" | "Recovery" | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "key") return "Key";
  if (lower === "supporting") return "Supporting";
  if (lower === "recovery") return "Recovery";
  return null;
}

type FormState = {
  discipline: Discipline;
  intent: string;
  customIntent: string;
  name: string;
  duration: string;
  target: string;
  role: "Key" | "Supporting" | "Recovery" | null;
  notes: string;
};

function buildInitialState(session: DrawerSession): FormState {
  const discipline = normaliseDiscipline(session.sport ?? "");
  const intent = session.intent_category ?? "";
  const curated = isCuratedIntent(intent, discipline);
  return {
    discipline,
    intent: curated ? intent : intent.length > 0 ? "__custom__" : "",
    customIntent: curated ? "" : intent,
    name: session.session_name ?? "",
    duration: session.duration_minutes ? String(session.duration_minutes) : "",
    target: session.target ?? "",
    role: normaliseRole(session.session_role),
    notes: session.notes ?? ""
  };
}

function statesEqual(a: FormState, b: FormState): boolean {
  return (
    a.discipline === b.discipline &&
    a.intent === b.intent &&
    a.customIntent === b.customIntent &&
    a.name === b.name &&
    a.duration === b.duration &&
    a.target === b.target &&
    a.role === b.role &&
    a.notes === b.notes
  );
}

function resolvedIntent(state: FormState): string | null {
  if (state.intent === "__custom__") {
    const trimmed = state.customIntent.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return state.intent.length > 0 ? state.intent : null;
}

export type SessionDrawerProps = {
  session: DrawerSession | null;
  adaptations: AdaptationEntry[];
  open: boolean;
  onClose: () => void;
  onSaved: (next: DrawerSession) => void;
  onDeleted: (id: string) => void;
};

export function SessionDrawer({ session, adaptations, open, onClose, onSaved, onDeleted }: SessionDrawerProps) {
  const initialRef = useRef<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [pendingClose, setPendingClose] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !session) {
      initialRef.current = null;
      setForm(null);
      setPendingClose(false);
      setPendingDelete(false);
      setError(null);
      return;
    }
    const initial = buildInitialState(session);
    initialRef.current = initial;
    setForm(initial);
    setPendingClose(false);
    setPendingDelete(false);
    setError(null);
  }, [open, session]);

  const isDirty = useMemo(() => {
    if (!form || !initialRef.current) return false;
    return !statesEqual(form, initialRef.current);
  }, [form]);

  const intentOptions = useMemo(
    () => (form ? getIntentCategoriesForDiscipline(form.discipline) : []),
    [form]
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function handleClose() {
    if (isDirty) {
      setPendingClose(true);
      return;
    }
    onClose();
  }

  function discardAndClose() {
    setPendingClose(false);
    onClose();
  }

  async function handleSave() {
    if (!session || !form) return;
    const duration = Number.parseInt(form.duration, 10);
    if (!Number.isFinite(duration) || duration < 1 || duration > 1440) {
      setError("Duration must be between 1 and 1440 minutes.");
      return;
    }
    setSaving(true);
    setError(null);

    const optimistic: DrawerSession = {
      ...session,
      sport: form.discipline,
      type: form.name.trim() || form.discipline.charAt(0).toUpperCase() + form.discipline.slice(1),
      session_name: form.name.trim() || null,
      intent_category: resolvedIntent(form),
      duration_minutes: duration,
      target: form.target.trim() || null,
      notes: form.notes.trim() || null,
      session_role: form.role,
      is_key: form.role === "Key"
    };

    try {
      await updateSessionDetailsAction({
        sessionId: session.id,
        planId: session.plan_id,
        weekId: session.week_id,
        sport: form.discipline,
        sessionName: optimistic.session_name,
        intentCategory: optimistic.intent_category,
        durationMinutes: duration,
        target: optimistic.target,
        notes: optimistic.notes,
        sessionRole: form.role
      });
      onSaved(optimistic);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save session.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!session) return;
    setDeleting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("sessionId", session.id);
      await deleteSessionAction(formData);
      onDeleted(session.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete session.");
      setPendingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet open={open} onClose={handleClose} ariaLabel="Session details">
      {session && form ? (
        <>
          <header className="flex items-start justify-between gap-3 border-b border-[rgba(255,255,255,0.08)] px-4 py-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-tertiary">Session</div>
              <div className="text-sm font-semibold text-white">{formatDay(session.date)}</div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close session details"
              className="rounded-md px-2 py-1 text-tertiary hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
            >
              ✕
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-5">
              <Field label="Discipline">
                <div role="radiogroup" aria-label="Discipline" className="flex flex-wrap gap-1">
                  {DISCIPLINES.map((opt) => {
                    const active = form.discipline === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => update("discipline", opt.value)}
                        className={`rounded-md border px-2.5 py-1 text-xs ${
                          active
                            ? "border-[rgba(190,255,0,0.5)] bg-[rgba(190,255,0,0.1)] text-white"
                            : "border-[rgba(255,255,255,0.1)] text-secondary hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Type / Intent" htmlFor="drawer-intent">
                <select
                  id="drawer-intent"
                  value={form.intent}
                  onChange={(event) => update("intent", event.target.value)}
                  className="w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-2 py-1.5 text-sm text-white focus:border-[rgba(190,255,0,0.5)] focus:outline-none"
                >
                  <option value="">— Select —</option>
                  {intentOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value="__custom__">Other…</option>
                </select>
                {form.intent === "__custom__" ? (
                  <input
                    type="text"
                    aria-label="Custom intent"
                    placeholder="Describe the session intent"
                    value={form.customIntent}
                    onChange={(event) => update("customIntent", event.target.value)}
                    className="mt-2 w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-2 py-1.5 text-sm text-white focus:border-[rgba(190,255,0,0.5)] focus:outline-none"
                  />
                ) : null}
              </Field>

              <Field label="Name" htmlFor="drawer-name">
                <input
                  id="drawer-name"
                  type="text"
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="Auto-suggested from type + discipline"
                  className="w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-2 py-1.5 text-sm text-white focus:border-[rgba(190,255,0,0.5)] focus:outline-none"
                />
              </Field>

              <Field label="Duration (minutes)" htmlFor="drawer-duration">
                <input
                  id="drawer-duration"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  value={form.duration}
                  onChange={(event) => update("duration", event.target.value)}
                  className="w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-2 py-1.5 text-sm text-white focus:border-[rgba(190,255,0,0.5)] focus:outline-none"
                />
              </Field>

              <Field label="Target / Structure" htmlFor="drawer-target">
                <textarea
                  id="drawer-target"
                  rows={3}
                  value={form.target}
                  onChange={(event) => update("target", event.target.value)}
                  placeholder="e.g. 3 × 8 min @ threshold w/ 3 min jog"
                  className="w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-2 py-1.5 text-sm text-white focus:border-[rgba(190,255,0,0.5)] focus:outline-none"
                />
              </Field>

              <Field label="Role">
                <div role="radiogroup" aria-label="Role" className="flex flex-wrap gap-1">
                  {ROLES.map((opt) => {
                    const active = form.role === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => update("role", active ? null : opt.value)}
                        className={`rounded-md border px-2.5 py-1 text-xs ${
                          active
                            ? "border-[rgba(190,255,0,0.5)] bg-[rgba(190,255,0,0.1)] text-white"
                            : "border-[rgba(255,255,255,0.1)] text-secondary hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Notes" htmlFor="drawer-notes">
                <textarea
                  id="drawer-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(event) => update("notes", event.target.value)}
                  className="w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-2 py-1.5 text-sm text-white focus:border-[rgba(190,255,0,0.5)] focus:outline-none"
                />
              </Field>

              {adaptations.length > 0 ? (
                <section aria-label="Adaptation log" className="space-y-2 rounded-md border border-[rgba(140,200,255,0.2)] bg-[rgba(140,200,255,0.04)] p-3">
                  <div className="text-[10px] uppercase tracking-wide text-[rgba(140,200,255,0.85)]">
                    Coach notes
                  </div>
                  <ul className="space-y-2">
                    {adaptations.map((entry) => (
                      <li key={entry.id} className="text-xs text-secondary">
                        <div className="font-mono text-[10px] uppercase tracking-wide text-tertiary">
                          {entry.trigger_type.replace(/_/g, " ")}
                        </div>
                        <div className="mt-0.5 text-white">{entry.rationale_text}</div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {error ? (
                <div role="alert" className="rounded-md border border-[rgba(255,80,80,0.4)] bg-[rgba(255,80,80,0.1)] px-3 py-2 text-xs text-[rgba(255,180,180,0.95)]">
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <footer className="border-t border-[rgba(255,255,255,0.08)] px-4 py-3">
            {pendingClose ? (
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-secondary">Discard unsaved changes?</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingClose(false)}
                    className="rounded-md border border-[rgba(255,255,255,0.1)] px-2.5 py-1 text-xs text-secondary hover:bg-[rgba(255,255,255,0.04)]"
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    onClick={discardAndClose}
                    className="rounded-md border border-[rgba(255,80,80,0.4)] bg-[rgba(255,80,80,0.1)] px-2.5 py-1 text-xs text-[rgba(255,180,180,0.95)]"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : pendingDelete ? (
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-secondary">Delete this session?</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingDelete(false)}
                    className="rounded-md border border-[rgba(255,255,255,0.1)] px-2.5 py-1 text-xs text-secondary hover:bg-[rgba(255,255,255,0.04)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="rounded-md border border-[rgba(255,80,80,0.4)] bg-[rgba(255,80,80,0.15)] px-2.5 py-1 text-xs text-[rgba(255,180,180,0.95)] disabled:opacity-50"
                  >
                    {deleting ? "Deleting…" : "Confirm delete"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !isDirty}
                    className="rounded-md border border-[rgba(190,255,0,0.5)] bg-[rgba(190,255,0,0.15)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(true)}
                    className="rounded-md border border-[rgba(255,80,80,0.4)] px-3 py-1.5 text-xs text-[rgba(255,180,180,0.95)] hover:bg-[rgba(255,80,80,0.08)]"
                  >
                    Delete
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-md border border-[rgba(255,255,255,0.1)] px-3 py-1.5 text-xs text-secondary hover:bg-[rgba(255,255,255,0.04)]"
                >
                  Cancel
                </button>
              </div>
            )}
          </footer>
        </>
      ) : null}
    </Sheet>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[10px] font-medium uppercase tracking-wide text-tertiary"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
