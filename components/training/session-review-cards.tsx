import { StatusPill, toneClassName } from "@/components/training/status-pill";
import {
  EVIDENCE_QUALITY_META,
  REVIEW_OUTCOME_META,
  type EvidenceQualityState,
  type ReviewOutcomeState
} from "@/lib/training/semantics";
import type { IntentVsActualMetric } from "@/lib/training/review-summary";

function toneTextClass(tone: IntentVsActualMetric["tone"]) {
  if (tone === "success") return "text-[hsl(var(--success))]";
  if (tone === "warning") return "text-[hsl(var(--warning))]";
  if (tone === "attention") return "text-[hsl(var(--signal-risk))]";
  return "text-muted";
}

export function ReviewVerdictCard({
  outcome,
  summary,
  confidence,
  primaryGap
}: {
  outcome: ReviewOutcomeState;
  summary: string;
  confidence: EvidenceQualityState;
  primaryGap: string;
}) {
  const outcomeMeta = REVIEW_OUTCOME_META[outcome];
  const confidenceMeta = EVIDENCE_QUALITY_META[confidence];

  return (
    <article className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-accent">Verdict</p>
          <h2 className="mt-2 text-3xl font-semibold">{outcomeMeta.label}</h2>
          <p className="mt-3 max-w-3xl text-base text-[hsl(var(--text-primary))]">{summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill label={outcomeMeta.label} tone={outcomeMeta.tone} icon={outcomeMeta.icon} />
          <StatusPill label={`Confidence ${confidenceMeta.label}`} tone={confidenceMeta.tone} icon={confidenceMeta.icon} />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
        <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Primary execution gap</p>
        <p className="mt-2 text-sm text-muted">{primaryGap}</p>
      </div>
    </article>
  );
}

export function IntentVsActualGrid({
  intendedStimulus,
  didStimulusLand,
  metrics
}: {
  intendedStimulus: string;
  didStimulusLand: string;
  metrics: IntentVsActualMetric[];
}) {
  return (
    <article className="surface p-5">
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Intended stimulus</p>
            <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{intendedStimulus}</p>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Did it land?</p>
            <p className="mt-2 text-sm font-medium text-[hsl(var(--text-primary))]">{didStimulusLand}</p>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Intent vs actual</p>
          {metrics.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                  <p className="text-xs text-muted">{metric.label}</p>
                  <div className="mt-2 grid gap-1 text-sm">
                    <p><span className="text-tertiary">Planned:</span> {metric.planned}</p>
                    <p><span className="text-tertiary">Actual:</span> {metric.actual}</p>
                  </div>
                  {metric.note ? (
                    <p className={`mt-2 text-xs ${toneTextClass(metric.tone)}`}>{metric.note}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4 text-sm text-muted">
              More detailed evidence will appear once the upload includes structure or split data.
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function StimulusImpactCard({
  impact,
  effectOnWeek,
  recommendation
}: {
  impact: string;
  effectOnWeek: string;
  recommendation: string;
}) {
  return (
    <article className="surface p-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Stimulus impact</p>
          <p className="mt-2 text-base font-semibold text-[hsl(var(--text-primary))]">{impact}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Effect on week</p>
          <p className="mt-2 text-base font-semibold text-[hsl(var(--text-primary))]">{effectOnWeek}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Recommendation</p>
          <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{recommendation}</p>
        </div>
      </div>
    </article>
  );
}

export function EvidenceConfidenceNote({
  confidence,
  explanation,
  missingEvidence
}: {
  confidence: EvidenceQualityState;
  explanation: string;
  missingEvidence: string[];
}) {
  if (confidence === "high" && missingEvidence.length === 0) {
    return null;
  }

  const meta = EVIDENCE_QUALITY_META[confidence];

  return (
    <section className={`rounded-2xl border px-5 py-4 ${toneClassName(meta.tone)}`}>
      <p className="text-xs uppercase tracking-[0.14em]">{confidence === "low" ? "Early read" : "Confidence note"}</p>
      <p className="mt-2 text-sm">{explanation}</p>
      {missingEvidence.length > 0 ? (
        <p className="mt-2 text-sm">Missing evidence: {missingEvidence.join(", ")}.</p>
      ) : null}
    </section>
  );
}
