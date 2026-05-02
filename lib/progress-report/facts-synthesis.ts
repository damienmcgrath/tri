/**
 * Final-stage synthesis helpers for the progress-report facts orchestrator —
 * factual bullets and the limited-sample confidence note.
 */

import type {
  ProgressReportFitnessPoint,
  ProgressReportPaceAtHr,
  ProgressReportPeak
} from "./types";

export function buildFactualBullets(args: {
  volumeDeltaMinutes: number;
  volumeDeltaSessions: number;
  fitness: ProgressReportFitnessPoint[];
  paceAtHr: ProgressReportPaceAtHr[];
  peaks: ProgressReportPeak[];
}): string[] {
  const bullets: string[] = [];

  bullets.push(
    `Volume: ${args.volumeDeltaMinutes >= 0 ? "+" : ""}${args.volumeDeltaMinutes} min and ${args.volumeDeltaSessions >= 0 ? "+" : ""}${args.volumeDeltaSessions} sessions vs prior block.`
  );

  const totalFit = args.fitness.find((f) => f.sport === "total");
  if (totalFit) {
    bullets.push(
      `Total CTL: ${totalFit.currentCtlStart} → ${totalFit.currentCtlEnd} (${totalFit.currentCtlDelta >= 0 ? "+" : ""}${totalFit.currentCtlDelta}) across the block.`
    );
  }

  for (const p of args.paceAtHr) {
    if (p.direction === "insufficient") continue;
    bullets.push(p.summary);
  }

  for (const peak of args.peaks) {
    if (peak.deltaLabel && peak.prior.formatted) {
      bullets.push(`${peak.label}: ${peak.current.formatted} (${peak.deltaLabel}).`);
    }
  }

  return bullets.slice(0, 6);
}

export function buildConfidenceNote(args: {
  currentActivitiesCount: number;
  priorActivitiesCount: number;
  fitnessPoints: ProgressReportFitnessPoint[];
  paceAtHr: ProgressReportPaceAtHr[];
}): string | null {
  const notes: string[] = [];
  if (args.currentActivitiesCount < 4) {
    notes.push(`Only ${args.currentActivitiesCount} activities in the current block`);
  }
  if (args.priorActivitiesCount < 4) {
    notes.push(`only ${args.priorActivitiesCount} in the prior block`);
  }
  if (args.fitnessPoints.length === 0) {
    notes.push("no CTL data available");
  }
  const insufficientPace = args.paceAtHr.filter((p) => p.direction === "insufficient");
  if (insufficientPace.length > 0) {
    notes.push(
      `pace-at-HR unavailable for ${insufficientPace.map((p) => p.sport).join(", ")}`
    );
  }
  if (notes.length === 0) return null;
  return `Limited sample: ${notes.join("; ")}.`;
}
