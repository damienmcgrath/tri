import {
  SESSION_VERDICT_V2,
  buildSessionVerdictPrompt,
  orderFindings,
} from "@/lib/execution-review-prompt";
import type {
  AthletePhysModel,
  Finding,
  ResolvedIntent,
} from "@/lib/findings/types";

const cyclistAthlete: AthletePhysModel = {
  ftp: 245,
  hr_max: 188,
  weight: 72,
};

const runnerAthlete: AthletePhysModel = {
  threshold_pace: 248, // 4:08/km in sec/km
  hr_max: 192,
  weight: 68,
};

const swimmerAthlete: AthletePhysModel = {
  css: 95, // sec/100m
  hr_max: 180,
};

const planThresholdBikeIntent: ResolvedIntent = {
  source: "plan",
  type: "threshold_bike",
  structure: "intervals",
};

const longEnduranceRunIntent: ResolvedIntent = {
  source: "plan",
  type: "long_run",
  structure: "steady",
};

const swimCSSIntent: ResolvedIntent = {
  source: "athlete_described",
  type: "css_swim",
  structure: "intervals",
};

const openRideIntent: ResolvedIntent = {
  source: "open",
  type: "ride",
  structure: "open",
};

const inferredTempoRunIntent: ResolvedIntent = {
  source: "inferred",
  type: "tempo_run",
  structure: "progressive",
};

// -------- Sample 1: threshold bike, mixed-polarity findings --------
//
// Numeric claims and where they trace:
//   - normalized_power=238 W, IF=0.97  → finding F1 evidence
//   - decoupling=4.2 % between halves → finding F2 evidence
//   - tss=78 → finding F3 evidence
//   - completion ratio=1.00 → finding F4 evidence (positive)
const sample1ThresholdBike: Finding[] = [
  {
    id: "F1",
    analyzer_id: "intensity-compliance",
    analyzer_version: "1.0.0",
    category: "execution",
    polarity: "concern",
    severity: 3,
    headline: "Intervals ran 5 W under target on average",
    evidence: [
      { metric: "avg_interval_power", value: 240, unit: "W" },
      { metric: "target_power", value: 245, unit: "W", reference: "ftp" },
      { metric: "normalized_power", value: 238, unit: "W" },
      { metric: "intensity_factor", value: 0.97 },
    ],
    reasoning:
      "All four work intervals averaged 240 W against a 245 W FTP target.",
    prescription: {
      text: "NEXT threshold bike: hold 245 W on the first two intervals before easing.",
      target_metric: "interval_power",
      target_value: 245,
      confidence: "high",
    },
    scope: "session",
  },
  {
    id: "F2",
    analyzer_id: "decoupling",
    analyzer_version: "1.1.0",
    category: "durability",
    polarity: "observation",
    severity: 1,
    headline: "Mild HR drift across halves",
    evidence: [
      { metric: "decoupling_pct", value: 4.2, unit: "%" },
      { metric: "hr_first_half", value: 152, unit: "bpm" },
      { metric: "hr_second_half", value: 158, unit: "bpm" },
    ],
    reasoning: "HR/power ratio drifted 4.2% from first half to second half.",
    scope: "session",
  },
  {
    id: "F3",
    analyzer_id: "tss",
    analyzer_version: "1.0.0",
    category: "durability",
    polarity: "observation",
    severity: 1,
    headline: "TSS 78 — moderate threshold load",
    evidence: [
      { metric: "tss", value: 78 },
      { metric: "duration_min", value: 62, unit: "min" },
    ],
    reasoning: "62-minute threshold session contributed 78 TSS.",
    scope: "session",
  },
  {
    id: "F4",
    analyzer_id: "completion",
    analyzer_version: "1.0.0",
    category: "execution",
    polarity: "positive",
    severity: 1,
    headline: "Completed all four intervals",
    evidence: [
      { metric: "completion_ratio", value: 1.0 },
      { metric: "intervals_completed", value: 4 },
      { metric: "intervals_planned", value: 4 },
    ],
    reasoning: "Session structure executed in full.",
    scope: "session",
  },
];

// -------- Sample 2: long endurance run, single dominant concern --------
//
// Numeric claims:
//   - intent_match=0.62 (HR drifted into tempo) → F1 evidence
//   - completion=1.05 (ran 5% longer than plan) → F2 evidence
//   - tss=92 → F3 evidence
const sample2LongRun: Finding[] = [
  {
    id: "F1",
    analyzer_id: "intent-match",
    analyzer_version: "1.0.0",
    category: "execution",
    polarity: "concern",
    severity: 2,
    headline: "Drifted out of zone 2 in the back half",
    evidence: [
      { metric: "intent_match", value: 0.62 },
      { metric: "avg_hr", value: 162, unit: "bpm" },
      { metric: "z2_ceiling", value: 155, unit: "bpm", reference: "lthr" },
    ],
    reasoning:
      "Average HR 162 bpm exceeded the 155 bpm zone-2 ceiling for the final 35 minutes.",
    prescription: {
      text: "NEXT long run: cap HR at 155 bpm; walk 30 sec at every km if it climbs.",
      target_metric: "hr_ceiling",
      target_value: 155,
      confidence: "high",
    },
    scope: "session",
  },
  {
    id: "F2",
    analyzer_id: "completion",
    analyzer_version: "1.0.0",
    category: "execution",
    polarity: "positive",
    severity: 0,
    headline: "Hit the planned distance",
    evidence: [
      { metric: "completion_ratio", value: 1.05 },
      { metric: "distance_actual_km", value: 21.0, unit: "km" },
      { metric: "distance_planned_km", value: 20.0, unit: "km" },
    ],
    reasoning: "Ran 21.0 km against a 20.0 km plan.",
    scope: "session",
  },
  {
    id: "F3",
    analyzer_id: "tss",
    analyzer_version: "1.0.0",
    category: "durability",
    polarity: "observation",
    severity: 1,
    headline: "TSS 92 — long aerobic load",
    evidence: [
      { metric: "tss", value: 92 },
      { metric: "duration_min", value: 118, unit: "min" },
    ],
    reasoning: "Two-hour aerobic effort contributed 92 TSS.",
    scope: "session",
  },
];

// -------- Sample 3: empty findings (degenerate case) --------
const sample3Empty: Finding[] = [];

// -------- Sample 4: CSS swim with multiple high-severity concerns --------
//
// Numeric claims:
//   - css_pace=98 vs target 95 → F1
//   - swolf=42 (high) → F2
//   - rest_interval_drift=+8 sec → F3
const sample4SwimCSS: Finding[] = [
  {
    id: "F1",
    analyzer_id: "intensity-compliance",
    analyzer_version: "1.0.0",
    category: "execution",
    polarity: "concern",
    severity: 3,
    headline: "CSS reps held 3 sec/100m under target",
    evidence: [
      { metric: "avg_rep_pace_per_100m", value: 98, unit: "sec/100m" },
      { metric: "css_target", value: 95, unit: "sec/100m", reference: "css" },
    ],
    reasoning: "All eight CSS reps averaged 98 sec/100m against a 95 target.",
    prescription: {
      text: "NEXT CSS swim: hold 95 sec/100m on the first four reps; ease only on rep 5+.",
      target_metric: "rep_pace",
      target_value: 95,
      confidence: "high",
    },
    scope: "session",
  },
  {
    id: "F2",
    analyzer_id: "stroke-economy",
    analyzer_version: "1.0.0",
    category: "technique",
    polarity: "concern",
    severity: 2,
    headline: "SWOLF rose into mid-40s by rep 6",
    evidence: [
      { metric: "swolf_rep1", value: 38 },
      { metric: "swolf_rep8", value: 42 },
    ],
    reasoning: "Stroke count climbed 4 strokes per length over the set.",
    scope: "session",
  },
  {
    id: "F3",
    analyzer_id: "interval-recovery",
    analyzer_version: "1.0.0",
    category: "pacing",
    polarity: "concern",
    severity: 2,
    headline: "Rest intervals overran by 8 sec on average",
    evidence: [
      { metric: "rest_drift_sec", value: 8, unit: "sec" },
      { metric: "planned_rest_sec", value: 15, unit: "sec" },
    ],
    reasoning: "Recovery extended from 15 sec planned to 23 sec actual.",
    scope: "session",
  },
];

// -------- Sample 5: open ride with no plan reference (positive-led) --------
//
// Numeric claims:
//   - normalized_power=205 W → F1 evidence
//   - tss=64 → F2 evidence
//   - cadence_avg=88 rpm → F3 evidence
const sample5OpenRide: Finding[] = [
  {
    id: "F1",
    analyzer_id: "normalized-power",
    analyzer_version: "1.0.0",
    category: "execution",
    polarity: "observation",
    severity: 1,
    headline: "Steady aerobic ride at NP 205 W",
    evidence: [
      { metric: "normalized_power", value: 205, unit: "W" },
      { metric: "intensity_factor", value: 0.84 },
    ],
    reasoning: "82-minute ride held NP 205 W against 245 W FTP.",
    scope: "session",
  },
  {
    id: "F2",
    analyzer_id: "tss",
    analyzer_version: "1.0.0",
    category: "durability",
    polarity: "observation",
    severity: 1,
    headline: "TSS 64 — sweet-spot load",
    evidence: [
      { metric: "tss", value: 64 },
      { metric: "duration_min", value: 82, unit: "min" },
    ],
    reasoning: "Sweet-spot effort accumulated 64 TSS.",
    scope: "session",
  },
  {
    id: "F3",
    analyzer_id: "cadence",
    analyzer_version: "1.0.0",
    category: "technique",
    polarity: "positive",
    severity: 0,
    headline: "Cadence held at 88 rpm",
    evidence: [{ metric: "cadence_avg", value: 88, unit: "rpm" }],
    reasoning: "Cadence stayed in the 85-92 efficiency band throughout.",
    scope: "session",
  },
];

describe("SESSION_VERDICT_V2", () => {
  test("includes the four required output sections", () => {
    expect(SESSION_VERDICT_V2).toContain("## Session intent");
    expect(SESSION_VERDICT_V2).toContain("## Execution quality");
    expect(SESSION_VERDICT_V2).toContain("## One thing to change");
    expect(SESSION_VERDICT_V2).toContain("## Load contribution");
  });

  test("encodes the four hard rules from spec §2.5", () => {
    expect(SESSION_VERDICT_V2).toContain("# Hard rules");
    expect(SESSION_VERDICT_V2).toContain(
      "Never reference a metric that isn't in a finding.evidence array",
    );
    expect(SESSION_VERDICT_V2).toContain("Never produce hedging language");
    expect(SESSION_VERDICT_V2).toContain("Sentence case headings only");
    expect(SESSION_VERDICT_V2).toContain(
      "Prescriptions always include a number",
    );
  });
});

describe("orderFindings", () => {
  test("sorts strictly by severity desc across the whole set", () => {
    const ordered = orderFindings(sample1ThresholdBike);
    const severities = ordered.map((f) => f.severity);
    const sorted = [...severities].sort((a, b) => b - a);
    expect(severities).toEqual(sorted);
  });

  test("interleaves polarities within an equal-severity bucket (concern → observation → positive)", () => {
    const findings: Finding[] = [
      { ...sample1ThresholdBike[3], id: "P1", polarity: "positive", severity: 2 },
      { ...sample1ThresholdBike[3], id: "P2", polarity: "positive", severity: 2 },
      { ...sample1ThresholdBike[0], id: "C1", polarity: "concern", severity: 2 },
      { ...sample1ThresholdBike[0], id: "C2", polarity: "concern", severity: 2 },
      { ...sample1ThresholdBike[1], id: "O1", polarity: "observation", severity: 2 },
    ];
    const ordered = orderFindings(findings);
    expect(ordered.map((f) => f.id)).toEqual(["C1", "O1", "P1", "C2", "P2"]);
  });

  test("preserves stability for findings of identical severity and polarity", () => {
    const findings: Finding[] = [
      { ...sample1ThresholdBike[3], id: "A", polarity: "positive", severity: 1 },
      { ...sample1ThresholdBike[3], id: "B", polarity: "positive", severity: 1 },
      { ...sample1ThresholdBike[3], id: "C", polarity: "positive", severity: 1 },
    ];
    const ordered = orderFindings(findings);
    expect(ordered.map((f) => f.id)).toEqual(["A", "B", "C"]);
  });

  test("handles empty input", () => {
    expect(orderFindings([])).toEqual([]);
  });
});

describe("buildSessionVerdictPrompt", () => {
  test("returns SESSION_VERDICT_V2 verbatim as the system prompt", () => {
    const { system } = buildSessionVerdictPrompt({
      intent: planThresholdBikeIntent,
      findings: sample1ThresholdBike,
      athlete: cyclistAthlete,
    });
    expect(system).toBe(SESSION_VERDICT_V2);
  });

  test("sample 1 (threshold bike): every numeric claim in the user payload exists in a finding.evidence entry", () => {
    const { user } = buildSessionVerdictPrompt({
      intent: planThresholdBikeIntent,
      findings: sample1ThresholdBike,
      athlete: cyclistAthlete,
    });
    expect(user).toMatchSnapshot();
    // Spot-check: every metric value in the sample appears in the rendered user payload.
    for (const f of sample1ThresholdBike) {
      for (const e of f.evidence) {
        expect(user).toContain(`${e.metric}=${e.value}`);
      }
    }
    // Order: leading finding is the severity-3 concern.
    const f1Idx = user.indexOf("id=F1");
    const f4Idx = user.indexOf("id=F4");
    expect(f1Idx).toBeGreaterThan(-1);
    expect(f1Idx).toBeLessThan(f4Idx);
  });

  test("sample 2 (long run): renders prescriptive text from highest-severity finding", () => {
    const { user } = buildSessionVerdictPrompt({
      intent: longEnduranceRunIntent,
      findings: sample2LongRun,
      athlete: runnerAthlete,
    });
    expect(user).toMatchSnapshot();
    expect(user).toContain(
      "NEXT long run: cap HR at 155 bpm; walk 30 sec at every km if it climbs.",
    );
    expect(user).toContain("intent_match=0.62");
    expect(user).toContain("avg_hr=162 bpm");
  });

  test("sample 3 (empty findings): emits the no-findings sentinel without crashing", () => {
    const { user } = buildSessionVerdictPrompt({
      intent: openRideIntent,
      findings: sample3Empty,
      athlete: cyclistAthlete,
    });
    expect(user).toMatchSnapshot();
    expect(user).toContain("findings: (none");
    expect(user).toContain("type: ride");
  });

  test("sample 4 (CSS swim): orders the three concerns by severity desc", () => {
    const { user } = buildSessionVerdictPrompt({
      intent: swimCSSIntent,
      findings: sample4SwimCSS,
      athlete: swimmerAthlete,
    });
    expect(user).toMatchSnapshot();
    // Severity-3 concern (F1) renders before the severity-2 concerns (F2, F3).
    const f1Idx = user.indexOf("id=F1");
    const f2Idx = user.indexOf("id=F2");
    const f3Idx = user.indexOf("id=F3");
    expect(f1Idx).toBeLessThan(f2Idx);
    expect(f1Idx).toBeLessThan(f3Idx);
    // CSS appears in athlete block but the numeric value (95) only renders if it is in evidence.
    expect(user).toContain("css: 95");
    expect(user).toContain("css_target=95 sec/100m");
  });

  test("sample 5 (open ride): produces a coherent payload even without a concern-class finding", () => {
    const { user } = buildSessionVerdictPrompt({
      intent: inferredTempoRunIntent, // intentional mismatch — analyzer cares about findings, not intent labels
      findings: sample5OpenRide,
      athlete: cyclistAthlete,
    });
    expect(user).toMatchSnapshot();
    expect(user).toContain("normalized_power=205 W");
    expect(user).toContain("tss=64");
    expect(user).toContain("cadence_avg=88 rpm");
    // No prescriptions in this set — the (none) sentinel must appear.
    expect(user).toContain("prescription: (none)");
  });

  test("athlete block omits anchors that are not provided", () => {
    const { user } = buildSessionVerdictPrompt({
      intent: openRideIntent,
      findings: [],
      athlete: { ftp: 245 },
    });
    expect(user).toContain("ftp: 245 W");
    expect(user).not.toContain("css:");
    expect(user).not.toContain("threshold_pace");
    expect(user).not.toContain("hr_max");
    expect(user).not.toContain("weight");
  });
});
