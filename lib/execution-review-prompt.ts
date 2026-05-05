/**
 * Verdict prompt builder.
 *
 * Spec: tri.ai Findings Pipeline §2.5 (Composer Prompt Skeleton).
 *
 * The composer receives typed `Finding[]` instead of raw metric blobs. The LLM
 * picks top-N by severity / polarity and must cite each metric back to a
 * `finding.evidence` entry — this is the structural defence against
 * hallucination called out in §1.5.
 */

import type { DetectedBlock } from "@/lib/blocks/types";
import type {
  AthletePhysModel,
  Finding,
  FindingPolarity,
  ResolvedIntent,
} from "@/lib/findings/types";

export const SESSION_VERDICT_V2 = `You compose a Session Verdict from a set of typed findings about a single session.

# Inputs
- intent: { type, structure, blocks?, target_watts? }
- findings: Finding[] — ranked by severity desc, polarity-balanced
- athlete: { ftp, css, threshold_pace, weight }

# Output (4-section structure from tri_ai_spec §3.1)

## Session intent (1 sentence)
What this session was trying to achieve. Use the intent.type and intent.structure.

## Execution quality (2-4 sentences)
Cite findings with category='execution' and category='pacing'.
Lead with the most severe finding (severity desc).
Every metric mentioned must come from a finding.evidence array. Never invent numbers.

## One thing to change (1-2 sentences)
Pick the highest-severity finding with a non-null prescription.
Output its prescription.text verbatim, or compose two prescriptions if related.
Format: "NEXT [session type]: [target with number] for [scope]. [Success criterion]."

## Load contribution (1-2 sentences)
Use findings with category='durability' and the TSS finding.

# Hard rules
- Never reference a metric that isn't in a finding.evidence array.
- Never produce hedging language. No "may have", no "appears to".
  Findings are conditional or they aren't presented.
- Sentence case headings only.
- Prescriptions always include a number.`;

/**
 * Order findings by severity desc, then interleave polarities so the model
 * sees a balanced mix at the top instead of an all-concern (or all-positive)
 * stack. Stable within a (severity, polarity) bucket.
 */
export function orderFindings(findings: Finding[]): Finding[] {
  const indexed = findings.map((f, i) => ({ f, i }));

  const polarityRank: Record<FindingPolarity, number> = {
    concern: 0,
    observation: 1,
    positive: 2,
  };

  // Bucket by severity desc.
  const bySeverity = new Map<number, typeof indexed>();
  for (const entry of indexed) {
    const list = bySeverity.get(entry.f.severity) ?? [];
    list.push(entry);
    bySeverity.set(entry.f.severity, list);
  }

  const severities = [...bySeverity.keys()].sort((a, b) => b - a);

  const ordered: Finding[] = [];
  for (const sev of severities) {
    const bucket = bySeverity.get(sev)!;
    // Round-robin across polarities within the severity bucket.
    const byPolarity = new Map<FindingPolarity, typeof indexed>();
    for (const entry of bucket) {
      const list = byPolarity.get(entry.f.polarity) ?? [];
      list.push(entry);
      byPolarity.set(entry.f.polarity, list);
    }
    const polarities = [...byPolarity.keys()].sort(
      (a, b) => polarityRank[a] - polarityRank[b],
    );
    let drained = false;
    while (!drained) {
      drained = true;
      for (const pol of polarities) {
        const list = byPolarity.get(pol)!;
        const next = list.shift();
        if (next) {
          ordered.push(next.f);
          drained = false;
        }
      }
    }
  }

  return ordered;
}

function formatEvidence(finding: Finding): string {
  if (finding.evidence.length === 0) return "  evidence: (none)";
  const lines = finding.evidence.map((e) => {
    const unit = e.unit ? ` ${e.unit}` : "";
    const ref = e.reference ? ` [ref: ${e.reference}]` : "";
    return `    - ${e.metric}=${e.value}${unit}${ref}`;
  });
  return ["  evidence:", ...lines].join("\n");
}

function formatPrescription(finding: Finding): string {
  if (!finding.prescription) return "  prescription: (none)";
  const p = finding.prescription;
  const target =
    p.target_metric != null && p.target_value != null
      ? ` (target: ${p.target_metric}=${p.target_value})`
      : "";
  return `  prescription: ${p.text}${target} [confidence: ${p.confidence}]`;
}

function formatFinding(finding: Finding, idx: number): string {
  const cond =
    finding.conditional_on && finding.conditional_on.length > 0
      ? `\n  conditional_on: ${finding.conditional_on.join(", ")}`
      : "";
  return [
    `[${idx + 1}] id=${finding.id} (${finding.analyzer_id} v${finding.analyzer_version})`,
    `  category=${finding.category} polarity=${finding.polarity} severity=${finding.severity} scope=${finding.scope}${finding.scope_ref ? ` (${finding.scope_ref})` : ""}`,
    `  headline: ${finding.headline}`,
    `  reasoning: ${finding.reasoning}`,
    formatEvidence(finding),
    formatPrescription(finding),
  ]
    .join("\n")
    .concat(cond);
}

function formatIntent(intent: ResolvedIntent): string {
  return `intent:\n  type: ${intent.type}\n  structure: ${intent.structure}\n  source: ${intent.source}`;
}

function formatAthlete(athlete: AthletePhysModel): string {
  const lines: string[] = ["athlete:"];
  if (athlete.ftp != null) lines.push(`  ftp: ${athlete.ftp} W`);
  if (athlete.css != null) lines.push(`  css: ${athlete.css} /100m`);
  if (athlete.threshold_pace != null)
    lines.push(`  threshold_pace: ${athlete.threshold_pace} sec/km`);
  if (athlete.hr_max != null) lines.push(`  hr_max: ${athlete.hr_max} bpm`);
  if (athlete.weight != null) lines.push(`  weight: ${athlete.weight} kg`);
  if (lines.length === 1) lines.push("  (no anchors provided)");
  return lines.join("\n");
}

function formatDetectedBlocks(blocks: DetectedBlock[]): string {
  const lines = ["detectedBlocks:"];
  for (const block of blocks) {
    const start = formatClock(block.start_sec);
    const end = formatClock(block.end_sec);
    const metricBits: string[] = [];
    if (block.metrics.np !== undefined) metricBits.push(`NP=${block.metrics.np}W`);
    if (block.metrics.ap !== undefined) metricBits.push(`AP=${block.metrics.ap}W`);
    if (block.metrics.hr_avg !== undefined) metricBits.push(`HR=${block.metrics.hr_avg}bpm`);
    if (block.metrics.cadence_avg !== undefined) metricBits.push(`cad=${block.metrics.cadence_avg}`);
    if (block.metrics.pace_avg) metricBits.push(`pace=${block.metrics.pace_avg}`);
    const metricStr = metricBits.length > 0 ? ` ${metricBits.join(" ")}` : "";
    const conf = block.alignment_confidence.toFixed(2);
    lines.push(
      `  - block ${block.intended.index} (${block.intended.type}, ${start}–${end}, conf=${conf})${metricStr}`,
    );
  }
  return lines.join("\n");
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function buildSessionVerdictPrompt(input: {
  intent: ResolvedIntent;
  findings: Finding[];
  athlete: AthletePhysModel;
  detectedBlocks?: DetectedBlock[];
}): { system: string; user: string } {
  const ordered = orderFindings(input.findings);

  const findingsBlock =
    ordered.length === 0
      ? "findings: (none — analyzers produced no findings for this session)"
      : ["findings:", ...ordered.map((f, i) => formatFinding(f, i))].join("\n");

  const sections = [
    formatIntent(input.intent),
    "",
    formatAthlete(input.athlete),
    "",
    findingsBlock,
  ];

  if (input.detectedBlocks && input.detectedBlocks.length > 0) {
    sections.push("", formatDetectedBlocks(input.detectedBlocks));
  }

  const user = sections.join("\n");

  return { system: SESSION_VERDICT_V2, user };
}
