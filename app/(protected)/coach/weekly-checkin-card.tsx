"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";

type Props = {
  weekStart: string;
  snapshot: AthleteContextSnapshot;
};

type MetricKey = "fatigue" | "sleepQuality" | "soreness" | "stress" | "confidence";

type Choice = {
  label: string;
  value: number;
};

type MetricDefinition = {
  key: MetricKey;
  label: string;
  hint: string;
  choices: Choice[];
};

const METRICS: MetricDefinition[] = [
  {
    key: "fatigue",
    label: "Fatigue",
    hint: "How drained do you feel right now?",
    choices: [
      { label: "Fresh", value: 1 },
      { label: "Normal", value: 3 },
      { label: "Heavy", value: 5 }
    ]
  },
  {
    key: "sleepQuality",
    label: "Sleep",
    hint: "How restorative has sleep felt?",
    choices: [
      { label: "Poor", value: 1 },
      { label: "Okay", value: 3 },
      { label: "Good", value: 5 }
    ]
  },
  {
    key: "soreness",
    label: "Soreness",
    hint: "How much soreness are you carrying?",
    choices: [
      { label: "Light", value: 1 },
      { label: "Noticeable", value: 3 },
      { label: "High", value: 5 }
    ]
  },
  {
    key: "stress",
    label: "Stress",
    hint: "How much life stress is in the week?",
    choices: [
      { label: "Low", value: 1 },
      { label: "Manageable", value: 3 },
      { label: "High", value: 5 }
    ]
  },
  {
    key: "confidence",
    label: "Confidence",
    hint: "How ready do you feel for the next key session?",
    choices: [
      { label: "Low", value: 1 },
      { label: "Steady", value: 3 },
      { label: "High", value: 5 }
    ]
  }
];

type MetricState = Record<MetricKey, number | null>;

function ModalMetricRow({
  metric,
  value,
  onChange
}: {
  metric: MetricDefinition;
  value: number | null;
  onChange: (value: number) => void;
}) {
  const selectedLabel = metric.choices.find((choice) => choice.value === value)?.label ?? "Not set";

  return (
    <div className="rounded-[22px] border border-[hsl(var(--border))] bg-[linear-gradient(180deg,hsl(var(--surface-subtle)),hsl(var(--surface)))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">{metric.label}</p>
          <p className="mt-1 text-xs text-muted">{metric.hint}</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] ${
            value === null
              ? "border-[hsl(var(--border))] text-tertiary"
              : "border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]"
          }`}
        >
          {selectedLabel}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {metric.choices.map((choice) => (
          <label
            key={choice.label}
            className={`cursor-pointer rounded-full border px-3.5 py-2 text-sm font-medium transition ${
              value === choice.value
                ? "border-[hsl(var(--accent))] bg-[linear-gradient(180deg,hsl(var(--accent)),hsl(var(--accent)/0.88))] text-[hsl(var(--accent-foreground))] shadow-[0_12px_30px_hsl(var(--accent)/0.22)]"
                : "border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-muted hover:border-[hsl(var(--accent)/0.35)] hover:bg-[hsl(var(--surface-subtle))] hover:text-primary"
            }`}
          >
            <input
              type="radio"
              name={`weekly-checkin-${metric.key}`}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
              className="sr-only"
            />
            {choice.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function WeeklyCheckinCard({ weekStart, snapshot }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<MetricState>({
    fatigue: snapshot.weeklyState.fatigue,
    sleepQuality: snapshot.weeklyState.sleepQuality,
    soreness: snapshot.weeklyState.soreness,
    stress: snapshot.weeklyState.stress,
    confidence: snapshot.weeklyState.confidence
  });
  const [note, setNote] = useState(snapshot.weeklyState.note ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const completedCount = useMemo(
    () => Object.values(values).filter((value) => value !== null).length,
    [values]
  );

  const completionLabel = completedCount === METRICS.length ? "Ready" : `${completedCount}/${METRICS.length} set`;

  const summaryChips = useMemo(
    () =>
      METRICS.map((metric) => ({
        key: metric.key,
        label: metric.label,
        value: metric.choices.find((choice) => choice.value === values[metric.key])?.label ?? "Not set"
      })),
    [values]
  );

  useEffect(() => {
    if (!isModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsModalOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isModalOpen]);

  function updateMetric(key: MetricKey, value: number) {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus(null);
  }

  async function save() {
    setIsSaving(true);
    setStatus(null);

    try {
      const response = await fetch("/api/athlete-checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          weekStart,
          fatigue: values.fatigue,
          sleepQuality: values.sleepQuality,
          soreness: values.soreness,
          stress: values.stress,
          confidence: values.confidence,
          note: note || null
        })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not save weekly check-in.");
      }
      setStatus("Saved weekly check-in.");
      setIsModalOpen(false);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save weekly check-in.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <article className="surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label">Weekly check-in</p>
            <h2 className="mt-1 text-lg font-semibold">How does the week feel?</h2>
            <p className="mt-1 text-sm text-muted">Keep Coach grounded in your current recovery state without turning this page into a full control panel.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-tertiary">Week of {weekStart}</span>
            <span
              className={`rounded-full border px-3 py-1 text-xs ${
                completedCount === METRICS.length
                  ? "border-[rgba(52,211,153,0.25)] bg-[rgba(52,211,153,0.12)] text-success"
                  : "border-[hsl(var(--border))] text-tertiary"
              }`}
            >
              {completionLabel}
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3.5">
          <div className="flex flex-wrap gap-2">
            {summaryChips.map((chip) => (
              <span key={chip.key} className="rounded-md border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)]">
                <span className="text-[rgba(255,255,255,0.35)]">{chip.label}:</span> <span className="text-[rgba(255,255,255,0.8)]">{chip.value}</span>
              </span>
            ))}
            {note.trim() ? (
              <span className="rounded-md border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.6)]">
                Note added
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-3">
              {status ? <p className="text-sm text-muted">{status}</p> : null}
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[#0A0A0B]"
              >
                {completedCount > 0 ? "Update check-in" : "Start check-in"}
              </button>
            </div>
          </div>
        </div>
      </article>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(222_28%_8%/0.72)] p-4 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setIsModalOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-checkin-title"
            className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[20px] border border-[hsl(var(--border))] bg-[linear-gradient(180deg,hsl(var(--surface)),hsl(var(--surface-subtle)))] shadow-[0_30px_120px_hsl(222_40%_4%/0.55)] sm:max-w-xl sm:rounded-[28px] md:max-w-4xl"
          >
            <div className="border-b border-[hsl(var(--border))] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-accent">Weekly check-in</p>
                  <h3 id="weekly-checkin-title" className="mt-1 text-xl font-semibold sm:text-2xl">How does the week feel?</h3>
                  <p className="mt-1 text-sm text-muted">Keep this short. The goal is to give Coach the right caution level before your next key session.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-tertiary">Week of {weekStart}</span>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--border))] text-lg text-muted transition hover:text-primary"
                    aria-label="Close weekly check-in"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              <div className="grid gap-3 lg:grid-cols-2">
                {METRICS.map((metric) => (
                  <ModalMetricRow
                    key={metric.key}
                    metric={metric}
                    value={values[metric.key]}
                    onChange={(value) => updateMetric(metric.key, value)}
                  />
                ))}
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                <label className="block space-y-2 text-sm">
                  <span className="text-sm font-medium text-primary">Quick note</span>
                  <span className="block text-xs text-muted">Optional context for sleep, work stress, soreness, or confidence.</span>
                  <textarea
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value);
                      setStatus(null);
                    }}
                    rows={4}
                    className="mt-2 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 py-3"
                    placeholder="Sleep, life stress, soreness, confidence..."
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4 sm:p-5">
              <div className="flex flex-wrap gap-2 text-xs text-tertiary">
                <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Fast update</span>
                <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">Used for coaching tone</span>
                <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1">You can update it anytime</span>
              </div>

              <div className="flex items-center gap-3">
                {status ? <p className="text-sm text-muted">{status}</p> : null}
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm text-muted transition hover:text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={isSaving}
                  className="rounded-full bg-[linear-gradient(180deg,hsl(var(--accent)),hsl(var(--accent)/0.88))] px-5 py-2.5 text-sm font-medium text-[hsl(var(--accent-foreground))] shadow-[0_14px_32px_hsl(var(--accent)/0.2)] disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Save check-in"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
