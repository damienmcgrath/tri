import Link from "next/link";
import type { ReviewViewModel } from "@/lib/session-review";
import {
  EvidenceConfidenceNote,
  IntentVsActualGrid,
  ReviewVerdictCard,
  StimulusImpactCard
} from "@/components/training/session-review-cards";

export function SessionReviewSurface({
  sessionTitle,
  disciplineLabel,
  sessionDateLabel,
  durationLabel,
  reviewVm,
  backHref = "/calendar"
}: {
  sessionTitle: string;
  disciplineLabel: string;
  sessionDateLabel: string;
  durationLabel: string;
  reviewVm: ReviewViewModel;
  backHref?: string;
}) {
  return (
    <section className="space-y-4">
      <Link href={backHref} className="text-sm text-cyan-300 underline-offset-2 hover:underline">
        ← Back to Calendar
      </Link>

      <article className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-accent">Session review</p>
            <h1 className="mt-1 text-2xl font-semibold">{sessionTitle}</h1>
            <p className="mt-2 text-sm text-muted">
              {disciplineLabel} · {sessionDateLabel} · {durationLabel}
            </p>
          </div>
          <div className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-1 text-xs font-medium text-muted">
            {reviewVm.reviewModeLabel}
          </div>
        </div>
      </article>

      <ReviewVerdictCard
        outcome={reviewVm.reviewOutcome}
        summary={reviewVm.verdictSummary}
        confidence={reviewVm.evidenceQualityState}
        primaryGap={reviewVm.mainGap}
      />

      <IntentVsActualGrid
        intendedStimulus={reviewVm.intendedStimulus}
        didStimulusLand={reviewVm.didStimulusLand}
        metrics={reviewVm.intentVsActualMetrics}
      />

      <StimulusImpactCard
        impact={reviewVm.stimulusImpactLabel}
        effectOnWeek={reviewVm.effectOnWeekLabel}
        recommendation={reviewVm.recommendation}
      />

      <article className="surface p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">What happened</p>
            <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{reviewVm.actualExecutionSummary}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Why it matters</p>
            <p className="mt-2 text-sm text-muted">{reviewVm.whyItMatters}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">What to do next</p>
            <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{reviewVm.nextAction}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">This week</p>
            <p className="mt-2 text-sm text-muted">{reviewVm.weekAction}</p>
          </div>
        </div>
      </article>

      <EvidenceConfidenceNote
        confidence={reviewVm.evidenceQualityState}
        explanation={reviewVm.confidenceExplanation}
        missingEvidence={reviewVm.missingEvidenceLabels}
      />

      <section className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Ask coach follow-up</h2>
            <p className="mt-1 text-sm text-muted">{reviewVm.followUpIntro}</p>
          </div>
          <Link
            href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${reviewVm.followUpPrompts[0] ?? "What should I change next time?"}`)}`}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            Ask coach
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {reviewVm.followUpPrompts.map((prompt) => (
            <Link
              key={prompt}
              href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${prompt}`)}`}
              className="rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-muted transition hover:border-[hsl(var(--accent)/0.5)] hover:text-foreground"
            >
              {prompt}
            </Link>
          ))}
        </div>
      </section>
    </section>
  );
}
