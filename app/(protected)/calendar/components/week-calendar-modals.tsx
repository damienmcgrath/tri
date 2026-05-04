"use client";

/**
 * Modal + sheet components extracted from week-calendar.tsx so the parent
 * stays focused on the day-grid and adaptation logic. Each modal is a
 * top-level client component that takes its dependencies via props.
 *
 * Shared overlay primitives (TaskOverlay / TaskSheet / TaskModal) live here
 * because they are only used by these modals; if a future caller needs them
 * they can be promoted into a shared `task-modal.tsx`.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { getSessionDisplayName } from "@/lib/training/session";
import { markActivityExtraAction, quickAddSessionAction } from "@/app/(protected)/calendar/actions";
import { linkActivityAction } from "@/app/(protected)/activities/[activityId]/actions";
import type { CalendarSession, WeekDay } from "./week-calendar-types";

const uploadDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});

function getActivityId(sessionId: string) {
  return sessionId.startsWith("activity-") ? sessionId.slice("activity-".length) : null;
}

function getSessionTitle(session: CalendarSession) {
  return getSessionDisplayName({
    sessionName: session.sessionName,
    discipline: session.discipline ?? session.sport,
    sport: session.sport,
    subtype: session.subtype,
    workoutType: session.workoutType,
    type: session.type
  });
}

function getSuggestedSessionId(upload: CalendarSession, candidateSessions: CalendarSession[]) {
  const sameDay = candidateSessions.filter((session) => session.date === upload.date);
  const sameSport = sameDay.find((session) => session.sport === upload.sport);
  if (sameSport) return sameSport.id;
  const anyOnDay = sameDay[0];
  if (anyOnDay) return anyOnDay.id;
  return candidateSessions[0]?.id ?? "";
}

export function QuickAddModal({
  initialDate,
  weekDays,
  onClose
}: {
  initialDate: string;
  weekDays: WeekDay[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ date: initialDate, sport: "run", type: "", duration: "45", notes: "" });

  return (
    <TaskModal onClose={onClose} title="Add session" description="Create a planned workout for this week.">
      <form
        className="space-y-3"
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
        <select value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm">
          {weekDays.map((day) => <option key={day.iso} value={day.iso}>{day.weekday} · {day.label}</option>)}
        </select>
        <select value={form.sport} onChange={(e) => setForm((prev) => ({ ...prev, sport: e.target.value }))} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm">
          <option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option><option value="strength">Strength</option>
        </select>
        <input value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))} placeholder="Workout title (optional)" className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm" />
        <input value={form.duration} onChange={(e) => setForm((prev) => ({ ...prev, duration: e.target.value }))} type="number" min={1} max={300} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2 border-t border-[hsl(var(--border))] pt-3">
          <button type="button" onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button disabled={isPending} className="btn-primary px-2 py-1 text-xs">Save</button>
        </div>
      </form>
    </TaskModal>
  );
}

export function MoveModal({
  session,
  weekDays,
  onClose,
  onMove
}: {
  session: CalendarSession;
  weekDays: WeekDay[];
  onClose: () => void;
  onMove: (session: CalendarSession, newDate: string) => void;
}) {
  const [date, setDate] = useState(session.date);
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    <TaskSheet onClose={onClose} title={`Move ${getSessionTitle(session)}`} description="Move this planned session to a different day this week.">
      <div className="space-y-3">
        <select value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm">
          {weekDays.map((day) => (
            <option key={day.iso} value={day.iso}>
              {day.weekday} · {day.label}
              {day.iso >= todayIso ? " · open" : ""}
            </option>
          ))}
        </select>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] pt-3">
          <button type="button" onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button type="button" onClick={() => { onMove(session, date); onClose(); }} className="btn-primary px-2 py-1 text-xs">Move here</button>
        </div>
      </div>
    </TaskSheet>
  );
}

export function AssignUploadModal({
  upload,
  weekDays,
  candidateSessions,
  onClose,
  onAssigned,
  onMarkedExtra,
  onError
}: {
  upload: CalendarSession;
  weekDays: WeekDay[];
  candidateSessions: CalendarSession[];
  onClose: () => void;
  onAssigned: (selectedSessionId: string) => void;
  onMarkedExtra: () => void;
  onError: () => void;
}) {
  const [selectedSessionId, setSelectedSessionId] = useState(() => getSuggestedSessionId(upload, candidateSessions));
  const [isAssigning, setIsAssigning] = useState(false);
  const [isMarkingExtra, setIsMarkingExtra] = useState(false);

  useEffect(() => {
    setSelectedSessionId(getSuggestedSessionId(upload, candidateSessions));
  }, [candidateSessions, upload]);

  return (
    <TaskSheet
      onClose={onClose}
      title="Upload needs review"
      description="Choose where this workout belongs in your calendar."
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-[hsl(var(--accent-performance)/0.3)] bg-[hsl(var(--accent-performance)/0.08)] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Uploaded workout</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {getDisciplineMeta(upload.sport).label} · {upload.duration} min
          </p>
          <p className="mt-1 text-xs text-muted">Logged {uploadDateFormatter.format(new Date(`${upload.created_at}`))}</p>
        </div>
        {candidateSessions.length === 0 ? (
          <p className="text-xs text-muted">No planned sessions in this week. Add or move a planned session first.</p>
        ) : (
          <select value={selectedSessionId} onChange={(e) => setSelectedSessionId(e.target.value)} className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm">
            {candidateSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {(weekDays.find((day) => day.iso === session.date)?.weekday ?? session.date)} · {getSessionTitle(session)} · {session.duration} min
              </option>
            ))}
          </select>
        )}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
          <p className="text-xs font-medium text-white">Mark as extra / unplanned</p>
          <p className="mt-1 text-xs text-muted">This workout wasn&apos;t part of your training plan.</p>
          <button
            type="button"
            disabled={isMarkingExtra || isAssigning}
            onClick={async () => {
              const activityId = getActivityId(upload.id);
              if (!activityId) { onError(); return; }
              setIsMarkingExtra(true);
              try {
                await markActivityExtraAction({ activityId });
                onMarkedExtra();
              } catch {
                onError();
              } finally {
                setIsMarkingExtra(false);
              }
            }}
            className="btn-secondary mt-2 px-2 py-1 text-xs"
          >
            {isMarkingExtra ? "Saving…" : "Mark as extra"}
          </button>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] pt-3">
          <button type="button" onClick={onClose} className="btn-secondary px-2 py-1 text-xs">Cancel</button>
          <button
            type="button"
            disabled={isAssigning || isMarkingExtra || !selectedSessionId || candidateSessions.length === 0}
            onClick={async () => {
              if (!selectedSessionId) return;
              setIsAssigning(true);
              try {
                if (upload.source?.uploadId) {
                  // FIT/TCX upload — use the upload attach API
                  const response = await fetch(`/api/uploads/activities/${upload.source.uploadId}/attach`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ plannedSessionId: selectedSessionId, actor: "athlete", mode: "override" })
                  });
                  if (!response.ok) throw new Error("failed");
                } else {
                  // Strava import or other source — use the direct link action
                  const activityId = getActivityId(upload.id);
                  if (!activityId) throw new Error("no activity id");
                  const result = await linkActivityAction(activityId, selectedSessionId);
                  if (result.error) throw new Error(result.error);
                }
                onAssigned(selectedSessionId);
              } catch {
                onError();
              } finally {
                setIsAssigning(false);
              }
            }}
            className="btn-primary px-2 py-1 text-xs"
          >
            {isAssigning ? "Assigning…" : "Assign to session"}
          </button>
        </div>
      </div>
    </TaskSheet>
  );
}

export function DetailsModal({ session, onClose }: { session: CalendarSession; onClose: () => void }) {
  const state = session.displayType === "completed_activity" ? "Extra workout" : session.status;
  const executionScoreRaw = session.executionResult?.executionScore ?? session.executionResult?.execution_score;
  const executionScore = typeof executionScoreRaw === "number" ? Math.round(executionScoreRaw) : null;
  const executionScoreBandRaw = session.executionResult?.executionScoreBand ?? session.executionResult?.execution_score_band;
  const executionScoreBand = typeof executionScoreBandRaw === "string" ? executionScoreBandRaw : null;
  const executionSummary = session.executionResult?.executionScoreSummary ?? session.executionResult?.summary;
  const nextAction = session.executionResult?.recommendedNextAction ?? session.executionResult?.recommended_next_action;
  const provisional = Boolean(session.executionResult?.executionScoreProvisional ?? session.executionResult?.execution_score_provisional);
  const [markingExtra, setMarkingExtra] = useState(false);
  const [markedExtra, setMarkedExtra] = useState(false);

  return (
    <TaskSheet
      onClose={onClose}
      title={getSessionTitle(session)}
      description={`${getDisciplineMeta(session.sport).label} · ${session.duration} min`}
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">Status: {state}</p>
        {executionScore !== null && executionScoreBand ? (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Execution Score</p>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${
                  executionScoreBand === "On target"
                    ? "border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))]"
                    : executionScoreBand === "Partial match"
                      ? "border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] text-[hsl(var(--warning))]"
                      : "border-[hsl(var(--danger)/0.3)] bg-[hsl(var(--danger)/0.08)] text-[hsl(var(--danger))]"
                }`}
              >
                {executionScoreBand}
              </span>
            </div>
            <p className="mt-1 text-base font-semibold text-white">{executionScore} · {executionScoreBand}{provisional ? " · Provisional" : ""}</p>
            {(executionSummary || nextAction) ? (
              <div className="mt-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-2.5 py-2">
                {executionSummary ? <p className="text-xs text-muted">{executionSummary}</p> : null}
                {nextAction ? <p className="mt-1 text-xs font-medium text-white">Next step: {nextAction}</p> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <p className="text-xs text-muted">Detailed execution scoring is still provisional. Use schedule status and session notes for now.</p>
          </div>
        )}
        {session.notes ? <p className="rounded-lg bg-[hsl(var(--surface-subtle))] p-2 text-xs text-muted">{session.notes}</p> : null}
        {session.displayType === "completed_activity" ? (
          <div className="pt-1">
            {markedExtra ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(52,211,153,0.25)] bg-[rgba(52,211,153,0.12)] px-3 py-1.5 text-xs font-medium text-success">
                <span aria-hidden="true">✓</span> Marked as extra
              </span>
            ) : (
              <button
                type="button"
                disabled={markingExtra}
                onClick={async () => {
                  const activityId = getActivityId(session.id);
                  if (!activityId) { setMarkingExtra(false); return; }
                  setMarkingExtra(true);
                  try {
                    await markActivityExtraAction({ activityId });
                    setMarkedExtra(true);
                  } catch {
                    setMarkingExtra(false);
                  }
                }}
                className="rounded-full border border-[rgba(255,255,255,0.16)] bg-transparent px-3 py-1.5 text-xs text-muted transition hover:border-[rgba(255,255,255,0.3)] hover:text-foreground disabled:opacity-50"
              >
                {markingExtra ? "Marking…" : "Mark as extra"}
              </button>
            )}
          </div>
        ) : null}
        <div className="sticky bottom-0 pt-2 text-right">
          <button onClick={onClose} className="btn-secondary px-3 text-xs">Close</button>
        </div>
      </div>
    </TaskSheet>
  );
}

function TaskOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-black/55 backdrop-blur-[2px]">
      <button type="button" aria-label="Close overlay" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} />
      {children}
    </div>
  );
}

function TaskSheet({ children, title, description, onClose }: { children: React.ReactNode; title: string; description?: string; onClose: () => void }) {
  return (
    <TaskOverlay onClose={onClose}>
      <aside className="relative ml-auto flex h-[100dvh] w-full flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl sm:max-w-xl">
        <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle)/0.22)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Calendar task</p>
              <p className="mt-1 text-base font-semibold">{title}</p>
              {description ? (
                <p className="mt-2 max-w-md rounded-lg border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--bg-elevated)/0.82)] px-3 py-2 text-xs text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] rounded-md border border-[hsl(var(--border))] px-3 text-xs text-muted hover:text-foreground lg:min-h-0 lg:min-w-0 lg:px-2 lg:py-1">Close</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </aside>
    </TaskOverlay>
  );
}

function TaskModal({ children, title, description, onClose }: { children: React.ReactNode; title: string; description?: string; onClose: () => void }) {
  return (
    <TaskOverlay onClose={onClose}>
      <div className="relative z-10 flex min-h-[100dvh] max-h-[100dvh] items-center justify-center overflow-y-auto p-4">
        <section className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-2xl">
          <header className="mb-4 border-b border-[hsl(var(--border))] pb-3">
            <p className="text-base font-semibold">{title}</p>
            {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
          </header>
          {children}
        </section>
      </div>
    </TaskOverlay>
  );
}
