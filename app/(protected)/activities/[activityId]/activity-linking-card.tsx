"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SessionCandidate } from "@/lib/workouts/activity-details";
import { deleteActivityAction, linkActivityAction, markUnplannedAction, toggleRaceAction, unlinkActivityAction, updateActivityNotesAction } from "./actions";

type StitchCandidate = {
  id: string;
  sportType: string;
  startTimeUtc: string;
  durationSec: number;
  distanceM: number | null;
};

type SegmentRole = "swim" | "t1" | "bike" | "t2" | "run";

export function ActivityLinkingCard({
  activityId,
  linkedSession,
  candidates,
  isRace,
  initialNotes,
  isUnplanned,
  source,
  externalProvider,
  activityBundleId,
  stitchCandidates
}: {
  activityId: string;
  linkedSession: SessionCandidate | null;
  candidates: SessionCandidate[];
  isRace: boolean;
  initialNotes: string | null;
  isUnplanned: boolean;
  source: string;
  externalProvider: string | null;
  activityBundleId: string | null;
  stitchCandidates: StitchCandidate[];
}) {
  const router = useRouter();
  const [selectedSessionId, setSelectedSessionId] = useState(candidates[0]?.id ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [stitchOpen, setStitchOpen] = useState(false);

  const canStitch = isRace && activityBundleId === null && stitchCandidates.length >= 3;

  return (
    <div className="space-y-4">
      <article className="surface p-4">
        {linkedSession ? (
          <>
            <h2 className="text-sm font-semibold">Linked planned session</h2>
            <div className="surface-subtle mt-3 rounded-lg p-3 text-sm">
              <p className="font-medium">{linkedSession.type}</p>
              <p className="text-xs text-muted">{linkedSession.sport} · {linkedSession.date}</p>
              <p className="mt-1 text-xs text-muted">Planned {linkedSession.duration_minutes ?? "—"} min</p>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn-secondary text-xs" disabled={pending} onClick={() => startTransition(async () => void unlinkActivityAction(activityId))}>Unlink</button>
              <button className="btn-secondary text-xs" disabled={pending} onClick={() => startTransition(async () => void unlinkActivityAction(activityId))}>Change link…</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold">Attach to planned session</h2>
            {candidates.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No planned sessions found for this day.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {candidates.slice(0, 3).map((candidate) => (
                  <li key={candidate.id} className="surface-subtle rounded-lg p-3 text-sm">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        className="mt-0.5"
                        name="candidate"
                        value={candidate.id}
                        checked={selectedSessionId === candidate.id}
                        onChange={() => setSelectedSessionId(candidate.id)}
                      />
                      <span>
                        <span className="font-medium">{candidate.type}</span>
                        <span className="block text-xs text-muted">{candidate.sport} · {candidate.date}</span>
                        <span className="block text-xs text-muted">{candidate.duration_minutes ?? "—"} min {candidate.isRecommended ? "· Recommended" : ""}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {candidates.length > 0 && (
                <button
                  className="btn-primary text-xs"
                  disabled={pending || !selectedSessionId}
                  onClick={() => startTransition(async () => {
                    const result = await linkActivityAction(activityId, selectedSessionId);
                    if (result?.error) setMessage(result.error);
                  })}
                >
                  Link activity
                </button>
              )}
              <button className="btn-secondary text-xs" disabled={pending} onClick={() => startTransition(async () => void markUnplannedAction(activityId))}>This wasn&apos;t planned</button>
            </div>
            {isUnplanned ? <p className="mt-2 text-xs text-muted">Marked as intentionally unplanned.</p> : null}
          </>
        )}
      </article>

      <article className="surface p-4">
        <h3 className="text-sm font-semibold">Quick actions</h3>
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-muted">Notes</label>
          <textarea className="input-base min-h-24 w-full" value={notes} onChange={(event) => setNotes(event.target.value)} />
          <button
            className="btn-secondary text-xs"
            disabled={pending}
            onClick={() => startTransition(async () => {
              const result = await updateActivityNotesAction(activityId, notes);
              setMessage(result?.error ? result.error : "Saved");
            })}
          >
            Add note
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-secondary text-xs" disabled={pending} onClick={() => startTransition(async () => void toggleRaceAction(activityId, !isRace))}>
            {isRace ? "Unmark race" : "Mark as race"}
          </button>
          {canStitch ? (
            <button className="btn-secondary text-xs" disabled={pending} onClick={() => setStitchOpen(true)}>
              Stitch into race
            </button>
          ) : null}
        </div>
        {message ? <p className="mt-2 text-xs text-muted">{message}</p> : null}
        <div className="mt-4 border-t border-white/10 pt-3">
          <button
            className="btn-secondary text-xs text-rose-400"
            disabled={pending}
            onClick={() => {
              const msg = externalProvider === "strava"
                ? "Delete this activity? It may be re-imported on the next Strava sync."
                : "Delete this activity? This cannot be undone.";
              if (!window.confirm(msg)) return;
              startTransition(async () => {
                const result = await deleteActivityAction(activityId);
                if (result?.error) {
                  setMessage(result.error);
                } else {
                  router.push("/dashboard");
                }
              });
            }}
          >
            Delete activity
          </button>
        </div>
      </article>

      {stitchOpen ? (
        <RaceStitchPicker
          currentActivityId={activityId}
          stitchCandidates={stitchCandidates}
          onClose={() => setStitchOpen(false)}
          onSuccess={(bundleId) => router.push(`/races/${bundleId}`)}
        />
      ) : null}
    </div>
  );
}

const ROLE_OPTIONS: SegmentRole[] = ["swim", "t1", "bike", "t2", "run"];

function defaultRoleForSport(sport: string): SegmentRole {
  if (sport === "swim") return "swim";
  if (sport === "bike") return "bike";
  if (sport === "run") return "run";
  return "bike";
}

function RaceStitchPicker({
  currentActivityId,
  stitchCandidates,
  onClose,
  onSuccess
}: {
  currentActivityId: string;
  stitchCandidates: StitchCandidate[];
  onClose: () => void;
  onSuccess: (bundleId: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, SegmentRole | "">>(() => {
    const initial: Record<string, SegmentRole | ""> = {};
    for (const candidate of stitchCandidates) {
      initial[candidate.id] = candidate.id === currentActivityId ? defaultRoleForSport(candidate.sportType) : "";
    }
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orderedCandidates = useMemo(
    () => [...stitchCandidates].sort((a, b) => new Date(a.startTimeUtc).getTime() - new Date(b.startTimeUtc).getTime()),
    [stitchCandidates]
  );

  function setRole(id: string, role: SegmentRole | "") {
    setSelected((prev) => ({ ...prev, [id]: role }));
  }

  async function submit() {
    const segments: Array<{ activityId: string; role: SegmentRole; index: number }> = [];
    let i = 0;
    for (const candidate of orderedCandidates) {
      const role = selected[candidate.id];
      if (!role) continue;
      segments.push({ activityId: candidate.id, role: role as SegmentRole, index: i });
      i += 1;
    }
    if (segments.length < 3) {
      setError("Pick at least three segments (swim, bike, run).");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/races/manual-stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? "Failed to stitch race.");
        setSubmitting(false);
        return;
      }
      onSuccess((body as { bundleId: string }).bundleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stitch race.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="surface w-full max-w-lg p-5">
        <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--border))] pb-2">
          <h3 className="text-sm font-semibold">Stitch into race</h3>
          <button className="text-xs text-tertiary" onClick={onClose} type="button">Close</button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Assign a role to the same-day activities you want to bundle as a race. Activities are listed in start-time order.
        </p>

        <ul className="mt-3 space-y-2">
          {orderedCandidates.map((candidate) => {
            const start = new Date(candidate.startTimeUtc).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            return (
              <li key={candidate.id} className="surface-subtle flex items-center gap-3 rounded-lg p-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium capitalize">{candidate.sportType}</p>
                  <p className="text-xs text-muted">
                    {start} · {Math.round(candidate.durationSec / 60)} min
                    {candidate.distanceM ? ` · ${(candidate.distanceM / 1000).toFixed(2)} km` : ""}
                  </p>
                </div>
                <select
                  value={selected[candidate.id] ?? ""}
                  onChange={(e) => setRole(candidate.id, e.target.value as SegmentRole | "")}
                  className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-1 text-xs"
                >
                  <option value="">Skip</option>
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role.toUpperCase()}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>

        {error ? <p className="mt-3 text-xs text-rose-400">{error}</p> : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn-secondary text-xs" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn-primary text-xs" type="button" onClick={submit} disabled={submitting}>
            {submitting ? "Stitching…" : "Stitch race"}
          </button>
        </div>
      </div>
    </div>
  );
}
