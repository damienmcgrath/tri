"use client";

import { useState, useTransition } from "react";
import type { SessionCandidate } from "@/lib/workouts/activity-details";
import { linkActivityAction, markUnplannedAction, toggleRaceAction, unlinkActivityAction, updateActivityNotesAction } from "./actions";

export function ActivityLinkingCard({
  activityId,
  linkedSession,
  candidates,
  isRace,
  initialNotes,
  isUnplanned
}: {
  activityId: string;
  linkedSession: SessionCandidate | null;
  candidates: SessionCandidate[];
  isRace: boolean;
  initialNotes: string | null;
  isUnplanned: boolean;
}) {
  const [selectedSessionId, setSelectedSessionId] = useState(candidates[0]?.id ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

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
        <button className="btn-secondary mt-3 text-xs" disabled={pending} onClick={() => startTransition(async () => void toggleRaceAction(activityId, !isRace))}>
          {isRace ? "Unmark race" : "Mark as race"}
        </button>
        {message ? <p className="mt-2 text-xs text-muted">{message}</p> : null}
      </article>
    </div>
  );
}
