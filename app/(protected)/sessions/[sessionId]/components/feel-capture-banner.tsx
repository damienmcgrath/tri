"use client";

import { useState } from "react";

type FeelCaptureBannerProps = {
  sessionId: string;
};

export function FeelCaptureBanner({ sessionId }: FeelCaptureBannerProps) {
  const [selectedRpe, setSelectedRpe] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (dismissed) return null;

  async function handleSave() {
    if (selectedRpe === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/session-feels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, rpe: selectedRpe, note: note.trim() || null, wasPrompted: true })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to save — please try again.");
      }
      setDismissed(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save — please try again.");
      setSaving(false);
    }
  }

  async function handleSkip() {
    setDismissed(true);
  }

  const rpeLabels: Record<number, string> = {
    1: "Very easy",
    2: "Easy",
    3: "Moderate",
    4: "Somewhat hard",
    5: "Hard",
    6: "Hard",
    7: "Very hard",
    8: "Very hard",
    9: "Very, very hard",
    10: "Max effort"
  };

  return (
    <article className="surface border border-[rgba(190,255,0,0.18)] bg-[rgba(190,255,0,0.04)] p-5">
      <p className="label">How did that feel?</p>
      <p className="mt-1 text-sm text-muted">Rate the effort for this session.</p>

      <div className="mt-4 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Rate perceived exertion (1-10)">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((rpe) => (
          <button
            key={rpe}
            type="button"
            role="radio"
            aria-checked={selectedRpe === rpe}
            aria-label={`RPE ${rpe}: ${rpeLabels[rpe]}`}
            onClick={() => setSelectedRpe(rpe)}
            className={`min-h-[44px] w-full rounded-lg border text-sm font-medium transition-colors ${
              selectedRpe === rpe
                ? "border-[rgba(190,255,0,0.6)] bg-[rgba(190,255,0,0.15)] text-[var(--color-accent)]"
                : "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] text-[rgba(255,255,255,0.6)] hover:border-[rgba(255,255,255,0.25)] hover:text-white"
            }`}
          >
            {rpe}
          </button>
        ))}
      </div>

      {selectedRpe !== null ? (
        <p className="mt-2 text-xs text-muted">{rpeLabels[selectedRpe]}</p>
      ) : null}

      <div className="mt-4">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          placeholder="Optional note (e.g. felt strong on the run, legs heavy...)"
          rows={2}
          className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-3 py-2 text-sm text-white placeholder:text-tertiary focus:border-[rgba(190,255,0,0.4)] focus:outline-none"
        />
        <p className="mt-1 text-right text-[11px] text-tertiary">{note.length}/200</p>
      </div>

      {saveError ? (
        <p className="mt-3 rounded-lg border border-[hsl(var(--danger)/0.3)] bg-[hsl(var(--danger)/0.08)] px-3 py-2 text-xs text-danger" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={selectedRpe === null || saving}
          className="rounded-lg bg-[rgba(190,255,0,0.15)] px-4 py-2 text-sm font-medium text-[var(--color-accent)] hover:bg-[rgba(190,255,0,0.22)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void handleSkip()}
          className="text-sm text-tertiary hover:text-white"
        >
          Skip
        </button>
      </div>
    </article>
  );
}
