import { createClient } from "@/lib/supabase/server";
import { addDays } from "../week-context";
import { DebriefFeedbackCard } from "./debrief-feedback-card";
import { DebriefRefreshButton } from "./debrief-refresh-button";
import { DetailsAccordion } from "../details-accordion";
import { WEEKLY_DEBRIEF_GENERATION_VERSION, getAdjacentWeeklyDebriefs, getWeeklyDebriefSnapshot, refreshWeeklyDebrief } from "@/lib/weekly-debrief";
import { localIsoDate } from "@/lib/activities/completed-activities";
import { getMacroContext } from "@/lib/training/macro-context";
import type { MacroContext } from "@/lib/training/macro-context";
import { ShareSummaryButton } from "./components/share-summary-button";

function metricToneClass(tone: "neutral" | "positive" | "muted" | "caution") {
  if (tone === "positive") return "debrief-metric-card debrief-metric-card--emphasis";
  if (tone === "caution") return "debrief-metric-card border-[hsl(var(--warning)/0.32)] bg-[hsl(var(--warning)/0.07)]";
  if (tone === "muted") return "debrief-metric-card";
  return "debrief-metric-card";
}

function statePillClass(state: "final" | "provisional", stale: boolean) {
  if (stale) return "debrief-pill signal-load";
  if (state === "provisional") return "debrief-pill signal-neutral";
  return "debrief-pill";
}

function stateLabel(state: "final" | "provisional", stale: boolean) {
  if (stale) return "Refresh available";
  return state === "provisional" ? "Provisional" : "Final";
}

const debriefDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function formatDebriefDate(iso: string) {
  return debriefDateFormatter.format(new Date(`${iso}T00:00:00.000Z`));
}

function narrativeSourceLabel(source: "ai" | "fallback" | "legacy_unknown") {
  if (source === "ai") return "AI narrative";
  if (source === "fallback") return "Fallback narrative";
  return "Source unknown";
}

function narrativeSourcePillClass(source: "ai" | "fallback" | "legacy_unknown") {
  if (source === "ai") return "debrief-pill border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]";
  if (source === "fallback") return "debrief-pill border-[hsl(var(--warning)/0.32)] bg-[hsl(var(--warning)/0.08)] text-[hsl(var(--text-primary))]";
  return "debrief-pill";
}

function metricGridClass(count: number) {
  if (count <= 2) return "relative mt-6 grid gap-3 md:grid-cols-2";
  if (count === 3) return "relative mt-6 grid gap-3 md:grid-cols-3";
  if (count === 4) return "relative mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4";
  return "relative mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5";
}

function formatMacroArcLine(ctx: MacroContext): string {
  const parts: string[] = [];

  parts.push(`Week ${ctx.currentPlanWeek} of ${ctx.totalPlanWeeks}`);

  if (ctx.currentBlock) {
    parts.push(`${ctx.currentBlock} Phase`);
  }

  if (ctx.raceName && ctx.daysToRace !== null) {
    parts.push(`${ctx.raceName} in ${ctx.daysToRace} days`);
  }

  return parts.join(" · ");
}

function formatCumulativeVolume(ctx: MacroContext): string | null {
  const parts: string[] = [];
  const { swim, bike, run } = ctx.cumulativeVolumeByDiscipline;

  if (bike.plannedMinutes > 0) {
    const label = bike.deltaPct >= -5 ? "on track" : `${Math.abs(bike.deltaPct)}% behind`;
    parts.push(`Bike: ${label}`);
  }

  if (run.plannedMinutes > 0) {
    const label = run.deltaPct >= -5 ? "on track" : `${Math.abs(run.deltaPct)}% behind`;
    parts.push(`Run: ${label}`);
  }

  if (swim.plannedMinutes > 0) {
    const label = swim.deltaPct >= -5 ? "on track" : `${Math.abs(swim.deltaPct)}% behind`;
    parts.push(`Swim: ${label}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function evidencePreviewLabel(claim: string) {
  if (/strength and one clear wobble/i.test(claim)) return "Clear strength + wobble";
  if (/strongest/i.test(claim)) return "Strongest execution";
  if (/drift/i.test(claim)) return "Biggest drift";
  if (/held the week together/i.test(claim)) return "What held";
  return claim;
}

export default async function DebriefPage({
  searchParams
}: {
  searchParams?: { weekStart?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const timeZone =
    (user.user_metadata && typeof user.user_metadata.timezone === "string" && user.user_metadata.timezone) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const todayIso = localIsoDate(new Date().toISOString(), timeZone);
  const currentWeekStart = addDays(todayIso, 0 - ((new Date(`${todayIso}T00:00:00.000Z`).getUTCDay() + 6) % 7));
  const requestedWeekStart = searchParams?.weekStart;
  const weekStart = requestedWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeekStart) ? requestedWeekStart : currentWeekStart;

  let snapshot = await getWeeklyDebriefSnapshot({
    supabase,
    athleteId: user.id,
    weekStart,
    timeZone,
    todayIso
  });

  if (snapshot.readiness.isReady && !snapshot.artifact) {
    const refreshed = await refreshWeeklyDebrief({
      supabase,
      athleteId: user.id,
      weekStart,
      timeZone,
      todayIso
    });
    snapshot = {
      readiness: refreshed.readiness,
      artifact: refreshed.artifact,
      stale: false,
      sourceUpdatedAt: refreshed.artifact?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt,
      weekStart,
      weekEnd: addDays(weekStart, 6)
    };
  }

  if (
    snapshot.artifact &&
    (snapshot.stale || snapshot.artifact.generationVersion < WEEKLY_DEBRIEF_GENERATION_VERSION)
  ) {
    const refreshed = await refreshWeeklyDebrief({
      supabase,
      athleteId: user.id,
      weekStart,
      timeZone,
      todayIso
    });
    snapshot = {
      readiness: refreshed.readiness,
      artifact: refreshed.artifact,
      stale: false,
      sourceUpdatedAt: refreshed.artifact?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt,
      weekStart,
      weekEnd: addDays(weekStart, 6)
    };
  }

  if (!snapshot.readiness.isReady || !snapshot.artifact) {
    return (
      <section className="space-y-4">
        <article className="surface p-5">
          <p className="label">Weekly Debrief</p>
          <h1 className="mt-1 text-2xl font-semibold">Not enough signal yet</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">{snapshot.readiness.reason}</p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.1em] text-tertiary">Week</p>
              <p className="mt-2 text-sm font-medium">{formatDebriefDate(snapshot.weekStart)} – {formatDebriefDate(snapshot.weekEnd)}</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.1em] text-tertiary">Key sessions</p>
              <p className="mt-2 text-sm font-medium">{snapshot.readiness.resolvedKeySessions}/{snapshot.readiness.totalKeySessions} resolved</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.1em] text-tertiary">Resolved time</p>
              <p className="mt-2 text-sm font-medium">{snapshot.readiness.resolvedMinutes}m / {snapshot.readiness.plannedMinutes}m</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/dashboard" className="btn-secondary px-3 text-xs">
              Back to dashboard
            </a>
          </div>
        </article>
      </section>
    );
  }

  const artifact = snapshot.artifact;
  const weekEnd = addDays(weekStart, 6);
  const [adjacent, macroCtx, trends, sessionsForSportMinutes, previousDebriefRow] = await Promise.all([
    getAdjacentWeeklyDebriefs({ supabase, athleteId: user.id, weekStart }),
    getMacroContext(supabase, user.id),
    import("@/lib/training/trends").then(({ detectTrends }) => detectTrends(supabase, user.id, 6)).catch(() => []),
    supabase
      .from("sessions")
      .select("sport,duration_minutes,status")
      .eq("user_id", user.id)
      .gte("date", weekStart)
      .lte("date", weekEnd),
    supabase
      .from("weekly_debriefs")
      .select("facts")
      .eq("athlete_id", user.id)
      .lt("week_start", weekStart)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);
  type SportRow = { sport: string; duration_minutes: number | null; status: string | null };
  const rawSessions: SportRow[] = (sessionsForSportMinutes.data ?? []) as SportRow[];
  const completedSessionsForWeek = rawSessions.filter((s) => s.status === "completed");
  const sportMinutes = {
    swim: completedSessionsForWeek.filter((s) => s.sport === "swim").reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0),
    bike: completedSessionsForWeek.filter((s) => s.sport === "bike").reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0),
    run: completedSessionsForWeek.filter((s) => s.sport === "run").reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)
  };
  const evidenceSupportCount = artifact.evidenceGroups.reduce((sum, group) => sum + group.supports.length, 0);

  // Week-over-week comparison data
  type PreviousFacts = { completedSessions?: number; plannedSessions?: number; completedMinutes?: number; completionPct?: number };
  const prevFacts = (previousDebriefRow?.data?.facts ?? null) as PreviousFacts | null;
  const hasWeekOverWeek = prevFacts != null && typeof prevFacts.completedSessions === "number";

  const macroArcLine = formatMacroArcLine(macroCtx);
  const cumulativeVolumeLine = formatCumulativeVolume(macroCtx);

  return (
    <section className="space-y-4">
      <article className="debrief-hero surface p-4 sm:p-6 md:p-7">
        {macroArcLine ? (
          <div className="relative mb-4 flex flex-wrap items-center gap-3 border-b border-[rgba(255,255,255,0.07)] pb-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.6)]">{macroArcLine}</p>
            {cumulativeVolumeLine ? (
              <p className="text-[11px] text-[rgba(255,255,255,0.45)]">{cumulativeVolumeLine}</p>
            ) : null}
          </div>
        ) : null}
        <div className="relative flex flex-wrap items-start gap-4">
          <div className="max-w-4xl">
            <p className="label">Weekly Debrief</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="debrief-pill debrief-pill--accent">{artifact.facts.weekRange}</span>
              <span className={statePillClass(artifact.facts.artifactStateLabel, snapshot.stale)}>{stateLabel(artifact.facts.artifactStateLabel, snapshot.stale)}</span>
              <span className={narrativeSourcePillClass(artifact.facts.narrativeSource)}>{narrativeSourceLabel(artifact.facts.narrativeSource)}</span>
            </div>
            <h1 className="mt-4 max-w-4xl text-2xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-4xl md:text-[3.25rem]">{artifact.facts.title}</h1>
            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[hsl(var(--text-primary))]">{artifact.facts.statusLine}</p>
            {snapshot.stale ? (
              <p className="mt-3 max-w-2xl text-sm text-muted">The week changed after this version was saved.</p>
            ) : artifact.facts.artifactStateNote ? (
              <p className="mt-3 max-w-2xl text-sm text-muted">{artifact.facts.artifactStateNote}</p>
            ) : null}
          </div>
          <div className="relative flex min-w-[220px] flex-col items-start gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/debrief/coach?weekStart=${artifact.weekStart}`} className="btn-secondary px-3 text-xs">
                Coach brief
              </a>
              <DebriefRefreshButton weekStart={artifact.weekStart} />
            </div>
            <ShareSummaryButton
              data={{
                weekLabel: artifact.facts.weekLabel,
                weekRange: artifact.facts.weekRange,
                completionPct: artifact.facts.completionPct,
                title: artifact.facts.title,
                executiveSummary: artifact.narrative.executiveSummary,
                raceName: macroCtx.raceName,
                daysToRace: macroCtx.daysToRace,
                sportMinutes
              }}
            />
          </div>
        </div>

        <div className={metricGridClass(artifact.facts.metrics.length)}>
          {artifact.facts.metrics.map((metric) => (
            <div key={metric.label} className={`${metricToneClass(metric.tone)} sm:min-h-[110px]`}>
              <p className="debrief-kicker">{metric.label}</p>
              <p className="mt-4 text-xl font-semibold leading-tight text-[hsl(var(--text-primary))]">{metric.value}</p>
              {metric.detail ? <p className="mt-2 text-xs text-muted">{metric.detail}</p> : null}
            </div>
          ))}
        </div>
      </article>

      {hasWeekOverWeek && prevFacts ? (() => {
        const sessionsLabel = `${artifact.facts.completedSessions}/${artifact.facts.plannedSessions}`;
        const prevSessionsLabel = `${prevFacts.completedSessions}/${prevFacts.plannedSessions}`;
        const totalHours = Math.floor(artifact.facts.completedMinutes / 60);
        const totalMins = artifact.facts.completedMinutes % 60;
        const timeLabel = totalMins > 0 ? `${totalHours}h ${totalMins}m` : `${totalHours}h`;
        const prevTotalHours = Math.floor((prevFacts.completedMinutes ?? 0) / 60);
        const prevTotalMins = (prevFacts.completedMinutes ?? 0) % 60;
        const prevTimeLabel = prevTotalMins > 0 ? `${prevTotalHours}h ${prevTotalMins}m` : `${prevTotalHours}h`;
        const completionDelta = artifact.facts.completionPct - (prevFacts.completionPct ?? 0);
        const qualityTrend = completionDelta > 5 ? "Improving" : completionDelta < -5 ? "Declining" : "Stable";
        const qualityColor = completionDelta > 5 ? "text-success" : completionDelta < -5 ? "text-danger" : "text-muted";

        return (
          <article className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.1em] text-tertiary">Sessions completed</p>
              <p className="mt-2 text-sm font-medium">{sessionsLabel}</p>
              <p className="mt-1 text-[11px] text-muted">vs {prevSessionsLabel} last week</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.1em] text-tertiary">Training time</p>
              <p className="mt-2 text-sm font-medium">{timeLabel}</p>
              <p className="mt-1 text-[11px] text-muted">vs {prevTimeLabel} last week</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.1em] text-tertiary">Execution quality</p>
              <p className={`mt-2 text-sm font-medium ${qualityColor}`}>{qualityTrend}</p>
              <p className="mt-1 text-[11px] text-muted">{artifact.facts.completionPct}% vs {prevFacts.completionPct ?? 0}% last week</p>
            </div>
          </article>
        );
      })() : null}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <article className="debrief-section-card p-6">
          <p className="debrief-kicker">Weekly read</p>
          <p className="debrief-summary mt-4 max-w-4xl">{artifact.narrative.executiveSummary}</p>
        </article>

        <article className="debrief-section-card p-4">
          <p className="debrief-kicker">Top signal</p>
          <h2 className="mt-2.5 text-[0.95rem] font-semibold tracking-[-0.02em] text-[hsl(var(--text-primary))]">{artifact.facts.primaryTakeawayTitle}</h2>
          {artifact.evidenceGroups[0]?.supports?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {artifact.evidenceGroups[0].supports.slice(0, 3).map((support) => (
                <a key={`${support.kind}-${support.id}`} href={support.href} className="debrief-pill transition hover:border-[hsl(var(--accent)/0.5)] hover:text-[hsl(var(--text-primary))]">
                  {support.label}
                </a>
              ))}
            </div>
          ) : null}
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="debrief-section-card p-5">
          <p className="debrief-kicker">What went well</p>
          <div className="mt-3 space-y-3">
            {artifact.narrative.highlights.map((item) => (
              <div key={item} className="debrief-list-card debrief-list-card--positive">
                <p className="text-sm text-[hsl(var(--text-primary))]">{item}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="debrief-section-card p-5">
          <p className="debrief-kicker">What to notice</p>
          <div className="mt-3 space-y-3">
            {artifact.narrative.observations.map((item) => (
              <div key={item} className="debrief-list-card debrief-list-card--notice">
                <p className="text-sm text-[hsl(var(--text-primary))]">{item}</p>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="debrief-section-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="debrief-kicker">Carry into next week</p>
            <p className="mt-2 text-sm text-muted">Two reminders worth keeping in mind next week.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {artifact.narrative.carryForward.map((item) => (
            <div key={item} className="debrief-carry-card">
              <p className="debrief-kicker text-accent">Carry forward</p>
              <p className="mt-3 text-[15px] font-medium leading-7 text-[hsl(var(--text-primary))]">{item}</p>
            </div>
          ))}
        </div>
      </article>

      {trends.length > 0 ? (
        <article className="debrief-section-card p-5">
          <p className="debrief-kicker">Trends</p>
          <p className="mt-2 text-sm text-muted">Patterns observed over the last 6 weeks.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trends.map((trend) => (
              <div key={trend.metric} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted">{trend.metric}</p>
                  <span className={`text-[11px] font-medium uppercase tracking-[0.08em] ${trend.direction === "improving" ? "text-success" : trend.direction === "declining" ? "text-danger" : "text-tertiary"}`}>
                    {trend.direction === "improving" ? "▲ Improving" : trend.direction === "declining" ? "▼ Declining" : "Stable"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{trend.detail}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {trend.dataPoints.slice(-4).map((pt) => (
                    <span key={pt.weekStart} className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[11px] text-tertiary">{pt.label}</span>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-tertiary">Confidence: {trend.confidence}</p>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <article className="debrief-section-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="debrief-kicker">What supports this summary</p>
            <p className="mt-2 text-sm text-muted">Open the supporting claims when you want to inspect the sessions behind them.</p>
          </div>
          {snapshot.stale ? <span className="debrief-pill signal-load">Week data changed since this version</span> : null}
        </div>

        <div className="mt-4">
          <DetailsAccordion
            title="Inspect supporting evidence"
            summaryDetail={
              <>
                <span className="debrief-pill">{artifact.evidenceGroups.length} claims</span>
                <span className="debrief-pill">{evidenceSupportCount} supports</span>
                {artifact.evidenceGroups.slice(0, 2).map((group) => (
                  <span key={group.claim} className="debrief-pill hidden xl:inline-flex">{evidencePreviewLabel(group.claim)}</span>
                ))}
              </>
            }
          >
            <div className="space-y-3">
              {artifact.evidenceGroups.map((group) => (
                <div key={group.claim} className="debrief-list-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-3xl">
                      <p className="text-sm font-semibold text-[hsl(var(--text-primary))]">{group.claim}</p>
                      <p className="mt-1.5 text-sm leading-6 text-muted">{group.detail}</p>
                    </div>
                    <span className="debrief-pill">{group.supports.length} support{group.supports.length === 1 ? "" : "s"}</span>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    {group.supports.map((support) => (
                      <a key={`${support.kind}-${support.id}`} href={support.href} className="block rounded-2xl border border-[hsl(var(--border))] bg-[rgba(255,255,255,0.02)] px-4 py-3 transition hover:border-[hsl(var(--accent)/0.42)]">
                        <p className="text-sm font-medium text-[hsl(var(--text-primary))]">{support.label}</p>
                        <p className="mt-1.5 text-sm leading-6 text-muted">{support.reason}</p>
                      </a>
                    ))}
                  </div>
                </div>
              ))}

              {artifact.evidence.length > 0 ? (
                <DetailsAccordion title={`All supporting sessions (${artifact.evidence.length})`}>
                  <div className="space-y-3">
                    {artifact.evidence.map((item) => (
                      <a key={`${item.kind}-${item.id}`} href={item.href} className="debrief-list-card block transition hover:border-[hsl(var(--accent)/0.42)]">
                        <div>
                          <p className="text-sm font-semibold text-[hsl(var(--text-primary))]">{item.label}</p>
                          <p className="mt-2 text-sm text-muted">{item.detail}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                </DetailsAccordion>
              ) : null}
            </div>
          </DetailsAccordion>
        </div>
      </article>

      <DebriefFeedbackCard
        weekStart={artifact.weekStart}
        initialHelpful={artifact.feedback.helpful}
        initialAccurate={artifact.feedback.accurate}
        initialNote={artifact.feedback.note}
      />

      <article className="debrief-section-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {adjacent.previousWeekStart ? (
              <a href={`/debrief?weekStart=${adjacent.previousWeekStart}`} className="btn-secondary w-full px-3 text-xs sm:w-auto">
                Previous saved week
              </a>
            ) : null}
            {adjacent.nextWeekStart ? (
              <a href={`/debrief?weekStart=${adjacent.nextWeekStart}`} className="btn-secondary w-full px-3 text-xs sm:w-auto">
                Next saved week
              </a>
            ) : null}
          </div>
          <a href="/dashboard" className="inline-flex min-h-[44px] items-center text-xs text-muted underline-offset-2 hover:text-[hsl(var(--text-primary))] hover:underline lg:min-h-0">
            Back to dashboard
          </a>
        </div>
      </article>
    </section>
  );
}
