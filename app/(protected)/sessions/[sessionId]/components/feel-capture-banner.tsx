"use client";

import { useState, useRef } from "react";

type FeelCaptureBannerProps = {
  sessionId: string;
  existingFeel?: {
    overall_feel: number | null;
    rpe: number | null;
    energy_level: string | null;
    legs_feel: string | null;
    motivation: string | null;
    sleep_quality: string | null;
    life_stress: string | null;
    note: string | null;
  } | null;
};

type FeelLevel = 1 | 2 | 3 | 4 | 5;

const FEEL_OPTIONS: Array<{ value: FeelLevel; label: string; icon: string; color: { border: string; bg: string; text: string } }> = [
  { value: 1, label: "Terrible", icon: "\u{1F629}", color: { border: "rgba(248,113,113,0.5)", bg: "rgba(248,113,113,0.14)", text: "rgb(252,165,165)" } },
  { value: 2, label: "Hard", icon: "\u{1F62E}\u200D\u{1F4A8}", color: { border: "rgba(251,146,60,0.5)", bg: "rgba(251,146,60,0.14)", text: "rgb(253,186,116)" } },
  { value: 3, label: "OK", icon: "\u{1F610}", color: { border: "rgba(250,204,21,0.5)", bg: "rgba(250,204,21,0.12)", text: "rgb(253,224,71)" } },
  { value: 4, label: "Good", icon: "\u{1F60A}", color: { border: "rgba(52,211,153,0.5)", bg: "rgba(52,211,153,0.14)", text: "rgb(110,231,183)" } },
  { value: 5, label: "Amazing", icon: "\u{1F525}", color: { border: "rgba(190,255,0,0.5)", bg: "rgba(190,255,0,0.14)", text: "rgb(190,255,0)" } }
];

type PillOption = { value: string; label: string };

const ENERGY_OPTIONS: PillOption[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" }
];

const LEGS_OPTIONS: PillOption[] = [
  { value: "heavy", label: "Heavy" },
  { value: "normal", label: "Normal" },
  { value: "fresh", label: "Fresh" }
];

const MOTIVATION_OPTIONS: PillOption[] = [
  { value: "struggled", label: "Struggled" },
  { value: "neutral", label: "Neutral" },
  { value: "fired_up", label: "Fired up" }
];

const SLEEP_OPTIONS: PillOption[] = [
  { value: "poor", label: "Poor" },
  { value: "ok", label: "OK" },
  { value: "great", label: "Great" }
];

const STRESS_OPTIONS: PillOption[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" }
];

function PillSelector({ label, options, value, onChange }: {
  label: string;
  options: PillOption[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-tertiary">{label}</p>
      <div className="flex gap-1.5">
        {options.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(isSelected ? null : opt.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                isSelected
                  ? "border-[rgba(190,255,0,0.4)] bg-[rgba(190,255,0,0.12)] text-[var(--color-accent)]"
                  : "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] text-[rgba(255,255,255,0.5)] hover:border-[rgba(255,255,255,0.25)] hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SecondaryItem = { label: string; value: string };

function FeelSummary({ feel }: { feel: NonNullable<FeelCaptureBannerProps["existingFeel"]> }) {
  // Support both new overall_feel (1-5) and legacy rpe (1-10) rows
  const option = feel.overall_feel
    ? FEEL_OPTIONS.find((o) => o.value === feel.overall_feel)
    : null;

  const secondaryItems: SecondaryItem[] = [];
  if (feel.energy_level) secondaryItems.push({ label: "Energy", value: feel.energy_level });
  if (feel.legs_feel) secondaryItems.push({ label: "Legs", value: feel.legs_feel });
  if (feel.motivation) secondaryItems.push({ label: "Motivation", value: feel.motivation.replace("_", " ") });
  if (feel.sleep_quality) secondaryItems.push({ label: "Sleep", value: feel.sleep_quality });
  if (feel.life_stress) secondaryItems.push({ label: "Stress", value: feel.life_stress });

  // Legacy RPE-only rows: show RPE value directly
  if (!option && feel.rpe) {
    return (
      <article className="surface border border-[hsl(var(--border))] p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted">RPE {feel.rpe}/10</span>
        </div>
        {feel.note && <p className="mt-1.5 text-xs text-muted">{feel.note}</p>}
      </article>
    );
  }

  if (!option) return null;

  return (
    <article className="surface border border-[hsl(var(--border))] p-4">
      {/* Primary feel — visually dominant */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-lg" style={{ backgroundColor: option.color.bg }}>
          {option.icon}
        </span>
        <span className="text-sm font-semibold" style={{ color: option.color.text }}>{option.label}</span>
      </div>

      {/* Secondary attributes — 2-column grid */}
      {secondaryItems.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {secondaryItems.map((item) => (
            <div key={item.label} className="flex items-baseline gap-1.5">
              <span className="text-xs text-tertiary">{item.label}</span>
              <span className="text-xs font-medium text-muted">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Note */}
      {feel.note && (
        <p className="mt-2.5 border-t border-[hsl(var(--border))] pt-2.5 text-xs text-muted italic">{feel.note}</p>
      )}
    </article>
  );
}

export function FeelCaptureBanner({ sessionId, existingFeel }: FeelCaptureBannerProps) {
  const [selectedFeel, setSelectedFeel] = useState<FeelLevel | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);
  const [energyLevel, setEnergyLevel] = useState<string | null>(null);
  const [legsFeel, setLegsFeel] = useState<string | null>(null);
  const [motivation, setMotivation] = useState<string | null>(null);
  const [sleepQuality, setSleepQuality] = useState<string | null>(null);
  const [lifeStress, setLifeStress] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const promptShownAt = useRef(new Date().toISOString());
  const interactionStartRef = useRef<number | null>(null);

  // Show summary if feel already captured (either new overall_feel or legacy rpe)
  if (existingFeel?.overall_feel || existingFeel?.rpe) {
    return <FeelSummary feel={existingFeel} />;
  }

  if (dismissed) return null;

  function handleFeelSelect(feel: FeelLevel) {
    if (!interactionStartRef.current) {
      interactionStartRef.current = Date.now();
    }
    setSelectedFeel(feel);
  }

  async function handleSave() {
    if (selectedFeel === null) return;
    setSaving(true);
    setSaveError(null);
    const completionTimeMs = interactionStartRef.current ? Date.now() - interactionStartRef.current : null;
    try {
      const res = await fetch("/api/session-feels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          overallFeel: selectedFeel,
          energyLevel: energyLevel || null,
          legsFeel: legsFeel || null,
          motivation: motivation || null,
          sleepQuality: sleepQuality || null,
          lifeStress: lifeStress || null,
          note: note.trim() || null,
          wasPrompted: true,
          promptShownAt: promptShownAt.current,
          completionTimeMs
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to save \u2014 please try again.");
      }
      setDismissed(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save \u2014 please try again.");
      setSaving(false);
    }
  }

  return (
    <article className="surface border border-[hsl(var(--border))] p-5">
      <p className="label">How did that feel?</p>
      <p className="mt-1 text-sm text-muted">Tap the one that best describes this session.</p>

      <div className="mt-4 grid grid-cols-5 gap-2" role="radiogroup" aria-label="How did the session feel? (1-5)">
        {FEEL_OPTIONS.map((opt) => {
          const isSelected = selectedFeel === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${opt.label} (${opt.value}/5)`}
              onClick={() => handleFeelSelect(opt.value)}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition-colors ${
                isSelected
                  ? ""
                  : "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] text-[rgba(255,255,255,0.5)] hover:border-[rgba(255,255,255,0.25)] hover:text-white"
              }`}
              style={isSelected
                ? { borderColor: opt.color.border, backgroundColor: opt.color.bg, color: opt.color.text }
                : undefined
              }
            >
              <span className="text-lg">{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      {selectedFeel !== null && !showSecondary && (
        <button
          type="button"
          onClick={() => setShowSecondary(true)}
          className="mt-3 text-xs text-tertiary hover:text-white transition-colors"
        >
          + Add more details
        </button>
      )}

      {showSecondary && (
        <div className="mt-4 space-y-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
          <PillSelector label="Energy level" options={ENERGY_OPTIONS} value={energyLevel} onChange={setEnergyLevel} />
          <PillSelector label="Legs" options={LEGS_OPTIONS} value={legsFeel} onChange={setLegsFeel} />
          <PillSelector label="Motivation" options={MOTIVATION_OPTIONS} value={motivation} onChange={setMotivation} />
          <PillSelector label="Sleep last night" options={SLEEP_OPTIONS} value={sleepQuality} onChange={setSleepQuality} />
          <PillSelector label="Life stress" options={STRESS_OPTIONS} value={lifeStress} onChange={setLifeStress} />
          <div>
            <p className="mb-1.5 text-xs text-tertiary">Anything else your coach should know?</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 280))}
              placeholder="e.g. felt strong on the run, legs heavy after yesterday..."
              rows={2}
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-3 py-2 text-sm text-white placeholder:text-tertiary focus:border-[rgba(190,255,0,0.4)] focus:outline-none"
            />
            <p className="mt-1 text-right text-[11px] text-tertiary">{note.length}/280</p>
          </div>
        </div>
      )}

      {saveError && (
        <p className="mt-3 rounded-lg border border-[hsl(var(--danger)/0.3)] bg-[hsl(var(--danger)/0.08)] px-3 py-2 text-xs text-danger" role="alert">
          {saveError}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={selectedFeel === null || saving}
          className="rounded-lg bg-[rgba(190,255,0,0.15)] px-4 py-2 text-sm font-medium text-[var(--color-accent)] hover:bg-[rgba(190,255,0,0.22)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving\u2026" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-sm text-tertiary hover:text-white"
        >
          Skip
        </button>
      </div>
    </article>
  );
}
