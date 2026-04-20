import type { WeeklyDebriefNarrative } from "./types";

/**
 * Few-shot narratives used inside the weekly-debrief narrative prompt.
 * Each example must parse under `weeklyDebriefNarrativeSchema`. They cover
 * two archetypes the model meets most often: a clean build week where key
 * work landed, and an interrupted week where recovery or illness disrupted
 * the plan but positive carry-forward still existed.
 */
export const WEEKLY_NARRATIVE_FEW_SHOT: WeeklyDebriefNarrative[] = [
  {
    executiveSummary:
      "A textbook build week — three threshold sessions held target while volume climbed 12% over the prior week. Aerobic HR at the same power kept falling, and Friday's long ride finished with the cleanest durability read in four weeks.",
    highlights: [
      "All three key sessions landed on target (Tue tempo, Thu threshold bike, Sat long run).",
      "Threshold power held 260 W for the third week running while HR at that power dropped from 168 to 164 bpm.",
      "Friday's 3 h ride drifted only 3% in the final hour vs. 8% on the equivalent ride four weeks ago."
    ],
    observations: [
      "Every key session this week followed a sleep rating of 4+ — the recovery side of the plan is holding up the execution side.",
      "Cadence on easy runs settled at 178-180 spm, up from the 172-174 range earlier in the block."
    ],
    carryForward: [
      "Hold the same CTL trajectory next week before pushing intensity — the aerobic ceiling is still moving under the current load.",
      "Next Friday's long ride can extend to 3h30 at the same power if HR drift under 5% repeats on Tuesday's tempo."
    ],
    nonObviousInsight:
      "Threshold HR-at-260W has dropped 4 bpm over three weeks while absolute power held flat — the aerobic base is expanding under the ceiling, so the next training gain comes from duration, not intensity.",
    teach:
      "When HR at the same sustained power trends down over multiple weeks, the aerobic system is getting more efficient at the current ceiling — the cheapest next gain is volume, not harder intervals."
  },
  {
    executiveSummary:
      "A disrupted week. A mid-week cold knocked Wednesday and Thursday out, so two of three key sessions slipped. The work that happened still held intent — the open question is how much of the block's aerobic momentum carried through.",
    highlights: [
      "Tuesday's threshold run landed cleanly at 4:18/km average pace before illness arrived.",
      "Sunday's easy 45 min run returned with HR in Z2 and no drift, suggesting recovery is on track.",
      "Total load dropped 32% vs. the prior week — a real deload rather than a hidden overload."
    ],
    observations: [
      "Only one key session completed of three — the missing threshold bike and long run are the gap to watch.",
      "Motivation rated 2/5 across Wed-Fri; back to 4/5 on Sunday — illness signal, not a training-load signal.",
      "Resting HR spiked 4 bpm on Wednesday and returned to baseline by Saturday."
    ],
    carryForward: [
      "Next week, treat as a re-entry: pull intensity back 10% on the first key session to confirm the aerobic base survived the illness.",
      "If Tuesday's tempo lands clean, Saturday's long run can resume at the original block volume rather than backing off further."
    ],
    nonObviousInsight:
      "Resting HR normalised within four days and Sunday's easy run showed no drift — aerobic capacity likely held, which is why the week reads as disruption rather than loss.",
    teach:
      "A 3-4 day illness rarely costs measurable aerobic fitness; what erodes is the skill of hard work. Re-entry should test intensity cautiously before assuming detraining."
  }
];

export const WEEKLY_NARRATIVE_FEW_SHOT_JSON = WEEKLY_NARRATIVE_FEW_SHOT.map((example) =>
  JSON.stringify(example, null, 2)
).join("\n---\n");
