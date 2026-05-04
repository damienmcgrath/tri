/**
 * Deterministic narrative builders. Used as the AI fallback when the LLM
 * call fails or returns a tone-violating response — every field below is
 * derived purely from the deterministic facts so the review always
 * surfaces a useful narrative.
 *
 * Two builders ship together because the orchestrator wants both shapes
 * for backward compatibility:
 *
 * - `buildDeterministicRaceReview` — the legacy single-narrative shape
 *   (`RaceReviewNarrative`).
 * - `buildDeterministicLayers` — the Phase 1B layered shape
 *   (Verdict + Race Story).
 */

import type { RaceFacts, RaceReviewNarrative } from "@/lib/race-review";
import type {
  RaceReviewLayers,
  RaceStory,
  Verdict
} from "@/lib/race-review/schemas";
import {
  capitalize,
  clip,
  formatDeltaPct,
  formatDuration,
  formatHalvesUnitLabel,
  formatPacePer100m,
  formatPaceSecPerKm,
  signed,
  sportsList
} from "@/lib/race-review/format-helpers";

export function buildDeterministicRaceReview(facts: RaceFacts): RaceReviewNarrative {
  const totalLabel = formatDuration(facts.bundle.totalDurationSec);
  const sportsPresent = facts.segments
    .filter((s) => s.role === "swim" || s.role === "bike" || s.role === "run")
    .map((s) => s.role);
  const sportsLabel = sportsPresent.join("/") || "race";

  const headline = `Race completed in ${totalLabel} across ${sportsLabel}.`;

  const narrativeParts: string[] = [
    `${capitalize(sportsLabel)} race completed in ${totalLabel}.`
  ];
  if (facts.pacing.bike?.halvesAvailable) {
    const dir = facts.pacing.bike.deltaPct >= 0 ? "rose" : "eased";
    narrativeParts.push(
      `Bike power ${dir} ${Math.abs(facts.pacing.bike.deltaPct).toFixed(1)}% second half (${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W).`
    );
  }
  if (facts.pacing.run?.halvesAvailable) {
    const dir = facts.pacing.run.deltaPct > 0 ? "eased" : "held";
    narrativeParts.push(
      `Run pace ${dir} ${Math.abs(facts.pacing.run.deltaPct).toFixed(1)}% second half (${formatPaceSecPerKm(facts.pacing.run.firstHalf)} → ${formatPaceSecPerKm(facts.pacing.run.lastHalf)} /km).`
    );
  }
  if (facts.transitions.t1DurationSec !== null || facts.transitions.t2DurationSec !== null) {
    const parts: string[] = [];
    if (facts.transitions.t1DurationSec !== null) parts.push(`T1 ${formatDuration(facts.transitions.t1DurationSec)}`);
    if (facts.transitions.t2DurationSec !== null) parts.push(`T2 ${formatDuration(facts.transitions.t2DurationSec)}`);
    narrativeParts.push(`Transitions: ${parts.join(" / ")}.`);
  }
  const narrative = narrativeParts.join(" ");

  const coachTake = facts.pacing.bike?.halvesAvailable && Math.abs(facts.pacing.bike.deltaPct) <= 2
    ? "Bike pacing held steady — repeat that controlled effort on the next race-pace ride."
    : facts.pacing.run?.halvesAvailable && facts.pacing.run.deltaPct > 5
      ? "Second-half run eased — practice negative-split runs at race pace before the next event."
      : "Race executed. Review the segment-by-segment splits to identify the next focus area.";

  const transitionNotes = facts.transitions.t1DurationSec !== null || facts.transitions.t2DurationSec !== null
    ? `Transitions: ${[
        facts.transitions.t1DurationSec !== null ? `T1 ${formatDuration(facts.transitions.t1DurationSec)}` : null,
        facts.transitions.t2DurationSec !== null ? `T2 ${formatDuration(facts.transitions.t2DurationSec)}` : null
      ].filter(Boolean).join(", ")}.`
    : null;

  const pacingNotes = {
    swim: facts.pacing.swim?.halvesAvailable
      ? { note: `${formatPacePer100m(facts.pacing.swim.firstHalf)} → ${formatPacePer100m(facts.pacing.swim.lastHalf)} per 100m (${formatDeltaPct(facts.pacing.swim.deltaPct)}).` }
      : null,
    bike: facts.pacing.bike?.halvesAvailable
      ? { note: `${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W (${formatDeltaPct(facts.pacing.bike.deltaPct)}).` }
      : null,
    run: facts.pacing.run?.halvesAvailable
      ? { note: `${formatPaceSecPerKm(facts.pacing.run.firstHalf)} → ${formatPaceSecPerKm(facts.pacing.run.lastHalf)} /km (${formatDeltaPct(facts.pacing.run.deltaPct)}).` }
      : null
  };

  return {
    headline: clip(headline, 120),
    narrative: clip(narrative, 420),
    coachTake: clip(coachTake, 220),
    transitionNotes: transitionNotes ? clip(transitionNotes, 220) : null,
    pacingNotes
  };
}

export function buildDeterministicLayers(facts: RaceFacts): RaceReviewLayers {
  const totalLabel = formatDuration(facts.bundle.totalDurationSec);
  const goalDelta = facts.goalDeltaSec;
  const goalLabel = facts.bundle.goalTimeSec ? formatDuration(facts.bundle.goalTimeSec) : null;

  const headlineParts: string[] = [`Finished in ${totalLabel}`];
  if (goalLabel && goalDelta !== null) {
    if (goalDelta > 0) headlineParts.push(`+${formatDuration(Math.abs(goalDelta))} over ${goalLabel} goal`);
    else if (goalDelta < 0) headlineParts.push(`-${formatDuration(Math.abs(goalDelta))} under ${goalLabel} goal`);
    else headlineParts.push(`on goal of ${goalLabel}`);
  }
  if (facts.pacing.bike?.halvesAvailable) {
    headlineParts.push(`bike ${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W`);
  }
  const headline = clip(headlineParts.join("; ") + ".", 160);

  const perDiscipline: Verdict["perDiscipline"] = {
    swim: facts.legStatus.swim
      ? { status: facts.legStatus.swim.label, summary: facts.legStatus.swim.evidence.join(" ").slice(0, 220) }
      : null,
    bike: facts.legStatus.bike
      ? { status: facts.legStatus.bike.label, summary: facts.legStatus.bike.evidence.join(" ").slice(0, 220) }
      : null,
    run: facts.legStatus.run
      ? { status: facts.legStatus.run.label, summary: facts.legStatus.run.evidence.join(" ").slice(0, 220) }
      : null
  };

  // Coach take in deterministic NEXT format.
  const coachTake: Verdict["coachTake"] = {
    target: facts.pacing.bike?.halvesAvailable
      ? `Hold ${facts.pacing.bike.firstHalf}W ±2% across halves`
      : "Hold even-split race pacing across halves",
    scope: "next race-pace session",
    successCriterion: "Halves move less than 2% between first and last",
    progression: "If steady, extend duration by 10 minutes the following week"
  };

  const verdict: Verdict = {
    headline,
    perDiscipline,
    coachTake,
    emotionalFrame: facts.emotionalFrameTriggered
      ? "Conditions and context made this a tough day — the data reads through that lens."
      : null
  };

  // Race story projection.
  const overall = clip(
    [
      `${capitalize(sportsList(facts))} race completed in ${totalLabel}.`,
      facts.pacing.bike?.halvesAvailable
        ? `Bike power moved ${signed(facts.pacing.bike.deltaPct)}% across halves (${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W).`
        : null,
      facts.pacing.run?.halvesAvailable
        ? `Run pace moved ${signed(facts.pacing.run.deltaPct)}% across halves.`
        : null
    ]
      .filter(Boolean)
      .join(" "),
    900
  );

  const buildLeg = (role: "swim" | "bike" | "run"): RaceStory["perLeg"]["swim"] => {
    const status = facts.legStatus[role];
    const pacing = facts.pacing[role];
    if (!status && (!pacing || !pacing.halvesAvailable)) return null;
    const evidence: string[] = [];
    if (status) evidence.push(...status.evidence);
    if (pacing?.halvesAvailable) {
      evidence.push(
        `Halves: ${formatHalvesUnitLabel(pacing.firstHalf, pacing.unit)} → ${formatHalvesUnitLabel(pacing.lastHalf, pacing.unit)}.`
      );
    }
    if (evidence.length === 0) return null;
    return {
      narrative: clip(evidence.join(" "), 420),
      keyEvidence: evidence.slice(0, 4).map((s) => clip(s, 180))
    };
  };

  const transitions =
    facts.transitions.t1DurationSec !== null || facts.transitions.t2DurationSec !== null
      ? clip(
          [
            facts.transitions.t1DurationSec !== null ? `T1 ${formatDuration(facts.transitions.t1DurationSec)}` : null,
            facts.transitions.t2DurationSec !== null ? `T2 ${formatDuration(facts.transitions.t2DurationSec)}` : null
          ]
            .filter(Boolean)
            .join(", "),
          280
        )
      : null;

  let crossDisciplineInsight: string | null = null;
  if (facts.crossDisciplineSignal.detected) {
    crossDisciplineInsight = clip(facts.crossDisciplineSignal.evidence.join(" "), 360);
  }

  const raceStory: RaceStory = {
    overall,
    perLeg: {
      swim: buildLeg("swim"),
      bike: buildLeg("bike"),
      run: buildLeg("run")
    },
    transitions,
    crossDisciplineInsight
  };

  return { verdict, raceStory };
}
