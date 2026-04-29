"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SUBJECTIVE_ISSUE_TAGS, type SubjectiveIssueTag } from "@/lib/race/subjective-input";

const ISSUE_LABELS: Record<SubjectiveIssueTag, string> = {
  nutrition: "Nutrition",
  mechanical: "Mechanical",
  illness: "Illness",
  navigation: "Navigation",
  pacing: "Pacing",
  mental: "Mental",
  weather: "Weather"
};

type Defaults = {
  athleteRating: number | null;
  athleteNotes: string | null;
  issuesFlagged: string[];
  finishPosition: number | null;
  ageGroupPosition: number | null;
};

export function SubjectiveForm({ bundleId, defaults }: { bundleId: string; defaults: Defaults }) {
  const router = useRouter();
  const [rating, setRating] = useState<number>(defaults.athleteRating ?? 0);
  const [notes, setNotes] = useState<string>(defaults.athleteNotes ?? "");
  const [issues, setIssues] = useState<Set<SubjectiveIssueTag>>(
    new Set((defaults.issuesFlagged ?? []).filter((tag): tag is SubjectiveIssueTag => SUBJECTIVE_ISSUE_TAGS.includes(tag as SubjectiveIssueTag)))
  );
  const [finishPosition, setFinishPosition] = useState<string>(
    defaults.finishPosition != null ? String(defaults.finishPosition) : ""
  );
  const [agPosition, setAgPosition] = useState<string>(
    defaults.ageGroupPosition != null ? String(defaults.ageGroupPosition) : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleIssue(tag: SubjectiveIssueTag) {
    setIssues((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (rating < 1 || rating > 5) {
      setError("Please choose a rating from 1 to 5.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const payload = {
      athleteRating: rating,
      athleteNotes: notes.trim() ? notes : null,
      issuesFlagged: Array.from(issues),
      finishPosition: finishPosition.trim() ? Number(finishPosition) : null,
      ageGroupPosition: agPosition.trim() ? Number(agPosition) : null
    };

    try {
      const res = await fetch(`/api/races/${bundleId}/subjective`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to save race notes.");
        setSubmitting(false);
        return;
      }
      router.push(`/races/${bundleId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save race notes.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="surface flex flex-col gap-5 p-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-[rgba(255,255,255,0.92)]">How was the race?</legend>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${value} out of 5`}
              onClick={() => setRating(value)}
              className={`text-2xl transition ${value <= rating ? "text-amber-300" : "text-[hsl(var(--surface-subtle))] hover:text-amber-300/60"}`}
            >
              ★
            </button>
          ))}
          <span className="ml-2 text-xs text-tertiary">{rating > 0 ? `${rating} / 5` : "Select a rating"}</span>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-[rgba(255,255,255,0.92)]">Anything go wrong?</legend>
        <div className="flex flex-wrap gap-2">
          {SUBJECTIVE_ISSUE_TAGS.map((tag) => {
            const active = issues.has(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleIssue(tag)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  active
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                    : "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] text-tertiary hover:border-[rgba(255,255,255,0.18)]"
                }`}
              >
                {ISSUE_LABELS[tag]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-[rgba(255,255,255,0.92)]">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={4000}
          rows={6}
          placeholder="What stood out? What would you change?"
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm text-[rgba(255,255,255,0.92)] placeholder:text-tertiary focus:border-[rgba(255,255,255,0.32)] focus:outline-none"
        />
        <span className="text-[10px] text-tertiary">{notes.length} / 4000</span>
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-[rgba(255,255,255,0.92)]">Overall finish</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={finishPosition}
            onChange={(e) => setFinishPosition(e.target.value)}
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm text-[rgba(255,255,255,0.92)] focus:border-[rgba(255,255,255,0.32)] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-[rgba(255,255,255,0.92)]">Age group finish</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={agPosition}
            onChange={(e) => setAgPosition(e.target.value)}
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm text-[rgba(255,255,255,0.92)] focus:border-[rgba(255,255,255,0.32)] focus:outline-none"
          />
        </label>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={submitting || rating < 1}
          className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-4 py-1.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save race notes"}
        </button>
      </div>
    </form>
  );
}
