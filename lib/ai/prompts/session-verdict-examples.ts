import type { SessionVerdictOutput } from "./session-verdict";

/**
 * Few-shot verdicts used inside the session-verdict prompt. Each example
 * must parse under `sessionVerdictOutputSchema`. They cover the three main
 * execution archetypes the model meets most often: aerobic steady, interval
 * work that missed the target band, and a long effort where heat/fuelling
 * shifted the HR↔pace relationship.
 */
export const SESSION_VERDICT_FEW_SHOT: SessionVerdictOutput[] = [
  {
    purpose_statement:
      "This was a Z2 aerobic maintenance run designed to widen capillary density and improve fat oxidation without drawing on recovery. Week 4 of a 6-week build block.",
    training_block_context: "Week 4 of 6 — build block. No race in view.",
    intended_zones: "HR 135-145 bpm (Z2).",
    intended_metrics: "60 min duration at Z2 HR with stable cadence.",
    execution_summary:
      "The 60 min run held HR inside the Z2 band start to finish. No drift first to second half; cadence steady at 178 spm. Felt Good (4/5) with stable energy.",
    verdict_status: "achieved",
    metric_comparisons: [
      { metric: "average heart rate", target: "135-145 bpm", actual: "138 bpm", assessment: "on_target" },
      { metric: "duration", target: "60 min", actual: "60 min", assessment: "on_target" },
      { metric: "average cadence", target: "175-180 spm", actual: "178 spm", assessment: "on_target" }
    ],
    key_deviations: [],
    non_obvious_insight:
      "Pace-at-138 bpm improved 4 s/km vs. your 8-week rolling average — aerobic ceiling is moving up under the same cardiac cost.",
    teach:
      "HR drift under 2% over 60 min of Z2 means oxygen delivery is keeping up with demand — the clearest signal the aerobic engine is still building capacity.",
    adaptation_signal:
      "Protect this pattern. Keep Wednesday's bike conservative so Thursday's key threshold run lands fresh. No plan changes needed.",
    adaptation_type: "proceed",
    affected_session_ids: []
  },
  {
    purpose_statement:
      "Threshold intervals designed to push lactate clearance at race-relevant intensity. Key session of the week in a build block.",
    training_block_context: "Week 3 of 5 — build block.",
    intended_zones: "HR 165-175 bpm for the work reps.",
    intended_metrics: "6 × 5 min at threshold pace (4:12-4:20/km) with 2 min jog recovery.",
    execution_summary:
      "Hit the target band on the first 4 reps, then faded: reps 5 and 6 sat 5 s/km below pace with HR 3 bpm over the ceiling. Legs felt OK (3/5). Full 6 reps completed.",
    verdict_status: "partial",
    metric_comparisons: [
      { metric: "interval completion", target: "6 of 6", actual: "6 of 6", assessment: "on_target" },
      { metric: "average pace", target: "4:12-4:20/km", actual: "4:15/km first 4, 4:25/km last 2", assessment: "below" },
      { metric: "average heart rate", target: "165-175 bpm", actual: "172 bpm first 4, 178 bpm last 2", assessment: "above" }
    ],
    key_deviations: [
      {
        metric: "late-rep fade",
        description: "Reps 5 and 6 slowed 10 s/km while HR drifted 6 bpm higher — the session held stimulus in the first four reps, not the last two.",
        severity: "moderate"
      }
    ],
    non_obvious_insight:
      "HR drift of 7% between the first and last threshold reps vs. under 3% on your prior three threshold sessions points at durability, not top-end capacity, as the current limiter.",
    teach:
      "When pace drops but HR climbs inside an interval set, the aerobic system is losing efficiency before the legs — the fix is more volume, not harder intervals.",
    adaptation_signal:
      "Start Thursday's bike 5% easier than planned so Saturday's long run can absorb the residual cost. Next threshold attempt: hold the band across all 6 reps rather than pushing the first 4.",
    adaptation_type: "modify",
    affected_session_ids: []
  },
  {
    purpose_statement:
      "Long endurance run to build duration durability and fuelling resilience. Third week in a row with a 2 h+ long run.",
    training_block_context: "Week 5 of 8 — base block, race 12 weeks out.",
    intended_zones: "HR 140-150 bpm (Z2-low Z3).",
    intended_metrics: "2 h at easy-aerobic pace with stable HR and cadence across splits.",
    execution_summary:
      "Completed 2 h in hot conditions (28 °C). Pace faded 8 s/km in the second half while HR climbed 6 bpm at the same effort — classic heat-driven drift, not a fitness signal. Fuelling at 40 g/hr. Felt Hard (2/5) late.",
    verdict_status: "achieved",
    metric_comparisons: [
      { metric: "duration", target: "2 h", actual: "2 h", assessment: "on_target" },
      { metric: "average heart rate", target: "140-150 bpm", actual: "148 bpm", assessment: "on_target" },
      { metric: "average pace", target: "5:10-5:25/km", actual: "5:18/km first half, 5:26/km second half", assessment: "below" }
    ],
    key_deviations: [
      {
        metric: "heat-adjusted pace fade",
        description: "Second-half pace slowed 8 s/km at the same HR; conditions flag temperature 28 °C, not a fitness issue.",
        severity: "minor"
      }
    ],
    non_obvious_insight:
      "At 28 °C, your HR at 5:20/km pace runs 6-8 bpm higher than on a 15 °C day — this session's drift reads as heat, not decoupling. The last two long runs at cool temps held HR flat.",
    teach:
      "Heat raises HR at the same pace because blood is diverted to skin for cooling — judging fitness on hot-day HR alone under-reads the athlete. Look at perceived effort and pace-at-core-HR across days instead.",
    adaptation_signal:
      "No plan changes. Keep Tuesday's recovery spin easy given the Hard feel late in today's run. Next long run in cooler conditions will give a clean durability read.",
    adaptation_type: "proceed",
    affected_session_ids: []
  }
];

export const SESSION_VERDICT_FEW_SHOT_JSON = SESSION_VERDICT_FEW_SHOT.map((example) =>
  JSON.stringify(example, null, 2)
).join("\n---\n");
