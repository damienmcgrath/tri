/**
 * Helpers for rendering the race-review embed inside the session detail page.
 * Extracted from page.tsx so the page file stays focused on session loading +
 * composition.
 *
 * The parsers turn the unknown JSON columns from race_reviews
 * (verdict / race_story / pacing_arc_data) into typed payloads. When both
 * verdict + race_story are present we render the new layered cards; otherwise
 * we fall back to the legacy RaceReviewCard.
 */

import { RaceReviewCard } from "./components/race-review-card";
import { RaceVerdictCard, type VerdictPayload } from "../../races/[bundleId]/components/race-verdict-card";
import { RaceStoryCard, type RaceStoryPayload } from "../../races/[bundleId]/components/race-story-card";
import { UnifiedPacingArc } from "../../races/[bundleId]/components/unified-pacing-arc";
import type { PacingArcData } from "@/lib/race-review/pacing-arc";

export type RaceReviewRow = {
  headline: string;
  narrative: string;
  coach_take: string;
  transition_notes: string | null;
  pacing_notes: Record<string, unknown> | null;
  discipline_distribution_actual: Record<string, number> | null;
  discipline_distribution_delta: Record<string, number> | null;
  model_used: string;
  is_provisional: boolean;
  generated_at: string;
  // Phase 1B layered columns.
  verdict: unknown;
  race_story: unknown;
  pacing_arc_data: unknown;
};

export function renderRaceReview(bundleId: string, row: RaceReviewRow) {
  const verdict = parseVerdictPayload(row.verdict);
  const story = parseRaceStoryPayload(row.race_story);
  const arc = parseArcPayload(row.pacing_arc_data);

  if (verdict && story) {
    return (
      <>
        <RaceVerdictCard
          verdict={verdict}
          isProvisional={row.is_provisional}
          modelUsed={row.model_used}
          generatedAt={row.generated_at}
        />
        {arc ? <UnifiedPacingArc data={arc} /> : null}
        <RaceStoryCard story={story} />
      </>
    );
  }

  return (
    <RaceReviewCard
      bundleId={bundleId}
      review={{
        headline: row.headline,
        narrative: row.narrative,
        coachTake: row.coach_take,
        transitionNotes: row.transition_notes,
        pacingNotes: (row.pacing_notes ?? {}) as Record<string, never>,
        disciplineDistributionActual: row.discipline_distribution_actual ?? {},
        disciplineDistributionDelta: row.discipline_distribution_delta,
        modelUsed: row.model_used,
        isProvisional: row.is_provisional,
        generatedAt: row.generated_at
      }}
    />
  );
}

function parseVerdictPayload(value: unknown): VerdictPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.headline !== "string") return null;
  const perDiscipline = (v.perDiscipline as Record<string, unknown>) ?? {};
  const coachTake = v.coachTake as Record<string, unknown> | undefined;
  if (!coachTake) return null;
  const buildLeg = (val: unknown): VerdictPayload["perDiscipline"]["swim"] => {
    if (!val || typeof val !== "object") return null;
    const o = val as Record<string, unknown>;
    if (typeof o.status !== "string" || typeof o.summary !== "string") return null;
    return { status: o.status as VerdictPayload["perDiscipline"]["swim"] extends infer T ? T extends { status: infer S } ? S : never : never, summary: o.summary };
  };
  return {
    headline: v.headline,
    perDiscipline: {
      swim: buildLeg(perDiscipline.swim),
      bike: buildLeg(perDiscipline.bike),
      run: buildLeg(perDiscipline.run)
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

function parseRaceStoryPayload(value: unknown): RaceStoryPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.overall !== "string") return null;
  const perLeg = (v.perLeg as Record<string, unknown>) ?? {};
  const buildLeg = (val: unknown): RaceStoryPayload["perLeg"]["swim"] => {
    if (!val || typeof val !== "object") return null;
    const o = val as Record<string, unknown>;
    if (typeof o.narrative !== "string") return null;
    const evidence = Array.isArray(o.keyEvidence)
      ? o.keyEvidence.filter((s): s is string => typeof s === "string")
      : [];
    return { narrative: o.narrative, keyEvidence: evidence };
  };
  return {
    overall: v.overall,
    perLeg: {
      swim: buildLeg(perLeg.swim),
      bike: buildLeg(perLeg.bike),
      run: buildLeg(perLeg.run)
    },
    transitions: typeof v.transitions === "string" ? v.transitions : null,
    crossDisciplineInsight: typeof v.crossDisciplineInsight === "string" ? v.crossDisciplineInsight : null
  };
}

function parseArcPayload(value: unknown): PacingArcData | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.totalDurationSec !== "number") return null;
  if (!Array.isArray(v.points)) return null;
  return v as unknown as PacingArcData;
}
