import { createClient } from "@/lib/supabase/server";
import {
  PROGRESS_REPORT_GENERATION_VERSION,
  getProgressReportSnapshot,
  refreshProgressReport,
  type ProgressReportArtifact,
  type ProgressReportFacts
} from "@/lib/progress-report";
import { localIsoDate } from "@/lib/activities/completed-activities";
import { ProgressReportRefreshButton } from "./progress-report-refresh-button";
import { ProgressReportFeedbackCard } from "./progress-report-feedback-card";

export const dynamic = "force-dynamic";

function narrativeSourcePillClass(source: "ai" | "fallback" | "legacy_unknown") {
  if (source === "ai")
    return "debrief-pill border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]";
  if (source === "fallback")
    return "debrief-pill border-[hsl(var(--warning)/0.32)] bg-[hsl(var(--warning)/0.08)] text-white";
  return "debrief-pill";
}

function narrativeSourceLabel(source: "ai" | "fallback" | "legacy_unknown") {
  if (source === "ai") return "AI narrative";
  if (source === "fallback") return "Fallback narrative";
  return "Source unknown";
}

function directionPillClass(
  direction: "improving" | "declining" | "stable" | "insufficient"
) {
  if (direction === "improving")
    return "debrief-pill border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]";
  if (direction === "declining")
    return "debrief-pill border-[hsl(var(--warning)/0.32)] bg-[hsl(var(--warning)/0.08)] text-white";
  return "debrief-pill";
}

function directionGlyph(
  direction: "improving" | "declining" | "stable" | "insufficient"
) {
  if (direction === "improving") return "▲";
  if (direction === "declining") return "▼";
  if (direction === "stable") return "·";
  return "?";
}

function sportGlyph(sport: "run" | "bike" | "swim" | "total") {
  if (sport === "run") return "🏃";
  if (sport === "bike") return "🚴";
  if (sport === "swim") return "🏊";
  return "∑";
}

function renderVolumeDelta(facts: ProgressReportFacts) {
  const { deltaMinutes, deltaSessions } = facts.volume;
  return `${deltaMinutes >= 0 ? "+" : ""}${deltaMinutes} min · ${deltaSessions >= 0 ? "+" : ""}${deltaSessions} sessions vs prior block`;
}

function renderFactsHeader(facts: ProgressReportFacts, stale: boolean) {
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="debrief-pill debrief-pill--accent">{facts.blockRange}</span>
        <span className="debrief-pill">vs. {facts.priorBlockRange}</span>
        <span className={narrativeSourcePillClass(facts.narrativeSource)}>
          {narrativeSourceLabel(facts.narrativeSource)}
        </span>
        {stale ? <span className="debrief-pill signal-load">Refresh available</span> : null}
      </div>
    </>
  );
}

function renderArtifact(artifact: ProgressReportArtifact, stale: boolean) {
  const { facts, narrative } = artifact;
  const totalFitness = facts.fitnessTrajectory.find((f) => f.sport === "total");

  return (
    <>
      <article className="debrief-hero surface p-4 sm:p-6 md:p-7">
        <div className="relative flex flex-wrap items-start gap-4">
          <div className="max-w-4xl">
            <p className="label">Progress Report</p>
            {renderFactsHeader(facts, stale)}
            <h1 className="mt-4 max-w-4xl text-2xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-4xl md:text-[3.25rem]">
              {narrative.coachHeadline}
            </h1>
            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-white">
              {narrative.executiveSummary}
            </p>
            <p className="mt-2 text-sm text-muted">{renderVolumeDelta(facts)}</p>
            {facts.confidenceNote ? (
              <p className="mt-2 max-w-2xl text-xs text-tertiary">{facts.confidenceNote}</p>
            ) : null}
          </div>
          <div className="relative z-10 flex min-w-[180px] flex-col items-end gap-3">
            <ProgressReportRefreshButton blockEnd={facts.blockEnd} />
          </div>
        </div>

        {totalFitness ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="debrief-metric-card">
              <p className="debrief-kicker">Total CTL</p>
              <p className="mt-4 text-xl font-semibold leading-tight text-white">
                {totalFitness.currentCtlStart} → {totalFitness.currentCtlEnd}
              </p>
              <p className="mt-2 text-xs text-muted">
                Δ {totalFitness.currentCtlDelta >= 0 ? "+" : ""}
                {totalFitness.currentCtlDelta} across the block
              </p>
            </div>
            <div className="debrief-metric-card">
              <p className="debrief-kicker">vs Prior Block</p>
              <p className="mt-4 text-xl font-semibold leading-tight text-white">
                {totalFitness.deltaVsPrior !== null
                  ? `${totalFitness.deltaVsPrior >= 0 ? "+" : ""}${totalFitness.deltaVsPrior}`
                  : "—"}
              </p>
              <p className="mt-2 text-xs text-muted">End-of-block CTL delta</p>
            </div>
            <div className="debrief-metric-card">
              <p className="debrief-kicker">Ramp Rate</p>
              <p className="mt-4 text-xl font-semibold leading-tight text-white">
                {totalFitness.rampRate !== null ? `${totalFitness.rampRate} / wk` : "—"}
              </p>
              <p className="mt-2 text-xs text-muted">7-day CTL slope</p>
            </div>
          </div>
        ) : null}
      </article>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="debrief-section-card p-5">
          <p className="debrief-kicker">Fitness trajectory</p>
          <p className="debrief-summary mt-4 max-w-3xl">{narrative.fitnessReport}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {facts.fitnessTrajectory.map((f) => (
              <div
                key={f.sport}
                className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted">
                    {sportGlyph(f.sport)} CTL ({f.sport})
                  </p>
                  <span className={directionPillClass(f.direction)}>
                    {directionGlyph(f.direction)} {f.direction}
                  </span>
                </div>
                <p className="mt-2 text-sm text-white">
                  {f.currentCtlStart} → {f.currentCtlEnd}
                  {f.deltaVsPrior !== null
                    ? ` (Δ ${f.deltaVsPrior >= 0 ? "+" : ""}${f.deltaVsPrior} vs prior end)`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="debrief-section-card p-5">
          <p className="debrief-kicker">Durability</p>
          <p className="debrief-summary mt-4 max-w-3xl">{narrative.durabilityReport}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-xs font-medium text-muted">This block</p>
              <p className="mt-2 text-sm text-white">
                {facts.durability.current.avgDecouplingPct !== null
                  ? `${facts.durability.current.avgDecouplingPct}% avg decoupling`
                  : "No samples"}
              </p>
              <p className="mt-1 text-[11px] text-tertiary">
                {facts.durability.current.decouplingSamples} samples ·{" "}
                {facts.durability.current.poorDurabilityCount} poor-durability
              </p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-xs font-medium text-muted">Prior block</p>
              <p className="mt-2 text-sm text-white">
                {facts.durability.prior.avgDecouplingPct !== null
                  ? `${facts.durability.prior.avgDecouplingPct}% avg decoupling`
                  : "No samples"}
              </p>
              <p className="mt-1 text-[11px] text-tertiary">
                {facts.durability.prior.decouplingSamples} samples ·{" "}
                {facts.durability.prior.poorDurabilityCount} poor-durability
              </p>
            </div>
          </div>
        </article>
      </div>

      <article className="debrief-section-card p-5">
        <p className="debrief-kicker">Discipline verdicts</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {narrative.disciplineVerdicts.map((v) => (
            <div key={v.sport} className="debrief-list-card">
              <p className="text-xs font-medium text-muted">
                {sportGlyph(v.sport)} {v.sport}
              </p>
              <p className="mt-2 text-sm leading-6 text-white">{v.verdict}</p>
            </div>
          ))}
        </div>
      </article>

      {facts.paceAtHrByDiscipline.length > 0 ? (
        <article className="debrief-section-card p-5">
          <p className="debrief-kicker">Pace-at-HR</p>
          <p className="mt-2 text-sm text-muted">
            Same cost, different output — read the aerobic economy shift.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facts.paceAtHrByDiscipline.map((p) => (
              <div
                key={p.sport}
                className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted">
                    {sportGlyph(p.sport)} {p.sport}
                  </p>
                  <span className={directionPillClass(p.direction)}>
                    {directionGlyph(p.direction)} {p.direction}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-white">{p.summary}</p>
                <p className="mt-2 text-[11px] text-tertiary">
                  {p.current.sessionCount} / {p.prior.sessionCount} sessions (this / prior)
                </p>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {facts.peakPerformances.length > 0 ? (
        <article className="debrief-section-card p-5">
          <p className="debrief-kicker">Peak performances</p>
          <p className="debrief-summary mt-4 max-w-3xl">{narrative.peakPerformancesReport}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facts.peakPerformances.map((peak) => (
              <div key={`${peak.sport}-${peak.label}`} className="debrief-list-card">
                <div className="flex items-center gap-2">
                  <span>{sportGlyph(peak.sport)}</span>
                  <p className="text-xs font-medium text-muted">{peak.label}</p>
                </div>
                <p className="mt-2 text-xl font-semibold leading-tight text-white">
                  {peak.current.formatted}
                </p>
                {peak.prior.formatted ? (
                  <p className="mt-1 text-xs text-muted">vs. {peak.prior.formatted} prior block</p>
                ) : null}
                {peak.deltaLabel ? (
                  <p
                    className={`mt-1 text-[11px] ${peak.delta && peak.delta > 0 ? "text-success" : peak.delta && peak.delta < 0 ? "text-warning" : "text-muted"}`}
                  >
                    {peak.deltaLabel}
                  </p>
                ) : null}
                {peak.current.activityId ? (
                  <a
                    href={`/activities/${peak.current.activityId}`}
                    className="mt-2 inline-flex text-[11px] text-muted underline-offset-2 hover:text-white hover:underline"
                  >
                    View activity
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <article className="debrief-section-card p-5">
        <p className="debrief-kicker text-accent">Coach insight</p>
        <p className="mt-3 text-[15px] font-medium leading-7 text-white">
          {narrative.nonObviousInsight}
        </p>
        {narrative.teach ? (
          <>
            <p className="debrief-kicker mt-5">Why this matters</p>
            <p className="mt-3 text-sm leading-6 text-muted">{narrative.teach}</p>
          </>
        ) : null}
      </article>

      <article className="debrief-section-card p-5">
        <p className="debrief-kicker">Carry into next block</p>
        <p className="mt-2 text-sm text-muted">
          Two reminders worth keeping in mind as the next block starts.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {narrative.carryForward.map((item) => (
            <div key={item} className="debrief-carry-card">
              <p className="debrief-kicker text-accent">Carry forward</p>
              <p className="mt-3 text-[15px] font-medium leading-7 text-white">{item}</p>
            </div>
          ))}
        </div>
      </article>

      <ProgressReportFeedbackCard
        blockStart={artifact.blockStart}
        initialHelpful={artifact.feedback.helpful}
        initialAccurate={artifact.feedback.accurate}
        initialNote={artifact.feedback.note}
      />
    </>
  );
}

function renderEmptyState(
  blockEnd: string,
  sourceUpdatedAt: string,
  reason: string
) {
  return (
    <section className="space-y-4">
      <article className="surface p-5">
        <p className="label">Progress Report</p>
        <h1 className="mt-1 text-2xl font-semibold">No block-over-block data yet</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">{reason}</p>
        <p className="mt-2 max-w-2xl text-xs text-tertiary">
          Block ending {blockEnd}. Data last changed {sourceUpdatedAt.slice(0, 10)}.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ProgressReportRefreshButton blockEnd={blockEnd} label="Try again" />
          <a href="/dashboard" className="btn-secondary px-3 text-xs">
            Back to dashboard
          </a>
        </div>
      </article>
    </section>
  );
}

export default async function ProgressReportPage({
  searchParams
}: {
  searchParams?: Promise<{ blockEnd?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const timeZone =
    (user.user_metadata &&
      typeof user.user_metadata.timezone === "string" &&
      user.user_metadata.timezone) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const todayIso = localIsoDate(new Date().toISOString(), timeZone);
  const requestedBlockEnd = (await searchParams)?.blockEnd;
  const blockEnd =
    requestedBlockEnd && /^\d{4}-\d{2}-\d{2}$/.test(requestedBlockEnd)
      ? requestedBlockEnd
      : todayIso;

  let snapshot = await getProgressReportSnapshot({
    supabase,
    athleteId: user.id,
    blockEnd
  });

  // Gate the auto-refresh on readiness. Without this, an athlete with zero
  // current-block activities would re-trigger AI generation on every page
  // load because the source_updated_at sentinel plus the refresh path would
  // never settle into a stable "empty" state.
  const needsRefresh =
    snapshot.readiness.hasSufficientData &&
    (!snapshot.artifact ||
      snapshot.stale ||
      snapshot.artifact.generationVersion < PROGRESS_REPORT_GENERATION_VERSION);

  if (needsRefresh) {
    try {
      const artifact = await refreshProgressReport({
        supabase,
        athleteId: user.id,
        blockEnd
      });
      snapshot = {
        ...snapshot,
        artifact,
        stale: false,
        sourceUpdatedAt: artifact.sourceUpdatedAt
      };
    } catch {
      // Keep the existing snapshot; render will fall back to the empty state
      // below if there is still no artifact.
    }
  }

  if (!snapshot.artifact) {
    const reason = snapshot.readiness.hasSufficientData
      ? "We couldn't assemble a report for this block. Try again shortly."
      : `We need at least ${snapshot.readiness.currentBlockActivityCount === 0 ? "one activity" : "more activities"} in the current 4-week block to compare it to the prior one. Log a few sessions and come back.`;
    return renderEmptyState(snapshot.blockEnd, snapshot.sourceUpdatedAt, reason);
  }

  return <section className="space-y-4">{renderArtifact(snapshot.artifact, snapshot.stale)}</section>;
}
