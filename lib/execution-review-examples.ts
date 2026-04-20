import type { CoachVerdict } from "@/lib/execution-review-types";
import { COACH_VERDICT_EXAMPLE } from "@/lib/execution-review-types";

/**
 * Few-shot verdicts used as golden references inside the execution-review
 * prompt. The first example doubles as the canonical schema fixture
 * (`COACH_VERDICT_EXAMPLE`) so the few-shot wiring and the schema reminder
 * stay in sync. Each example must parse under `coachVerdictSchema`.
 */
export const COACH_VERDICT_FEW_SHOT: CoachVerdict[] = [
  COACH_VERDICT_EXAMPLE,
  {
    sessionVerdict: {
      headline: "Z2 held cleanly — aerobic bank grew",
      summary: "The 60-minute easy run stayed inside the planned Z2 band from start to finish with no HR drift and stable cadence.",
      intentMatch: "on_target",
      executionCost: "low",
      confidence: "high",
      nextCall: "move_on"
    },
    explanation: {
      sessionIntent: "Z2 aerobic maintenance to widen capillary density without drawing on recovery.",
      whatHappened: "Average HR 138 bpm held inside target (135-145) for the full 60 min with <1% drift first-to-second half. Cadence steady at 178 spm.",
      whyItMatters: "Low-cost aerobic volume is the cheapest fitness in the week — it compounds without taxing recovery.",
      oneThingToChange: "NEXT Z2 run: extend to 70 min at the same HR cap. Success: drift stays under 2%. If that lands, add a 5 min tempo segment the week after.",
      whatToDoNextTime: "Repeat the same HR cap and cadence target on the next long easy day.",
      whatToDoThisWeek: "Protect this pattern — keep Wednesday's bike conservative so Thursday's key session lands fresh."
    },
    nonObviousInsight: "Pace-at-138bpm improved 4s/km vs. your 8-week rolling average — the aerobic ceiling is moving up under the same cardiac cost.",
    teach: "HR drift under 2% at steady output over 60 min is the clearest signal that the aerobic system is building capacity: oxygen delivery is keeping pace with demand without creeping effort.",
    uncertainty: {
      label: "confident_read",
      detail: "Full split evidence and HR trace make this a strong read.",
      missingEvidence: []
    },
    citedEvidence: [
      {
        claim: "HR stayed inside target for the full session.",
        support: ["Avg HR 138 bpm", "First half 137, second half 139", "Target 135-145 bpm"]
      }
    ]
  },
  {
    sessionVerdict: {
      headline: "Long ride finished, durability leaking",
      summary: "The 3-hour endurance ride completed but HR-per-watt climbed 8% after the two-hour mark, flagging a durability ceiling rather than a fitness issue.",
      intentMatch: "partial",
      executionCost: "moderate",
      confidence: "high",
      nextCall: "adjust_next_key_session"
    },
    explanation: {
      sessionIntent: "Endurance base ride to build long-duration aerobic capacity and fuelling resilience.",
      whatHappened: "Average power 205 W held across the full ride. HR drift 8% from hour two onwards at the same power, despite a flat course and mild conditions.",
      whyItMatters: "At this stage of the block the limiter is duration durability, not peak power. The drift shows the aerobic system starting to lose efficiency late in long work.",
      oneThingToChange: "NEXT long ride: hold 200 W for 3h30 with a 20g/hr carb bump from hour two. Success: drift stays under 5%. If it does, extend to 4h.",
      whatToDoNextTime: "Eat earlier and keep power 5% below this week's ceiling through the first two hours.",
      whatToDoThisWeek: "Keep Thursday's threshold bike steady rather than progressing — the durability cost of this ride is still in the system."
    },
    nonObviousInsight: "This is the third consecutive long ride where drift spiked after hour two at a similar power — durability, not top-end, is the pattern across the block.",
    teach: "Aerobic decoupling above 5% over a long ride means oxygen supply is outrunning delivery as substrate and thermoregulation load up — volume, fuelling, and pacing are the fixes, not more intensity.",
    uncertainty: {
      label: "confident_read",
      detail: "Three prior comparable rides make this a high-confidence trend read.",
      missingEvidence: []
    },
    citedEvidence: [
      {
        claim: "Durability drift showed up in hour three.",
        support: ["HR 145 → 157 bpm at 205 W", "Prior two long rides drifted similarly from hour two", "Ambient 18°C, flat course"]
      }
    ]
  }
];

export const COACH_VERDICT_FEW_SHOT_JSON = COACH_VERDICT_FEW_SHOT.map((example) =>
  JSON.stringify(example, null, 2)
).join("\n---\n");
