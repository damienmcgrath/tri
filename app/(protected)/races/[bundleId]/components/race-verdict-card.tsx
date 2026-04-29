/**
 * Layer 1 — Verdict.
 *
 * Above-the-fold moment for the race review: headline (goal-anchored, cites
 * a number), per-discipline verdict pills with deterministic status, and
 * the NEXT-format Coach Take. Optional emotional frame banner appears above
 * the headline only when the deterministic trigger fired upstream.
 */

import type { LegStatusLabel } from "@/lib/race-review/leg-status";

export type VerdictPayload = {
  headline: string;
  perDiscipline: {
    swim: { status: LegStatusLabel; summary: string } | null;
    bike: { status: LegStatusLabel; summary: string } | null;
    run: { status: LegStatusLabel; summary: string } | null;
  };
  coachTake: {
    target: string;
    scope: string;
    successCriterion: string;
    progression: string;
  };
  emotionalFrame: string | null;
};

const STATUS_TONE: Record<LegStatusLabel, { label: string; bg: string; border: string; text: string }> = {
  on_plan: {
    label: "On plan",
    bg: "var(--color-accent-muted)",
    border: "var(--color-accent-border)",
    text: "var(--color-accent)"
  },
  strong: {
    label: "Strong",
    bg: "var(--color-success-muted)",
    border: "rgba(52, 211, 153, 0.3)",
    text: "var(--color-success)"
  },
  under: {
    label: "Under target",
    bg: "var(--color-warning-muted)",
    border: "rgba(255, 180, 60, 0.3)",
    text: "var(--color-warning)"
  },
  over: {
    label: "Over target",
    bg: "var(--color-warning-muted)",
    border: "rgba(255, 180, 60, 0.3)",
    text: "var(--color-warning)"
  },
  faded: {
    label: "Faded",
    bg: "var(--color-warning-muted)",
    border: "rgba(255, 180, 60, 0.3)",
    text: "var(--color-warning)"
  },
  cooked: {
    label: "Cooked",
    bg: "var(--color-danger-muted)",
    border: "rgba(255, 90, 40, 0.3)",
    text: "var(--color-danger)"
  }
};

const LEG_LABEL: Record<"swim" | "bike" | "run", string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run"
};

export function RaceVerdictCard({
  verdict,
  isProvisional,
  modelUsed,
  generatedAt,
  noteIndicator
}: {
  verdict: VerdictPayload;
  isProvisional: boolean;
  modelUsed: string | null;
  generatedAt: string | null;
  /** When true, render a "Review updated based on your notes" pill. */
  noteIndicator?: boolean;
}) {
  const generatedLabel = generatedAt ? formatRelative(generatedAt) : null;

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Verdict</p>
          {isProvisional ? (
            <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-tertiary">
              Provisional
            </span>
          ) : null}
          {noteIndicator ? (
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]"
              style={{
                borderColor: "var(--color-accent-border)",
                backgroundColor: "var(--color-accent-muted)",
                color: "var(--color-accent)"
              }}
            >
              Updated based on your notes
            </span>
          ) : null}
        </div>
        {generatedLabel ? (
          <p className="text-[10px] text-tertiary">
            Generated {generatedLabel}
            {modelUsed ? ` · ${modelUsed}` : null}
          </p>
        ) : null}
      </header>

      {verdict.emotionalFrame ? (
        <p
          className="mt-3 rounded-lg border-l-[3px] px-3 py-2 text-sm"
          style={{
            borderLeftColor: "var(--color-warning)",
            backgroundColor: "var(--color-warning-muted)",
            color: "rgba(255,255,255,0.86)"
          }}
        >
          {verdict.emotionalFrame}
        </p>
      ) : null}

      <h2 className="mt-3 text-lg font-medium leading-snug text-[rgba(255,255,255,0.96)]">
        {verdict.headline}
      </h2>

      <ul className="mt-4 grid gap-2 md:grid-cols-3">
        {(["swim", "bike", "run"] as const).map((leg) => {
          const data = verdict.perDiscipline[leg];
          if (!data) {
            return (
              <li
                key={leg}
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2"
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">{LEG_LABEL[leg]}</p>
                <p className="mt-1 text-xs text-tertiary">No data</p>
              </li>
            );
          }
          const tone = STATUS_TONE[data.status];
          return (
            <li
              key={leg}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: tone.border, backgroundColor: tone.bg }}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">{LEG_LABEL[leg]}</p>
                <span
                  className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em]"
                  style={{ borderColor: tone.border, color: tone.text, backgroundColor: tone.bg }}
                >
                  {tone.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-[rgba(255,255,255,0.78)] leading-relaxed">{data.summary}</p>
            </li>
          );
        })}
      </ul>

      <section
        className="mt-4 rounded-xl border-y border-r border-[hsl(var(--border))] border-l-[3px] p-4"
        style={{
          borderLeftColor: "var(--color-accent)",
          backgroundColor: "rgba(190,255,0,0.04)"
        }}
      >
        <p
          className="text-[11px] font-medium uppercase tracking-[0.14em]"
          style={{ color: "var(--color-accent)" }}
        >
          Coach take
        </p>
        <p className="mt-2 text-sm font-medium text-white">NEXT — {verdict.coachTake.target}</p>
        <p className="mt-1 text-xs text-tertiary">For: {verdict.coachTake.scope}</p>
        <dl className="mt-2 grid gap-1 text-xs text-[rgba(255,255,255,0.78)] md:grid-cols-2">
          <div className="flex flex-col">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-tertiary">Success criterion</dt>
            <dd>{verdict.coachTake.successCriterion}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-tertiary">Progression</dt>
            <dd>{verdict.coachTake.progression}</dd>
          </div>
        </dl>
      </section>
    </article>
  );
}

function formatRelative(iso: string): string {
  const generated = new Date(iso).getTime();
  if (!Number.isFinite(generated)) return "";
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - generated) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
