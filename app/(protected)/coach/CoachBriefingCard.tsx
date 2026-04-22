import Link from "next/link";
import type { WeeklyExecutionBrief } from "@/lib/execution-review";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import type { CoachBriefingContext } from "./types";

type Props = {
  brief: WeeklyExecutionBrief;
  athleteContext: AthleteContextSnapshot | null;
  briefingContext: CoachBriefingContext;
};

export function CoachBriefingCard({ brief, athleteContext, briefingContext }: Props) {
  const recurringPattern = athleteContext?.observed.recurringPatterns[0]?.detail ?? null;

  return (
    <article className="surface p-4 md:p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="label">Coach Briefing</p>
          <h2 className="mt-1 text-xl font-semibold sm:text-2xl">{brief.weekHeadline}</h2>
          {brief.trend.reviewedCount === 0 ? <p className="mt-1.5 text-sm text-muted">{brief.weekSummary}</p> : null}
        </div>
        <Link
          href="/settings/athlete-context"
          className="shrink-0 inline-flex min-h-[44px] items-center rounded-full border border-[hsl(var(--border))] px-3 text-xs text-muted transition hover:border-[hsl(var(--accent)/0.5)] hover:text-foreground lg:min-h-0 lg:py-1.5"
        >
          Edit athlete context
        </Link>
      </div>

      {/* Trend strip — compact metadata row, only when there's data */}
      {brief.trend.reviewedCount > 0 ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="font-mono text-sm font-medium text-white">{brief.trend.reviewedCount} reviewed</span>
            <span className="text-[rgba(255,255,255,0.15)]">·</span>
            <span className="font-mono text-sm font-medium text-success">{brief.trend.onTargetCount} on target</span>
            <span className="text-[rgba(255,255,255,0.15)]">·</span>
            <span className="font-mono text-sm font-medium text-[hsl(var(--warning))]">{brief.trend.partialCount} partial</span>
            <span className="text-[rgba(255,255,255,0.15)]">·</span>
            <span className={`font-mono text-sm font-medium ${brief.trend.missedCount > 0 ? "text-danger" : "text-[rgba(255,255,255,0.3)]"}`}>
              {brief.trend.missedCount} missed
            </span>
          </div>
          {brief.weekSummary ? <p className="mt-2 text-sm text-muted">{brief.weekSummary}</p> : null}
        </div>
      ) : null}

      {/* Content — empty state vs reviewed state */}
      {brief.trend.reviewedCount === 0 ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
            <p className="card-kicker">What unlocks a stronger brief</p>
            <p className="mt-2 text-sm">Once this week has reviewed sessions, Coach will summarize what landed, what drifted, and what to protect next.</p>
            <p className="mt-2 text-xs text-tertiary">
              {briefingContext.uploadedSessionCount} uploaded · {briefingContext.linkedSessionCount} linked · {briefingContext.pendingReviewCount} pending review
            </p>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
            <p className="card-kicker">Best next move</p>
            <p className="mt-2 text-sm font-medium">{brief.nextWeekDecision}</p>
            {recurringPattern ? <p className="mt-2 text-xs text-tertiary">{recurringPattern}</p> : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4 border-t border-[hsl(var(--border))] pt-4">
          {/* Key risk — full width, only shown when there's a real risk signal */}
          {brief.keyRisk ? (
            <div>
              <p className="card-kicker text-[hsl(var(--warning))]">Key risk</p>
              <p className="mt-1.5 line-clamp-3 text-sm">{brief.keyRisk}</p>
            </div>
          ) : null}

          {/* Next-week decision — the primary action, visually prominent */}
          <div className={brief.keyRisk ? "border-t border-[hsl(var(--border))] pt-4" : ""}>
            <p className="card-kicker">Next-week decision</p>
            <p className="mt-1.5 text-base font-medium leading-snug text-white">{brief.nextWeekDecision}</p>
            {brief.confidenceNote ? <p className="mt-2 text-xs text-tertiary">{brief.confidenceNote}</p> : null}
            {recurringPattern ? <p className="mt-1 text-xs text-tertiary">{recurringPattern}</p> : null}
          </div>
        </div>
      )}

      {/* Sessions needing attention */}
      {brief.sessionsNeedingAttention.length > 0 ? (
        <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
          <p className="card-kicker">Sessions needing attention</p>
          <div className={`mt-3 grid gap-2 ${brief.sessionsNeedingAttention.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {brief.sessionsNeedingAttention.map((session) => (
              <Link
                key={session.sessionId}
                href={`/sessions/${session.sessionId}`}
                className="flex items-start gap-3 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[var(--color-surface-raised)] px-4 py-3 transition hover:border-[rgba(255,255,255,0.12)]"
                style={{ borderLeftWidth: "2px", borderLeftColor: "hsl(var(--warning))" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{session.sessionName}</p>
                  <p className="mt-0.5 truncate text-xs text-[hsl(var(--warning))]">{session.scoreHeadline}</p>
                </div>
                <span className="mt-0.5 shrink-0 text-xs text-muted">→</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
