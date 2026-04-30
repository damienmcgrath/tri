/**
 * AI Layer 4 — Lessons.
 *
 * Renders the three forward-looking artifacts attached to a race:
 *  - Athlete profile takeaways (1–3, with confidence calibration)
 *  - Training implications (1–3, prioritised next-block changes)
 *  - Carry-forward (single portable insight for the next race morning)
 *
 * The data is computed deterministically upstream (confidence + supersession
 * are NOT decided by the AI) — this component only renders.
 */

import type {
  AthleteProfileTakeaway,
  TrainingImplication,
  CarryForward
} from "@/lib/race-review/lessons-schemas";

export type LessonsPayload = {
  athleteProfileTakeaways: AthleteProfileTakeaway[];
  trainingImplications: TrainingImplication[];
  carryForward: CarryForward | null;
  referencesRaceIds: string[];
  supersededByRaceId: string | null;
  isProvisional: boolean;
  generatedAt: string | null;
};

const CONFIDENCE_BADGE: Record<
  AthleteProfileTakeaway["confidence"],
  { label: string; color: string; bg: string; border: string }
> = {
  low: { label: "Low confidence", color: "rgb(148, 163, 184)", bg: "rgba(148, 163, 184, 0.08)", border: "rgba(148, 163, 184, 0.25)" },
  medium: { label: "Medium confidence", color: "rgb(251, 191, 36)", bg: "rgba(251, 191, 36, 0.08)", border: "rgba(251, 191, 36, 0.25)" },
  high: { label: "High confidence", color: "rgb(52, 211, 153)", bg: "rgba(52, 211, 153, 0.08)", border: "rgba(52, 211, 153, 0.25)" }
};

const PRIORITY_BADGE: Record<
  TrainingImplication["priority"],
  { label: string; color: string; bg: string; border: string }
> = {
  high: { label: "High priority", color: "rgb(248, 113, 113)", bg: "rgba(248, 113, 113, 0.08)", border: "rgba(248, 113, 113, 0.25)" },
  medium: { label: "Medium priority", color: "rgb(251, 191, 36)", bg: "rgba(251, 191, 36, 0.08)", border: "rgba(251, 191, 36, 0.25)" },
  low: { label: "Refinement", color: "rgb(148, 163, 184)", bg: "rgba(148, 163, 184, 0.08)", border: "rgba(148, 163, 184, 0.25)" }
};

export function LessonsCard({ lessons }: { lessons: LessonsPayload }) {
  const hasContent =
    lessons.athleteProfileTakeaways.length > 0 ||
    lessons.trainingImplications.length > 0 ||
    lessons.carryForward;
  if (!hasContent) return null;

  return (
    <article className="surface p-5">
      <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] pb-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Lessons</p>
          <p className="mt-1 text-xs text-muted">
            What this race teaches you for the next training block — and the next race morning.
          </p>
        </div>
        {lessons.isProvisional ? (
          <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-tertiary">
            Provisional
          </span>
        ) : null}
      </div>

      {lessons.supersededByRaceId ? (
        <p className="mt-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-xs text-tertiary">
          A more recent race has updated these lessons. The newer race summary carries the current reading.
        </p>
      ) : null}

      {lessons.athleteProfileTakeaways.length > 0 ? (
        <section className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-tertiary">Athlete profile takeaways</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {lessons.athleteProfileTakeaways.map((t, idx) => {
              const badge = CONFIDENCE_BADGE[t.confidence];
              return (
                <li
                  key={`${t.headline}-${idx}`}
                  className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-[rgba(255,255,255,0.92)]">{t.headline}</p>
                    <span
                      className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                      style={{ color: badge.color, backgroundColor: badge.bg, borderColor: badge.border }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[rgba(255,255,255,0.78)]">{t.body}</p>
                  {t.referencesCount > 0 ? (
                    <p className="mt-1 text-[11px] text-tertiary">
                      Draws on {t.referencesCount} prior race{t.referencesCount === 1 ? "" : "s"}.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {lessons.trainingImplications.length > 0 ? (
        <section className="mt-5">
          <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-tertiary">Training implications</h3>
          <ol className="mt-2 flex flex-col gap-3">
            {lessons.trainingImplications.map((i, idx) => {
              const badge = PRIORITY_BADGE[i.priority];
              return (
                <li
                  key={`${i.headline}-${idx}`}
                  className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-[rgba(255,255,255,0.92)]">
                      <span className="text-tertiary">{idx + 1}. </span>
                      {i.headline}
                    </p>
                    <span
                      className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                      style={{ color: badge.color, backgroundColor: badge.bg, borderColor: badge.border }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[rgba(255,255,255,0.78)]">{i.change}</p>
                  <p className="mt-1 text-[11px] text-tertiary">Why: {i.rationale}</p>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {lessons.carryForward ? (
        <section className="mt-5 rounded-md border border-emerald-500/25 bg-emerald-500/5 p-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-300/80">
            Carry-forward for next race morning
          </p>
          <p className="mt-1 text-sm font-medium text-[rgba(255,255,255,0.94)]">
            {lessons.carryForward.headline}
          </p>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.82)]">{lessons.carryForward.instruction}</p>
          <p className="mt-2 text-xs text-tertiary">
            Success criterion: {lessons.carryForward.successCriterion}
          </p>
        </section>
      ) : null}
    </article>
  );
}
