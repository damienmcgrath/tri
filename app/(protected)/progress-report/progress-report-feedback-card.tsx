"use client";

import { useState } from "react";

type Props = {
  blockStart: string;
  initialHelpful: boolean | null;
  initialAccurate: boolean | null;
  initialNote: string | null;
};

export function ProgressReportFeedbackCard({
  blockStart,
  initialHelpful,
  initialAccurate,
  initialNote
}: Props) {
  const [helpful, setHelpful] = useState<boolean | null>(initialHelpful);
  const [accurate, setAccurate] = useState<boolean | null>(initialAccurate);
  const [note, setNote] = useState(initialNote ?? "");
  const [showNoteEditor, setShowNoteEditor] = useState(Boolean(initialNote));
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function save(next: { helpful?: boolean | null; accurate?: boolean | null; note?: string }) {
    const finalHelpful = next.helpful ?? helpful;
    const finalAccurate = next.accurate ?? accurate;
    const finalNote = next.note ?? note;

    setHelpful(finalHelpful);
    setAccurate(finalAccurate);
    setNote(finalNote);
    setIsSaving(true);
    setStatus(null);

    try {
      const response = await fetch("/api/progress-report/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blockStart,
          helpful: finalHelpful,
          accurate: finalAccurate,
          note: finalNote.trim() || null
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save feedback.");
      }
      setStatus("Feedback saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save feedback.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="debrief-section-card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">Feedback</p>
          <h2 className="mt-1 text-section-title font-semibold">Did this read the block right?</h2>
          <p className="mt-2 max-w-2xl text-body text-muted">
            A quick signal is enough. Add a note only if something felt missing,
            overstated, or especially useful.
          </p>
        </div>
        {isSaving ? <span className="debrief-pill">Saving…</span> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div className="min-w-[220px]">
          <p className="debrief-kicker">Helpful</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void save({ helpful: true })}
              className={`rounded-full border px-3 py-1.5 text-body transition ${helpful === true ? "border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.14)] text-white" : "border-[hsl(var(--border))] text-muted hover:text-white"}`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => void save({ helpful: false })}
              className={`rounded-full border px-3 py-1.5 text-body transition ${helpful === false ? "border-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.12)] text-white" : "border-[hsl(var(--border))] text-muted hover:text-white"}`}
            >
              No
            </button>
          </div>
        </div>

        <div className="min-w-[220px]">
          <p className="debrief-kicker">Accurate</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void save({ accurate: true })}
              className={`rounded-full border px-3 py-1.5 text-body transition ${accurate === true ? "border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.14)] text-white" : "border-[hsl(var(--border))] text-muted hover:text-white"}`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => void save({ accurate: false })}
              className={`rounded-full border px-3 py-1.5 text-body transition ${accurate === false ? "border-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.12)] text-white" : "border-[hsl(var(--border))] text-muted hover:text-white"}`}
            >
              No
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowNoteEditor((current) => !current)}
            className="debrief-pill transition hover:border-[hsl(var(--accent)/0.5)] hover:text-white"
          >
            {showNoteEditor ? "Hide note" : note.trim() ? "Edit note" : "Add note"}
          </button>
          {status ? <p className="text-ui-label text-muted">{status}</p> : null}
        </div>
      </div>

      {showNoteEditor ? (
        <div className="mt-4 debrief-list-card">
          <label className="block">
            <span className="debrief-kicker">Optional note</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              className="input-base mt-4 min-h-[120px] resize-y rounded-[18px]"
              placeholder="What felt missing, off, or especially useful?"
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save({ note })}
              disabled={isSaving}
              className="btn-secondary px-3 py-1.5 text-ui-label disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save note
            </button>
            <button
              type="button"
              onClick={() => setShowNoteEditor(false)}
              className="debrief-pill transition hover:border-[hsl(var(--accent)/0.5)] hover:text-white"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
