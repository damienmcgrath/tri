import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadRaceBundleSummary, type RaceBundleSummary } from "@/lib/race/bundle-helpers";
import { RaceSegmentList } from "../../sessions/[sessionId]/components/race-segment-list";
import { RaceVerdictCard, type VerdictPayload } from "./components/race-verdict-card";
import { RaceStoryCard, type RaceStoryPayload } from "./components/race-story-card";
import { UnifiedPacingArc } from "./components/unified-pacing-arc";
import { SegmentDiagnosticCard, type SegmentDiagnosticPayload } from "./components/segment-diagnostic-card";
import { TransitionsAnalysisCard, type TransitionsAnalysisPayload } from "./components/transitions-analysis-card";
import { LessonsCard } from "./components/lessons-card";
import { RegenerateRaceReviewButton } from "../../sessions/[sessionId]/components/regenerate-race-review-button";
import { AskCoachButton } from "./components/ask-coach-button";
import type { PacingArcData } from "@/lib/race-review/pacing-arc";

export const dynamic = "force-dynamic";

const READINESS_BADGE: Record<
  NonNullable<RaceBundleSummary["bundle"]["pre_race_tsb_state"]>,
  { label: string; color: string; bg: string; border: string }
> = {
  fresh: { label: "Fresh", color: "rgb(52, 211, 153)", bg: "rgba(52, 211, 153, 0.08)", border: "rgba(52, 211, 153, 0.25)" },
  absorbing: { label: "Absorbing", color: "rgb(251, 191, 36)", bg: "rgba(251, 191, 36, 0.08)", border: "rgba(251, 191, 36, 0.25)" },
  fatigued: { label: "Fatigued", color: "rgb(251, 146, 60)", bg: "rgba(251, 146, 60, 0.08)", border: "rgba(251, 146, 60, 0.25)" },
  overreaching: { label: "Overreaching", color: "rgb(248, 113, 113)", bg: "rgba(248, 113, 113, 0.08)", border: "rgba(248, 113, 113, 0.25)" }
};

const ISSUE_LABELS: Record<string, string> = {
  nutrition: "Nutrition",
  mechanical: "Mechanical",
  illness: "Illness",
  navigation: "Navigation",
  pacing: "Pacing",
  mental: "Mental",
  weather: "Weather"
};

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSignedDuration(sec: number): string {
  const sign = sec < 0 ? "−" : "+";
  return `${sign}${formatDuration(Math.abs(sec))}`;
}

function formatRaceDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${dateStr}T00:00:00.000Z`));
}

function disciplineSplitFromSegments(segments: RaceBundleSummary["segments"]): Array<{ key: string; label: string; pct: number }> {
  const total = segments.reduce((sum, s) => sum + s.durationSec, 0);
  if (total === 0) return [];

  // Bucket transitions into the discipline that follows them (T1 → bike, T2 → run).
  const buckets: Record<string, number> = { swim: 0, bike: 0, run: 0 };
  for (const seg of segments) {
    if (seg.role === "swim") buckets.swim += seg.durationSec;
    else if (seg.role === "t1" || seg.role === "bike") buckets.bike += seg.durationSec;
    else if (seg.role === "t2" || seg.role === "run") buckets.run += seg.durationSec;
  }

  return [
    { key: "swim", label: "Swim", pct: buckets.swim / total },
    { key: "bike", label: "Bike + T1", pct: buckets.bike / total },
    { key: "run", label: "Run + T2", pct: buckets.run / total }
  ];
}

function disciplineSplitFromReview(review: NonNullable<RaceBundleSummary["review"]>): Array<{ key: string; label: string; pct: number }> {
  const dist = review.discipline_distribution_actual ?? {};
  const swim = Number(dist.swim ?? 0);
  const t1 = Number(dist.t1 ?? 0);
  const bike = Number(dist.bike ?? 0);
  const t2 = Number(dist.t2 ?? 0);
  const run = Number(dist.run ?? 0);
  return [
    { key: "swim", label: "Swim", pct: swim },
    { key: "bike", label: "Bike + T1", pct: bike + t1 },
    { key: "run", label: "Run + T2", pct: run + t2 }
  ];
}

export default async function RaceBundlePage({ params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(`/races/${bundleId}`)}`);
  }

  const summary = await loadRaceBundleSummary(supabase, user.id, bundleId);
  if (!summary) notFound();

  const { bundle, raceProfile, segments, review } = summary;

  const heroDate = bundle.started_at.slice(0, 10);
  const title = raceProfile?.name ?? `Race on ${formatRaceDate(heroDate)}`;
  const finishSec = bundle.total_duration_sec;
  const goalSec = bundle.goal_time_sec;
  const goalDelta = goalSec != null ? finishSec - goalSec : null;

  const distanceLabel = bundle.total_distance_m != null
    ? `${(bundle.total_distance_m / 1000).toFixed(2)} km`
    : null;

  const tsbState = bundle.pre_race_tsb_state;
  const tsbBadge = tsbState ? READINESS_BADGE[tsbState] : null;

  const split = review && review.discipline_distribution_actual
    ? disciplineSplitFromReview(review)
    : disciplineSplitFromSegments(segments);

  const askEnabled = Boolean(bundle.subjective_captured_at);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race summary</p>
            <h1 className="text-2xl font-semibold text-[rgba(255,255,255,0.92)]">{title}</h1>
            <p className="text-sm text-muted">
              {formatRaceDate(heroDate)}
              {raceProfile?.distance_type ? <> · <span className="capitalize">{raceProfile.distance_type}</span></> : null}
              {distanceLabel ? <> · {distanceLabel}</> : null}
            </p>
          </div>
          {askEnabled ? <AskCoachButton bundleId={bundleId} /> : null}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-3xl font-semibold text-[rgba(255,255,255,0.96)]">{formatDuration(finishSec)}</span>
          <span className="text-xs uppercase tracking-[0.12em] text-tertiary">finish time</span>
          {goalSec != null && goalDelta != null ? (
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-xs ${
                goalDelta <= 0
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-orange-500/30 bg-orange-500/10 text-orange-300"
              }`}
            >
              {formatSignedDuration(goalDelta)} vs goal {formatDuration(goalSec)}
            </span>
          ) : null}
          {bundle.inferred_transitions ? (
            <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-tertiary">
              Stitched
            </span>
          ) : null}
        </div>
      </header>

      <section id="pre-race-state" className="scroll-mt-20">
        <PreRaceStateStrip bundle={bundle} tsbBadge={tsbBadge} />
      </section>

      <DisciplineSplit split={split} inferredTransitions={bundle.inferred_transitions} />

      <RaceSegmentList segments={segments} />

      <section id="race-notes" className="scroll-mt-20">
        <SubjectiveSection bundle={bundle} bundleId={bundleId} />
      </section>

      <RaceReviewLayered review={review} bundle={bundle} bundleId={bundleId} />

      {summary.lessons ? (
        <section id="lessons" className="scroll-mt-20">
          <LessonsCard lessons={summary.lessons} />
        </section>
      ) : null}
    </div>
  );
}

function PreRaceStateStrip({
  bundle,
  tsbBadge
}: {
  bundle: RaceBundleSummary["bundle"];
  tsbBadge: { label: string; color: string; bg: string; border: string } | null;
}) {
  const status = bundle.pre_race_snapshot_status;

  if (status === "unavailable" || status === "pending") {
    return (
      <article className="surface p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Pre-race state</p>
        <p className="mt-2 text-sm text-muted">
          Pre-race state unavailable — fitness model had no data for this date.
        </p>
      </article>
    );
  }

  return (
    <article className="surface p-5">
      <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] pb-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Pre-race state</p>
        {tsbBadge ? (
          <span
            className="rounded-full border px-2 py-0.5 text-xs"
            style={{ color: tsbBadge.color, backgroundColor: tsbBadge.bg, borderColor: tsbBadge.border }}
          >
            {tsbBadge.label}
          </span>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Metric label="CTL" value={bundle.pre_race_ctl} fallback="—" />
        <Metric label="ATL" value={bundle.pre_race_atl} fallback="—" />
        <Metric label="TSB" value={bundle.pre_race_tsb} fallback="—" sign />
        <Metric
          label="Taper"
          value={bundle.taper_compliance_score != null ? Math.round(bundle.taper_compliance_score * 100) : null}
          fallback="—"
          unit="%"
        />
      </dl>
      {bundle.taper_compliance_summary ? (
        <p className="mt-2 text-xs text-tertiary">{bundle.taper_compliance_summary}</p>
      ) : null}
    </article>
  );
}

function Metric({
  label,
  value,
  fallback,
  unit,
  sign
}: {
  label: string;
  value: number | null;
  fallback: string;
  unit?: string;
  sign?: boolean;
}) {
  const display =
    value == null
      ? fallback
      : `${sign && value > 0 ? "+" : ""}${typeof value === "number" ? value : Number(value)}${unit ?? ""}`;
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-tertiary">{label}</dt>
      <dd className="font-mono text-base text-[rgba(255,255,255,0.92)]">{display}</dd>
    </div>
  );
}

function DisciplineSplit({
  split,
  inferredTransitions
}: {
  split: Array<{ key: string; label: string; pct: number }>;
  inferredTransitions: boolean;
}) {
  if (split.length === 0) return null;

  return (
    <article className="surface p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Discipline split</p>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full border border-[hsl(var(--border))]">
        {split.map((row) => (
          <div
            key={row.key}
            style={{ width: `${Math.max(0, Math.min(100, row.pct * 100))}%` }}
            className={
              row.key === "swim"
                ? "bg-cyan-500/70"
                : row.key === "bike"
                ? "bg-amber-500/70"
                : "bg-emerald-500/70"
            }
          />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
        {split.map((row) => (
          <div key={row.key} className="flex flex-col">
            <dt className="uppercase tracking-[0.12em] text-tertiary">{row.label}</dt>
            <dd className="font-mono text-sm text-[rgba(255,255,255,0.92)]">{Math.round(row.pct * 100)}%</dd>
          </div>
        ))}
      </dl>
      {inferredTransitions ? (
        <p className="mt-2 text-xs text-tertiary">Transitions inferred from gaps between activities.</p>
      ) : null}
    </article>
  );
}

function SubjectiveSection({
  bundle,
  bundleId
}: {
  bundle: RaceBundleSummary["bundle"];
  bundleId: string;
}) {
  if (!bundle.subjective_captured_at) {
    return (
      <article className="surface p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race notes</p>
        <p className="mt-1 text-sm text-muted">
          Add your rating, notes, and any issues so the next race review has the full picture.
        </p>
        <Link
          href={`/races/${bundleId}/notes`}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-1.5 text-sm text-[rgba(255,255,255,0.92)] transition hover:border-[rgba(255,255,255,0.18)]"
        >
          Add race notes →
        </Link>
      </article>
    );
  }

  const rating = bundle.athlete_rating;
  const issues = bundle.issues_flagged ?? [];

  return (
    <article className="surface p-5">
      <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] pb-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race notes</p>
        <Link href={`/races/${bundleId}/notes`} className="text-xs text-tertiary underline-offset-2 hover:underline">
          Edit
        </Link>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {rating != null ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-tertiary">Rating</span>
            <span aria-label={`${rating} out of 5`} className="text-amber-300">
              {"★".repeat(rating)}
              <span className="text-[hsl(var(--surface-subtle))]">{"★".repeat(5 - rating)}</span>
            </span>
          </div>
        ) : null}

        {issues.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {issues.map((issue) => (
              <span
                key={issue}
                className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-xs text-[rgba(255,255,255,0.86)]"
              >
                {ISSUE_LABELS[issue] ?? issue}
              </span>
            ))}
          </div>
        ) : null}

        {bundle.athlete_notes ? (
          <p className="whitespace-pre-wrap text-sm text-[rgba(255,255,255,0.86)]">{bundle.athlete_notes}</p>
        ) : null}

        {(bundle.finish_position != null || bundle.age_group_position != null) ? (
          <div className="flex flex-wrap gap-3 text-xs text-tertiary">
            {bundle.finish_position != null ? <span>Overall: {bundle.finish_position}</span> : null}
            {bundle.age_group_position != null ? <span>Age group: {bundle.age_group_position}</span> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function RaceReviewLayered({
  review,
  bundle,
  bundleId
}: {
  review: RaceBundleSummary["review"];
  bundle: RaceBundleSummary["bundle"];
  bundleId: string;
}) {
  // Subjective inputs gate AI generation.
  if (!bundle.subjective_captured_at) {
    return (
      <article className="surface p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race review</p>
        <p className="mt-2 text-sm text-muted">
          Add your race notes (rating, issues, anything we can&apos;t see in the data) and the verdict will appear within ~15 seconds.
        </p>
        <Link
          href={`/races/${bundleId}/notes`}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-1.5 text-sm text-[rgba(255,255,255,0.92)] transition hover:border-[rgba(255,255,255,0.18)]"
        >
          Add race notes →
        </Link>
      </article>
    );
  }

  // Subjective captured but no review yet — generation is in flight.
  const verdictPayload = parseVerdict(review?.verdict);
  const storyPayload = parseRaceStory(review?.race_story);
  const arcPayload = parseArc(review?.pacing_arc_data);
  const segmentDiagnostics = parseSegmentDiagnostics(review?.segment_diagnostics);
  const transitionsAnalysis = parseTransitionsAnalysis(review?.transitions_analysis);
  // "Updated based on your notes" indicates the current review reflects the
  // most recent subjective submission — i.e. the review's generated_at is
  // at-or-after the subjective_captured_at timestamp. Stale reviews (review
  // older than notes) deliberately show no badge; the regenerator fires
  // post-submit and will update generated_at within ~15s.
  const noteIndicator =
    review && review.generated_at && bundle.subjective_captured_at
      ? new Date(review.generated_at).getTime() >= new Date(bundle.subjective_captured_at).getTime()
      : false;

  if (!verdictPayload || !storyPayload) {
    return (
      <article className="surface p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race review</p>
        <p className="mt-2 text-sm text-[rgba(255,255,255,0.78)]">
          Generating your verdict and race story… this usually takes about 15 seconds. Refresh the page if it doesn&apos;t appear shortly.
        </p>
        <div className="mt-3">
          <RegenerateRaceReviewButton bundleId={bundleId} label="Regenerate now" />
        </div>
      </article>
    );
  }

  return (
    <>
      <RaceVerdictCard
        verdict={verdictPayload}
        isProvisional={Boolean(review?.is_provisional)}
        modelUsed={review?.model_used ?? null}
        generatedAt={review?.generated_at ?? null}
        noteIndicator={noteIndicator}
      />
      {arcPayload ? <UnifiedPacingArc data={arcPayload} bundleId={bundleId} /> : null}
      <RaceStoryCard story={storyPayload} />
      {segmentDiagnostics.map((diag) => (
        <section key={diag.discipline} id={`segment-${diag.discipline}`} className="scroll-mt-20">
          <SegmentDiagnosticCard diagnostic={diag} bundleId={bundleId} />
        </section>
      ))}
      {transitionsAnalysis ? <TransitionsAnalysisCard analysis={transitionsAnalysis} /> : null}
      <div className="flex justify-end">
        <RegenerateRaceReviewButton bundleId={bundleId} />
      </div>
    </>
  );
}

function parseVerdict(value: unknown): VerdictPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.headline !== "string") return null;
  const perDiscipline = (v.perDiscipline as Record<string, unknown>) ?? {};
  const coachTake = v.coachTake as Record<string, unknown> | undefined;
  if (!coachTake) return null;
  return {
    headline: v.headline,
    perDiscipline: {
      swim: parsePerDiscipline(perDiscipline.swim),
      bike: parsePerDiscipline(perDiscipline.bike),
      run: parsePerDiscipline(perDiscipline.run)
    },
    coachTake: {
      target: String(coachTake.target ?? ""),
      scope: String(coachTake.scope ?? ""),
      successCriterion: String(coachTake.successCriterion ?? ""),
      progression: String(coachTake.progression ?? "")
    },
    emotionalFrame: typeof v.emotionalFrame === "string" ? v.emotionalFrame : null
  };
}

function parsePerDiscipline(value: unknown): VerdictPayload["perDiscipline"]["swim"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.status !== "string" || typeof v.summary !== "string") return null;
  return {
    status: v.status as VerdictPayload["perDiscipline"]["swim"] extends infer T
      ? T extends { status: infer S } ? S : never : never,
    summary: v.summary
  };
}

function parseRaceStory(value: unknown): RaceStoryPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.overall !== "string") return null;
  const perLeg = (v.perLeg as Record<string, unknown>) ?? {};
  return {
    overall: v.overall,
    perLeg: {
      swim: parsePerLegStory(perLeg.swim),
      bike: parsePerLegStory(perLeg.bike),
      run: parsePerLegStory(perLeg.run)
    },
    transitions: typeof v.transitions === "string" ? v.transitions : null,
    crossDisciplineInsight: typeof v.crossDisciplineInsight === "string" ? v.crossDisciplineInsight : null
  };
}

function parsePerLegStory(value: unknown): RaceStoryPayload["perLeg"]["swim"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.narrative !== "string") return null;
  const evidence = Array.isArray(v.keyEvidence)
    ? v.keyEvidence.filter((s): s is string => typeof s === "string")
    : [];
  return { narrative: v.narrative, keyEvidence: evidence };
}

function parseArc(value: unknown): PacingArcData | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.totalDurationSec !== "number") return null;
  if (!Array.isArray(v.points)) return null;
  return v as unknown as PacingArcData;
}

function parseSegmentDiagnostics(value: unknown): SegmentDiagnosticPayload[] {
  if (!Array.isArray(value)) return [];
  const out: SegmentDiagnosticPayload[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const discipline = r.discipline;
    if (discipline !== "swim" && discipline !== "bike" && discipline !== "run") continue;
    const refs = (r.referenceFrames ?? {}) as Record<string, unknown>;
    const pacing = (r.pacingAnalysis ?? {}) as Record<string, unknown>;
    const anomaliesRaw = Array.isArray(r.anomalies) ? r.anomalies : [];
    out.push({
      discipline,
      referenceFrames: {
        vsPlan: parseVsPlan(refs.vsPlan),
        vsThreshold: parseVsThreshold(refs.vsThreshold),
        vsBestComparableTraining: parseVsBestComparable(refs.vsBestComparableTraining),
        vsPriorRace: parseVsPriorRace(refs.vsPriorRace)
      },
      pacingAnalysis: {
        splitType: pacing.splitType === "even" || pacing.splitType === "positive" || pacing.splitType === "negative"
          ? pacing.splitType
          : null,
        driftObservation: typeof pacing.driftObservation === "string" ? pacing.driftObservation : null,
        decouplingObservation: typeof pacing.decouplingObservation === "string" ? pacing.decouplingObservation : null
      },
      anomalies: anomaliesRaw
        .map((a): SegmentDiagnosticPayload["anomalies"][number] | null => {
          if (!a || typeof a !== "object") return null;
          const o = a as Record<string, unknown>;
          if (
            (o.type === "hr_spike" || o.type === "power_dropout" || o.type === "pace_break" || o.type === "cadence_drop") &&
            typeof o.atSec === "number" &&
            typeof o.observation === "string"
          ) {
            return { type: o.type, atSec: o.atSec, observation: o.observation };
          }
          return null;
        })
        .filter((a): a is SegmentDiagnosticPayload["anomalies"][number] => a !== null),
      aiNarrative: typeof r.aiNarrative === "string" ? r.aiNarrative : null
    });
  }
  return out;
}

function parseVsPlan(value: unknown): SegmentDiagnosticPayload["referenceFrames"]["vsPlan"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    (v.label === "on_plan" || v.label === "under" || v.label === "over") &&
    typeof v.deltaPct === "number" &&
    typeof v.summary === "string"
  ) {
    return { label: v.label, deltaPct: v.deltaPct, summary: v.summary };
  }
  return null;
}

function parseVsThreshold(value: unknown): SegmentDiagnosticPayload["referenceFrames"]["vsThreshold"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.thresholdValue === "number" &&
    (v.thresholdUnit === "watts" || v.thresholdUnit === "sec_per_km" || v.thresholdUnit === "sec_per_100m") &&
    typeof v.intensityFactor === "number" &&
    typeof v.summary === "string"
  ) {
    return {
      thresholdValue: v.thresholdValue,
      thresholdUnit: v.thresholdUnit,
      intensityFactor: v.intensityFactor,
      summary: v.summary
    };
  }
  return null;
}

function parseVsBestComparable(value: unknown): SegmentDiagnosticPayload["referenceFrames"]["vsBestComparableTraining"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.sessionId === "string" &&
    typeof v.sessionDate === "string" &&
    typeof v.sessionName === "string" &&
    typeof v.comparison === "string"
  ) {
    return {
      sessionId: v.sessionId,
      sessionDate: v.sessionDate,
      sessionName: v.sessionName,
      comparison: v.comparison
    };
  }
  return null;
}

function parseVsPriorRace(value: unknown): SegmentDiagnosticPayload["referenceFrames"]["vsPriorRace"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.bundleId === "string" &&
    typeof v.raceName === "string" &&
    typeof v.raceDate === "string" &&
    typeof v.comparison === "string"
  ) {
    return {
      bundleId: v.bundleId,
      raceName: v.raceName,
      raceDate: v.raceDate,
      comparison: v.comparison
    };
  }
  return null;
}

function parseTransitionsAnalysis(value: unknown): TransitionsAnalysisPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const t1 = parseTransitionEntry(v.t1);
  const t2 = parseTransitionEntry(v.t2);
  if (!t1 && !t2) return null;
  return { t1, t2 };
}

function parseTransitionEntry(value: unknown): TransitionsAnalysisPayload["t1"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.athleteSec !== "number" || typeof v.summary !== "string") return null;
  return {
    athleteSec: v.athleteSec,
    populationMedianSec: typeof v.populationMedianSec === "number" ? v.populationMedianSec : null,
    hrAtEnd: typeof v.hrAtEnd === "number" ? v.hrAtEnd : null,
    summary: v.summary
  };
}
