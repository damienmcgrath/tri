"use client";

import { useId, useState } from "react";

export interface IntentCaptureFormProps {
  defaultValue?: string;
  onSubmit: (text: string) => void | Promise<void>;
  onSkip: () => void;
  loading?: boolean;
}

const EXAMPLES = [
  "3 × 40 min work / 20 min easy plus extra to clear 100 km",
  "1 hour easy then 4 × 8 min at threshold with 4 min recoveries",
  "Just Z2, no structure"
];

export function IntentCaptureForm({
  defaultValue = "",
  onSubmit,
  onSkip,
  loading = false
}: IntentCaptureFormProps) {
  const [text, setText] = useState(defaultValue);
  const [chipUsed, setChipUsed] = useState(false);
  const headingId = useId();
  const inputId = useId();

  const trimmed = text.trim();
  const saveDisabled = loading || (trimmed.length === 0 && !chipUsed);

  function handleChip(example: string) {
    if (loading) return;
    setText(example);
    setChipUsed(true);
  }

  function handleSave() {
    if (saveDisabled) return;
    void onSubmit(trimmed);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="surface flex flex-col gap-4 border border-[var(--border-default)] bg-surface p-5"
    >
      <header className="flex flex-col gap-1">
        <p className="label">Intent</p>
        <h2
          id={headingId}
          className="text-section-title text-[var(--color-text-primary)]"
        >
          Was today structured? Tell me the shape in one sentence.
        </h2>
      </header>

      <label htmlFor={inputId} className="sr-only">
        Session intent
      </label>
      <textarea
        id={inputId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        disabled={loading}
        placeholder="e.g. 5 × 1 km at threshold with 90s jog recoveries"
        className="w-full rounded-md border border-[var(--border-subtle)] bg-raised px-3 py-2 font-sans text-[15px] leading-snug text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--border-default)] focus:outline-none focus:ring-2 focus:ring-[rgba(190,255,0,0.2)] disabled:cursor-not-allowed disabled:opacity-50"
      />

      <div className="flex flex-col gap-2">
        <p className="label">Examples</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Example intents">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => handleChip(example)}
              disabled={loading}
              className="rounded-full border border-[var(--border-default)] bg-raised px-3 py-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)] transition-ui hover:border-[var(--color-accent-border)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onSkip}
          disabled={loading}
          className="btn-ghost text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Skip — leave open
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saveDisabled}
          aria-busy={loading || undefined}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                role="presentation"
                data-testid="intent-save-spinner"
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[rgba(10,10,11,0.25)] border-t-[#0a0a0b]"
              />
              <span>Saving…</span>
            </span>
          ) : (
            "Save & continue"
          )}
        </button>
      </div>
    </section>
  );
}
