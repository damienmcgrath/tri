/**
 * Race-scoped coach context loader.
 *
 * When a coach conversation is scoped to a race bundle, the chat-flow
 * loads the full race object (verdict, race story, segment diagnostics,
 * lessons, pre-race state, subjective inputs) and injects a compact
 * prompt-friendly summary into the system context.
 *
 * Two outputs:
 *   - the raw RaceBundleSummary (used by the new race-scoped tools so
 *     the model can drill into specific data without re-fetching)
 *   - a serialized context block for the system prompt
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRaceBundleSummary, type RaceBundleSummary } from "@/lib/race/bundle-helpers";

export type RaceCoachContext = {
  bundleId: string;
  summary: RaceBundleSummary;
  /** Pre-formatted prompt block. Suitable for direct interpolation. */
  promptBlock: string;
};

export async function loadRaceCoachContext(
  supabase: SupabaseClient,
  userId: string,
  bundleId: string
): Promise<RaceCoachContext | null> {
  const summary = await loadRaceBundleSummary(supabase, userId, bundleId);
  if (!summary) return null;

  return {
    bundleId,
    summary,
    promptBlock: formatRaceContextBlock(summary)
  };
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSignedDuration(sec: number): string {
  const sign = sec < 0 ? "-" : "+";
  return `${sign}${formatDuration(Math.abs(sec))}`;
}

function summarizeVerdict(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.headline !== "string") return null;
  const lines: string[] = [`headline: ${v.headline}`];
  const perDiscipline = v.perDiscipline as Record<string, unknown> | undefined;
  if (perDiscipline) {
    for (const key of ["swim", "bike", "run"] as const) {
      const entry = perDiscipline[key];
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.status === "string" && typeof e.summary === "string") {
          lines.push(`${key}: ${e.status} — ${e.summary}`);
        }
      }
    }
  }
  const coachTake = v.coachTake as Record<string, unknown> | undefined;
  if (coachTake && typeof coachTake.target === "string") {
    lines.push(`coach take: ${coachTake.target}`);
  }
  if (typeof v.emotionalFrame === "string") {
    lines.push(`emotional frame: ${v.emotionalFrame}`);
  }
  return lines.join("\n");
}

function summarizeRaceStory(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof v.overall === "string") lines.push(`overall: ${v.overall}`);
  const perLeg = v.perLeg as Record<string, unknown> | undefined;
  if (perLeg) {
    for (const key of ["swim", "bike", "run"] as const) {
      const entry = perLeg[key];
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.narrative === "string") {
          lines.push(`${key} narrative: ${e.narrative}`);
        }
      }
    }
  }
  if (typeof v.crossDisciplineInsight === "string") {
    lines.push(`cross-discipline: ${v.crossDisciplineInsight}`);
  }
  if (typeof v.transitions === "string") {
    lines.push(`transitions: ${v.transitions}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function summarizeSegmentDiagnostics(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const lines: string[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.discipline !== "swim" && r.discipline !== "bike" && r.discipline !== "run") continue;
    const discipline = r.discipline as "swim" | "bike" | "run";
    if (typeof r.aiNarrative === "string") {
      lines.push(`${discipline} diagnostic: ${r.aiNarrative}`);
    }
    const refs = r.referenceFrames as Record<string, unknown> | undefined;
    if (refs) {
      const vsPlan = refs.vsPlan as Record<string, unknown> | undefined;
      if (vsPlan && typeof vsPlan.summary === "string") {
        lines.push(`  ${discipline} vs plan: ${vsPlan.summary}`);
      }
      const vsThreshold = refs.vsThreshold as Record<string, unknown> | undefined;
      if (vsThreshold && typeof vsThreshold.summary === "string") {
        lines.push(`  ${discipline} vs threshold: ${vsThreshold.summary}`);
      }
      const vsBest = refs.vsBestComparableTraining as Record<string, unknown> | undefined;
      if (vsBest && typeof vsBest.comparison === "string" && typeof vsBest.sessionName === "string") {
        lines.push(`  ${discipline} vs best comparable training (${vsBest.sessionName}): ${vsBest.comparison}`);
      }
      const vsPrior = refs.vsPriorRace as Record<string, unknown> | undefined;
      if (vsPrior && typeof vsPrior.comparison === "string" && typeof vsPrior.raceName === "string") {
        lines.push(`  ${discipline} vs prior race (${vsPrior.raceName}): ${vsPrior.comparison}`);
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function summarizeTrainingLinks(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const lines: string[] = [];
  const windowWeeks = typeof v.windowWeeks === "number" ? v.windowWeeks : null;
  if (windowWeeks != null) lines.push(`window: ${windowWeeks} weeks`);
  if (typeof v.aiNarrative === "string" && v.aiNarrative.length > 0) {
    lines.push(`narrative: ${v.aiNarrative}`);
  }
  const perLeg = v.perLeg as Record<string, unknown> | undefined;
  if (perLeg) {
    for (const leg of ["swim", "bike", "run"] as const) {
      const arr = perLeg[leg];
      if (Array.isArray(arr) && arr.length > 0) {
        for (const entry of arr) {
          if (!entry || typeof entry !== "object") continue;
          const e = entry as Record<string, unknown>;
          if (typeof e.sessionName === "string" && typeof e.narrative === "string") {
            lines.push(`  ${leg}: ${e.sessionName} — ${e.narrative}`);
          }
        }
      }
    }
  }
  const warnings = v.warningsMissed;
  if (Array.isArray(warnings) && warnings.length > 0) {
    lines.push("warning signs missed:");
    for (const entry of warnings) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.sessionName === "string" && typeof e.observation === "string") {
        lines.push(`  - ${e.sessionName}: ${e.observation}`);
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function summarizeRetrospective(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const lines: string[] = [];
  const trajectory = v.ctlTrajectory as Record<string, unknown> | undefined;
  if (trajectory) {
    const peakCtl = typeof trajectory.peakCtl === "number" ? trajectory.peakCtl : null;
    const peakDate = typeof trajectory.peakCtlDate === "string" ? trajectory.peakCtlDate : null;
    const days = typeof trajectory.daysFromPeakToRace === "number" ? trajectory.daysFromPeakToRace : null;
    if (peakCtl != null && peakDate && days != null) {
      lines.push(`peak CTL ${peakCtl} on ${peakDate} (${days}d before race)`);
    }
  }
  const taper = v.taperReadOut as Record<string, unknown> | undefined;
  if (taper && typeof taper.complianceScore === "number") {
    lines.push(`taper compliance: ${Math.round(taper.complianceScore * 100)}%`);
  }
  const exec = v.keySessionExecutionRate as Record<string, unknown> | undefined;
  if (exec && typeof exec.totalKeySessions === "number" && typeof exec.completedKeySessions === "number") {
    lines.push(`key sessions: ${exec.completedKeySessions}/${exec.totalKeySessions}`);
  }
  const verdict = v.verdict as Record<string, unknown> | undefined;
  if (verdict) {
    if (typeof verdict.headline === "string") lines.push(`verdict: ${verdict.headline}`);
    if (typeof verdict.body === "string") lines.push(`  ${verdict.body}`);
    if (typeof verdict.actionableAdjustment === "string") {
      lines.push(`  next build: ${verdict.actionableAdjustment}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function summarizeLessons(lessons: RaceBundleSummary["lessons"]): string | null {
  if (!lessons) return null;
  const lines: string[] = [];
  if (lessons.athleteProfileTakeaways.length > 0) {
    lines.push("athlete profile takeaways:");
    for (const t of lessons.athleteProfileTakeaways) {
      lines.push(`  - [${t.confidence}] ${t.headline} — ${t.body}`);
    }
  }
  if (lessons.trainingImplications.length > 0) {
    lines.push("training implications:");
    for (const i of lessons.trainingImplications) {
      lines.push(`  - [${i.priority}] ${i.headline} — ${i.change}. why: ${i.rationale}`);
    }
  }
  if (lessons.carryForward) {
    lines.push(`carry-forward: ${lessons.carryForward.headline} — ${lessons.carryForward.instruction} (success: ${lessons.carryForward.successCriterion})`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function summarizePreRaceState(bundle: RaceBundleSummary["bundle"]): string {
  const lines: string[] = [];
  lines.push(`status: ${bundle.pre_race_snapshot_status}`);
  if (bundle.pre_race_ctl != null) lines.push(`CTL: ${bundle.pre_race_ctl}`);
  if (bundle.pre_race_atl != null) lines.push(`ATL: ${bundle.pre_race_atl}`);
  if (bundle.pre_race_tsb != null) lines.push(`TSB: ${bundle.pre_race_tsb}`);
  if (bundle.pre_race_tsb_state) lines.push(`TSB state: ${bundle.pre_race_tsb_state}`);
  if (bundle.taper_compliance_score != null) {
    const pct = Math.round(bundle.taper_compliance_score * 100);
    lines.push(`taper compliance: ${pct}%`);
  }
  if (bundle.taper_compliance_summary) {
    lines.push(`taper note: ${bundle.taper_compliance_summary}`);
  }
  return lines.join(", ");
}

function summarizeSubjective(bundle: RaceBundleSummary["bundle"]): string | null {
  if (!bundle.subjective_captured_at) return null;
  const lines: string[] = [];
  if (bundle.athlete_rating != null) lines.push(`rating: ${bundle.athlete_rating}/5`);
  if (bundle.issues_flagged.length > 0) lines.push(`issues: ${bundle.issues_flagged.join(", ")}`);
  if (bundle.athlete_notes) lines.push(`notes: ${bundle.athlete_notes}`);
  if (bundle.finish_position != null) lines.push(`overall position: ${bundle.finish_position}`);
  if (bundle.age_group_position != null) lines.push(`age-group position: ${bundle.age_group_position}`);
  return lines.length > 0 ? lines.join(", ") : null;
}

function summarizeSegments(segments: RaceBundleSummary["segments"]): string {
  const lines: string[] = [];
  for (const seg of segments) {
    const distance = seg.distanceM != null ? `${(seg.distanceM / 1000).toFixed(2)} km` : "—";
    const hr = seg.avgHr != null ? `${seg.avgHr} bpm` : "—";
    const power = seg.avgPower != null ? `${seg.avgPower} W` : "—";
    lines.push(
      `  ${seg.role.toUpperCase()} (${seg.sport}): ${formatDuration(seg.durationSec)} · ${distance} · HR ${hr} · power ${power}`
    );
  }
  return lines.join("\n");
}

function formatRaceContextBlock(summary: RaceBundleSummary): string {
  const { bundle, raceProfile, segments, review, lessons } = summary;
  const date = bundle.started_at.slice(0, 10);
  const name = raceProfile?.name ?? `Race on ${date}`;
  const distance = raceProfile?.distance_type ?? "unknown distance";
  const finish = formatDuration(bundle.total_duration_sec);
  const goal = bundle.goal_time_sec != null ? formatDuration(bundle.goal_time_sec) : null;
  const goalDelta = bundle.goal_time_sec != null
    ? formatSignedDuration(bundle.total_duration_sec - bundle.goal_time_sec)
    : null;

  const sections: string[] = [];
  sections.push(`<race_object id="${bundle.id}">`);
  sections.push(`name: ${name}`);
  sections.push(`date: ${date}`);
  sections.push(`distance: ${distance}`);
  sections.push(`finish: ${finish}${goal ? ` · goal ${goal} (${goalDelta})` : ""}`);
  sections.push(`source: ${bundle.source}${bundle.inferred_transitions ? " (transitions inferred)" : ""}`);

  sections.push("\nsegments:");
  sections.push(summarizeSegments(segments));

  sections.push(`\npre-race state: ${summarizePreRaceState(bundle)}`);

  const subjective = summarizeSubjective(bundle);
  if (subjective) sections.push(`\nsubjective: ${subjective}`);

  if (review) {
    const verdict = summarizeVerdict(review.verdict);
    if (verdict) sections.push(`\nverdict:\n${verdict}`);

    const raceStory = summarizeRaceStory(review.race_story);
    if (raceStory) sections.push(`\nrace story:\n${raceStory}`);

    const diagnostics = summarizeSegmentDiagnostics(review.segment_diagnostics);
    if (diagnostics) sections.push(`\nsegment diagnostics:\n${diagnostics}`);

    if (review.cross_discipline_insight) {
      sections.push(`\ncross-discipline insight: ${review.cross_discipline_insight}`);
    }

    const trainingLinks = summarizeTrainingLinks(review.training_to_race_links);
    if (trainingLinks) sections.push(`\ntraining-to-race links:\n${trainingLinks}`);

    const retro = summarizeRetrospective(review.pre_race_retrospective);
    if (retro) sections.push(`\npre-race retrospective:\n${retro}`);
  }

  const lessonsBlock = summarizeLessons(lessons);
  if (lessonsBlock) sections.push(`\nlessons:\n${lessonsBlock}`);

  sections.push("</race_object>");
  return sections.join("\n");
}
