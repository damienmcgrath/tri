import {
  progressReportFactsSchema,
  progressReportNarrativeSchema,
  type ProgressReportFacts,
  type ProgressReportNarrative
} from "./types";
import { buildDeterministicNarrative } from "./deterministic";

const validFacts: ProgressReportFacts = {
  blockStart: "2026-03-23",
  blockEnd: "2026-04-19",
  priorBlockStart: "2026-02-23",
  priorBlockEnd: "2026-03-22",
  blockLabel: "Block ending Apr 19",
  blockRange: "Mar 23 – Apr 19",
  priorBlockRange: "Feb 23 – Mar 22",
  volume: {
    current: {
      totalMinutes: 760,
      totalSessions: 14,
      keySessionsCompleted: 4,
      keySessionsPlanned: 5,
      completionPct: 80,
      perSport: { run: 320, bike: 280, swim: 120, strength: 40, other: 0 }
    },
    prior: {
      totalMinutes: 690,
      totalSessions: 13,
      keySessionsCompleted: 3,
      keySessionsPlanned: 5,
      completionPct: 72,
      perSport: { run: 290, bike: 250, swim: 110, strength: 40, other: 0 }
    },
    deltaMinutes: 70,
    deltaSessions: 1
  },
  fitnessTrajectory: [
    {
      sport: "total",
      currentCtlStart: 58.2,
      currentCtlEnd: 62.1,
      currentCtlDelta: 3.9,
      priorCtlEnd: 57.8,
      deltaVsPrior: 4.3,
      rampRate: 3.5,
      direction: "improving"
    },
    {
      sport: "run",
      currentCtlStart: 26.1,
      currentCtlEnd: 28.4,
      currentCtlDelta: 2.3,
      priorCtlEnd: 25.2,
      deltaVsPrior: 3.2,
      rampRate: 2.1,
      direction: "improving"
    }
  ],
  paceAtHrByDiscipline: [
    {
      sport: "run",
      current: {
        avgHr: 148,
        avgPaceSecPerKm: 305,
        avgPacePer100mSec: null,
        avgPower: null,
        sessionCount: 6
      },
      prior: {
        avgHr: 149,
        avgPaceSecPerKm: 312,
        avgPacePer100mSec: null,
        avgPower: null,
        sessionCount: 5
      },
      direction: "improving",
      summary: "Run pace-at-HR: 5:05/km @ 148bpm (prev 5:12/km @ 149bpm) — improving."
    }
  ],
  durability: {
    current: {
      enduranceSessions: 4,
      decouplingSamples: 3,
      avgDecouplingPct: 3.2,
      poorDurabilityCount: 0
    },
    prior: {
      enduranceSessions: 3,
      decouplingSamples: 3,
      avgDecouplingPct: 5.1,
      poorDurabilityCount: 1
    },
    direction: "improving",
    summary:
      "Decoupling avg 3.2% vs prior 5.1% (3 vs 3 samples) — improving."
  },
  peakPerformances: [
    {
      sport: "run",
      label: "Best run pace",
      current: {
        value: 280,
        formatted: "4:40/km",
        activityId: "act-1",
        activityDate: "2026-04-12"
      },
      prior: { value: 292, formatted: "4:52/km" },
      delta: 12,
      deltaLabel: "12s/km faster vs prior block"
    }
  ],
  factualBullets: [
    "Volume: +70 min and +1 sessions vs prior block.",
    "Total CTL: 58.2 → 62.1 (+3.9) across the block.",
    "Run pace-at-HR: 5:05/km @ 148bpm (prev 5:12/km @ 149bpm) — improving."
  ],
  confidenceNote: null,
  narrativeSource: "legacy_unknown"
};

describe("progressReportFactsSchema", () => {
  test("accepts a well-formed facts payload", () => {
    const parsed = progressReportFactsSchema.safeParse(validFacts);
    expect(parsed.success).toBe(true);
  });

  test("rejects block_start later than block_end dates missing", () => {
    const parsed = progressReportFactsSchema.safeParse({
      ...validFacts,
      blockStart: "not-a-date"
    });
    expect(parsed.success).toBe(false);
  });

  test("requires at least two factual bullets", () => {
    const parsed = progressReportFactsSchema.safeParse({
      ...validFacts,
      factualBullets: ["only one"]
    });
    expect(parsed.success).toBe(false);
  });
});

describe("progressReportNarrativeSchema", () => {
  const validNarrative: ProgressReportNarrative = {
    coachHeadline: "Run economy stepped up while bike held flat",
    executiveSummary:
      "You added 70 minutes and one session while total CTL rose 3.9 points. Run pace-at-HR improved from 5:12 to 5:05/km at the same cost; bike power-at-HR held. Peak run pace this block was 12s/km faster than the prior block.",
    fitnessReport:
      "Total CTL moved 58.2 → 62.1 (Δ +3.9). Run CTL climbed from 26.1 to 28.4 (Δ +2.3), with ramp rate 2.1 — inside the sustainable window.",
    durabilityReport:
      "Aerobic decoupling averaged 3.2% across three ≥45-min endurance sessions, down from 5.1% last block. Durability is holding better at the same duration.",
    peakPerformancesReport:
      "Best run pace of 4:40/km came from the Apr 12 session — 12s/km faster than the prior block's peak.",
    disciplineVerdicts: [
      {
        sport: "run",
        verdict:
          "Run economy is the clearest adaptation: 5:05/km at 148 bpm vs 5:12 at 149 bpm last block. Peak pace also improved 12s/km. Keep the current easy-pace discipline."
      }
    ],
    nonObviousInsight:
      "Run CTL rose more than bike CTL, yet ramp rate stayed inside 3 points — adaptation is concentrating on running without spending fatigue capital on the bike.",
    teach:
      "Pace-at-HR is a direct read on aerobic efficiency: when pace improves at the same HR, your cardiovascular cost per unit of output has fallen.",
    carryForward: [
      "Hold the current easy-pace discipline on run — it is producing 7–12s/km improvement at the same HR without volume changes.",
      "Add one ≥60-min bike endurance ride per week next block to give the bike aerobic system the same stimulus run is already getting."
    ]
  };

  test("accepts a well-formed narrative", () => {
    const parsed = progressReportNarrativeSchema.safeParse(validNarrative);
    expect(parsed.success).toBe(true);
  });

  test("rejects teach longer than 220 chars", () => {
    const parsed = progressReportNarrativeSchema.safeParse({
      ...validNarrative,
      teach: "x".repeat(221)
    });
    expect(parsed.success).toBe(false);
  });

  test("requires exactly two carryForward items", () => {
    const parsed = progressReportNarrativeSchema.safeParse({
      ...validNarrative,
      carryForward: [validNarrative.carryForward[0]]
    });
    expect(parsed.success).toBe(false);
  });
});

describe("buildDeterministicNarrative", () => {
  test("produces a narrative that validates against the schema", () => {
    const narrative = buildDeterministicNarrative(validFacts);
    const parsed = progressReportNarrativeSchema.safeParse(narrative);
    expect(parsed.success).toBe(true);
  });

  test("includes a discipline verdict for every discipline with pace-at-HR data", () => {
    const narrative = buildDeterministicNarrative(validFacts);
    const runVerdict = narrative.disciplineVerdicts.find((v) => v.sport === "run");
    expect(runVerdict).toBeDefined();
  });

  test("falls back to an insufficient-signal verdict when no disciplines have data", () => {
    const empty: ProgressReportFacts = {
      ...validFacts,
      paceAtHrByDiscipline: [],
      peakPerformances: []
    };
    const narrative = buildDeterministicNarrative(empty);
    expect(narrative.disciplineVerdicts).toHaveLength(1);
  });
});
