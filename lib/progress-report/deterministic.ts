import type {
  ProgressReportFacts,
  ProgressReportNarrative,
  ProgressReportDisciplineVerdict
} from "./types";

function formatCtlChange(delta: number): string {
  const abs = Math.abs(delta);
  if (abs < 0.5) return "held steady";
  return `${delta > 0 ? "rose" : "dropped"} ${abs.toFixed(1)} points`;
}

function buildDisciplineVerdict(
  facts: ProgressReportFacts,
  sport: "run" | "bike" | "swim"
): ProgressReportDisciplineVerdict | null {
  const pace = facts.paceAtHrByDiscipline.find((p) => p.sport === sport);
  const peak = facts.peakPerformances.find((p) => p.sport === sport);
  if (!pace && !peak) return null;

  const parts: string[] = [];
  if (pace) parts.push(pace.summary);
  if (peak?.deltaLabel && peak.prior.formatted) {
    parts.push(`Peak ${peak.label.toLowerCase()}: ${peak.current.formatted} (${peak.deltaLabel}).`);
  } else if (peak) {
    parts.push(`Peak ${peak.label.toLowerCase()} this block: ${peak.current.formatted}.`);
  }
  if (parts.length === 0) return null;
  return { sport, verdict: parts.join(" ").slice(0, 260) };
}

export function buildDeterministicNarrative(
  facts: ProgressReportFacts
): ProgressReportNarrative {
  const total = facts.fitnessTrajectory.find((f) => f.sport === "total");
  const ctlSentence = total
    ? `Total CTL ${formatCtlChange(total.currentCtlDelta)} (${total.currentCtlStart} → ${total.currentCtlEnd}).`
    : "CTL trajectory was not available for this block.";

  const volumeSentence = `Logged ${facts.volume.current.totalMinutes} minutes across ${facts.volume.current.totalSessions} sessions vs. ${facts.volume.prior.totalMinutes}/${facts.volume.prior.totalSessions} the prior block.`;

  const disciplineVerdicts = (["run", "bike", "swim"] as const)
    .map((s) => buildDisciplineVerdict(facts, s))
    .filter((v): v is ProgressReportDisciplineVerdict => v !== null);

  const safeVerdicts: ProgressReportDisciplineVerdict[] =
    disciplineVerdicts.length > 0
      ? disciplineVerdicts
      : [
          {
            sport: "run",
            verdict:
              "Not enough matched-intent sessions across both blocks to issue a discipline verdict yet."
          }
        ];

  const summaryBits: string[] = [volumeSentence, ctlSentence];
  for (const pace of facts.paceAtHrByDiscipline) {
    if (pace.direction !== "insufficient") {
      summaryBits.push(pace.summary);
      break;
    }
  }

  const executiveSummary = summaryBits.join(" ").slice(0, 460);

  const fitnessReport = total
    ? `Total CTL moved ${total.currentCtlStart} → ${total.currentCtlEnd} (Δ ${total.currentCtlDelta >= 0 ? "+" : ""}${total.currentCtlDelta}).${
        total.deltaVsPrior !== null
          ? ` End-of-block CTL is ${total.deltaVsPrior >= 0 ? "+" : ""}${total.deltaVsPrior} vs the end of the prior block.`
          : ""
      }`
    : "CTL history did not cover both blocks; no fitness trajectory to report.";

  const durabilityReport =
    facts.durability.direction === "insufficient"
      ? "Durability is undetermined for this block — not enough ≥45-min endurance sessions with split-halves data."
      : facts.durability.summary;

  const topPeak = facts.peakPerformances[0];
  const peakPerformancesReport = topPeak
    ? topPeak.deltaLabel && topPeak.prior.formatted
      ? `${topPeak.label}: ${topPeak.current.formatted} (${topPeak.deltaLabel}).`
      : `${topPeak.label} this block: ${topPeak.current.formatted}.`
    : "No block-level peaks qualified against the distance/duration thresholds.";

  const improving = facts.paceAtHrByDiscipline.find((p) => p.direction === "improving");
  const declining = facts.paceAtHrByDiscipline.find((p) => p.direction === "declining");
  const coachHeadline = improving
    ? `${improving.sport[0].toUpperCase()}${improving.sport.slice(1)} economy is climbing — evidence in the numbers`
    : declining
      ? `${declining.sport[0].toUpperCase()}${declining.sport.slice(1)} is leaking output at the same cost — worth a look`
      : "Steady block — no clear economy shift yet";

  const insufficientSports = facts.paceAtHrByDiscipline
    .filter((p) => p.direction === "insufficient")
    .map((p) => p.sport);
  const nonObviousInsight =
    improving && declining
      ? `${improving.sport} pace-at-HR is ${improving.direction}, while ${declining.sport} is ${declining.direction} — adaptation is concentrating unevenly across disciplines.`
      : insufficientSports.length > 0
        ? `Trend read blocked for ${insufficientSports.join(", ")} — add more HR-equipped sessions before reading a block-over-block shift.`
        : "Not enough matched-intent signal to surface a cross-discipline insight this block.";

  const carryForward: [string, string] = [
    facts.durability.direction === "declining"
      ? "Protect one long aerobic session per week next block — durability drifted this block."
      : "Keep one long aerobic session per week to preserve the durability you built.",
    facts.volume.deltaMinutes < -60
      ? "Volume fell sharply vs prior block — audit calendar and recovery before trimming further."
      : facts.volume.deltaMinutes > 120
        ? "Volume jumped sharply — watch fatigue signals in the next two weeks."
        : "Hold the current volume envelope and focus on execution quality over minutes."
  ];

  return {
    coachHeadline,
    executiveSummary,
    fitnessReport,
    durabilityReport,
    peakPerformancesReport,
    disciplineVerdicts: safeVerdicts,
    nonObviousInsight,
    teach: null,
    carryForward
  };
}
