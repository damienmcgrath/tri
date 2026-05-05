import type { IntendedBlock } from "@/lib/intent/types";
import { detectBlocks } from "./detector";
import type { BlockDetectorTimeseries, TimeseriesSample } from "./types";

// ─── fixture helpers ────────────────────────────────────────────────────────

type Segment = {
  /** Inclusive start second. */
  from: number;
  /** Exclusive end second. */
  to: number;
  power?: number;
  hr?: number;
  cadence?: number;
  paceSecPerKm?: number;
};

function buildSamples(duration: number, segments: Segment[]): TimeseriesSample[] {
  const samples: TimeseriesSample[] = [];
  for (let t = 0; t < duration; t++) {
    const seg = segments.find((s) => t >= s.from && t < s.to);
    const sample: TimeseriesSample = { t_sec: t, distance_m: t * 5 };
    if (seg?.power !== undefined) sample.power = seg.power;
    if (seg?.hr !== undefined) sample.hr = seg.hr;
    if (seg?.cadence !== undefined) sample.cadence = seg.cadence;
    if (seg?.paceSecPerKm !== undefined) sample.pace_sec_per_km = seg.paceSecPerKm;
    samples.push(sample);
  }
  return samples;
}

function makeTimeseries(
  duration: number,
  samples: TimeseriesSample[],
  laps?: { start_sec: number; end_sec: number }[],
): BlockDetectorTimeseries {
  const result: BlockDetectorTimeseries = {
    sport: "cycling",
    duration_sec: duration,
    samples,
  };
  if (laps) result.laps = laps;
  return result;
}

const block = (overrides: Partial<IntendedBlock> & Pick<IntendedBlock, "index" | "duration_min" | "type">): IntendedBlock => ({
  ...overrides,
});

// ─── unit tests ─────────────────────────────────────────────────────────────

describe("detectBlocks", () => {
  describe("happy path — clean 3-block intervals", () => {
    const intended: IntendedBlock[] = [
      block({ index: 0, duration_min: 10, type: "warmup", target_watts: [120, 160] }),
      block({ index: 1, duration_min: 20, type: "work", target_watts: [240, 260] }),
      block({ index: 2, duration_min: 10, type: "cooldown", target_watts: [120, 160] }),
    ];
    const samples = buildSamples(2400, [
      { from: 0, to: 600, power: 145, hr: 130, cadence: 85 },
      { from: 600, to: 1800, power: 250, hr: 165, cadence: 92 },
      { from: 1800, to: 2400, power: 145, hr: 140, cadence: 85 },
    ]);
    const ts = makeTimeseries(2400, samples);

    it("returns one detected block per intended block", () => {
      const blocks = detectBlocks(intended, ts);
      expect(blocks).toHaveLength(3);
    });

    it("places boundaries close to the planned transitions (within ±10s)", () => {
      const blocks = detectBlocks(intended, ts);
      expect(Math.abs(blocks[0].end_sec - 600)).toBeLessThanOrEqual(10);
      expect(Math.abs(blocks[1].end_sec - 1800)).toBeLessThanOrEqual(10);
      expect(blocks[0].start_sec).toBe(0);
      expect(blocks[2].end_sec).toBe(2400);
    });

    it("computes per-block metrics (np ≈ ap for steady segments)", () => {
      const blocks = detectBlocks(intended, ts);
      expect(blocks[0].metrics.ap).toBeGreaterThanOrEqual(140);
      expect(blocks[0].metrics.ap).toBeLessThanOrEqual(160);
      expect(blocks[1].metrics.np).toBeGreaterThanOrEqual(240);
      expect(blocks[1].metrics.np).toBeLessThanOrEqual(260);
      expect(blocks[1].metrics.hr_avg).toBeGreaterThan(150);
      expect(blocks[1].metrics.hr_max).toBeGreaterThanOrEqual(blocks[1].metrics.hr_avg!);
    });

    it("yields high alignment_confidence when the athlete hit targets", () => {
      const blocks = detectBlocks(intended, ts);
      for (const b of blocks) {
        expect(b.alignment_confidence).toBeGreaterThanOrEqual(0.85);
      }
    });
  });

  describe("athlete deviates significantly", () => {
    const intended: IntendedBlock[] = [
      block({ index: 0, duration_min: 5, type: "warmup", target_watts: [120, 160] }),
      block({ index: 1, duration_min: 10, type: "work", target_watts: [260, 280] }),
      block({ index: 2, duration_min: 5, type: "cooldown", target_watts: [100, 140] }),
    ];
    // Athlete only hits 200W in the work block (well under 260–280 target).
    const samples = buildSamples(1200, [
      { from: 0, to: 300, power: 145, hr: 130 },
      { from: 300, to: 900, power: 200, hr: 155 },
      { from: 900, to: 1200, power: 145, hr: 140 },
    ]);

    it("returns low confidence for the off-target work block", () => {
      const blocks = detectBlocks(intended, makeTimeseries(1200, samples));
      expect(blocks[1].alignment_confidence).toBeLessThan(0.7);
      expect(blocks[1].alignment_notes?.some((n) => /under target/.test(n))).toBe(true);
    });
  });

  describe("missing power → uses HR for boundary detection", () => {
    const intended: IntendedBlock[] = [
      block({ index: 0, duration_min: 10, type: "warmup", target_hr: [120, 140] }),
      block({ index: 1, duration_min: 10, type: "work", target_hr: [160, 175] }),
      block({ index: 2, duration_min: 10, type: "cooldown", target_hr: [120, 140] }),
    ];
    const samples = buildSamples(1800, [
      { from: 0, to: 600, hr: 130 },
      { from: 600, to: 1200, hr: 168 },
      { from: 1200, to: 1800, hr: 130 },
    ]);

    it("detects boundaries from HR signal when no power data is present", () => {
      const blocks = detectBlocks(intended, makeTimeseries(1800, samples));
      expect(blocks).toHaveLength(3);
      expect(blocks[1].metrics.np).toBeUndefined();
      expect(blocks[1].metrics.hr_avg).toBeGreaterThanOrEqual(160);
      // HR rolling average ramps slowly — boundaries within ±60s of plan.
      expect(Math.abs(blocks[0].end_sec - 600)).toBeLessThanOrEqual(60);
      expect(Math.abs(blocks[1].end_sec - 1200)).toBeLessThanOrEqual(60);
    });

    it("annotates blocks as inferred-from-HR", () => {
      const blocks = detectBlocks(intended, makeTimeseries(1800, samples));
      expect(blocks[1].alignment_notes?.some((n) => /HR/i.test(n))).toBe(true);
    });
  });

  describe("GPS auto-lap snapping", () => {
    const intended: IntendedBlock[] = [
      block({ index: 0, duration_min: 10, type: "warmup", target_watts: [120, 160] }),
      block({ index: 1, duration_min: 10, type: "work", target_watts: [240, 260] }),
      block({ index: 2, duration_min: 10, type: "cooldown", target_watts: [120, 160] }),
    ];
    // Power transitions at 595 and 1205 — close enough to laps at 600 and 1200
    // for the snap to take effect (|Δ| ≤ 30s).
    const samples = buildSamples(1800, [
      { from: 0, to: 595, power: 145 },
      { from: 595, to: 1205, power: 250 },
      { from: 1205, to: 1800, power: 145 },
    ]);
    const laps = [
      { start_sec: 0, end_sec: 600 },
      { start_sec: 600, end_sec: 1200 },
      { start_sec: 1200, end_sec: 1800 },
    ];

    it("snaps boundaries to GPS auto-laps when within ±30s", () => {
      const blocks = detectBlocks(intended, makeTimeseries(1800, samples, laps));
      expect(blocks[0].end_sec).toBe(600);
      expect(blocks[1].end_sec).toBe(1200);
      expect(
        blocks[1].alignment_notes?.some((n) => /snapped to GPS/i.test(n)),
      ).toBe(true);
    });

    it("does not snap when the lap boundary is more than 30s away", () => {
      // Lap at 700 is more than 30s from the natural boundary at 600.
      const farLaps = [{ start_sec: 0, end_sec: 700 }];
      const blocks = detectBlocks(
        intended,
        makeTimeseries(1800, samples, farLaps),
      );
      expect(blocks[0].end_sec).toBeLessThan(700);
    });
  });

  describe("single block", () => {
    it("returns one block spanning the whole session", () => {
      const intended: IntendedBlock[] = [
        block({ index: 0, duration_min: 60, type: "easy", target_watts: [140, 170] }),
      ];
      const samples = buildSamples(3600, [{ from: 0, to: 3600, power: 155, hr: 138 }]);
      const blocks = detectBlocks(intended, makeTimeseries(3600, samples));
      expect(blocks).toHaveLength(1);
      expect(blocks[0].start_sec).toBe(0);
      expect(blocks[0].end_sec).toBe(3600);
      expect(blocks[0].alignment_confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe("no intended blocks", () => {
    it("returns an empty array", () => {
      const samples = buildSamples(600, [{ from: 0, to: 600, power: 150 }]);
      expect(detectBlocks([], makeTimeseries(600, samples))).toEqual([]);
    });
  });

  describe("boundary clamped to session edges", () => {
    it("does not search past the start of the session", () => {
      const intended: IntendedBlock[] = [
        block({ index: 0, duration_min: 1, type: "warmup", target_watts: [120, 160] }),
        block({ index: 1, duration_min: 9, type: "work", target_watts: [240, 260] }),
      ];
      const samples = buildSamples(600, [
        { from: 0, to: 60, power: 145 },
        { from: 60, to: 600, power: 250 },
      ]);
      const blocks = detectBlocks(intended, makeTimeseries(600, samples));
      expect(blocks[0].start_sec).toBe(0);
      expect(blocks[0].end_sec).toBeGreaterThan(0);
      expect(blocks[1].end_sec).toBe(600);
    });

    it("does not search past the end of the session", () => {
      const intended: IntendedBlock[] = [
        block({ index: 0, duration_min: 9, type: "work", target_watts: [240, 260] }),
        block({ index: 1, duration_min: 1, type: "cooldown", target_watts: [120, 160] }),
      ];
      const samples = buildSamples(600, [
        { from: 0, to: 540, power: 250 },
        { from: 540, to: 600, power: 145 },
      ]);
      const blocks = detectBlocks(intended, makeTimeseries(600, samples));
      expect(blocks[1].end_sec).toBe(600);
      expect(blocks[1].start_sec).toBeLessThan(600);
    });
  });

  describe("very short blocks (<2 min)", () => {
    it("preserves boundary order even when the search window collapses", () => {
      const intended: IntendedBlock[] = [
        block({ index: 0, duration_min: 5, type: "warmup", target_watts: [120, 160] }),
        block({ index: 1, duration_min: 1, type: "work", target_watts: [280, 320] }),
        block({ index: 2, duration_min: 1, type: "easy", target_watts: [100, 140] }),
        block({ index: 3, duration_min: 5, type: "cooldown", target_watts: [120, 160] }),
      ];
      const samples = buildSamples(720, [
        { from: 0, to: 300, power: 145 },
        { from: 300, to: 360, power: 300 },
        { from: 360, to: 420, power: 120 },
        { from: 420, to: 720, power: 145 },
      ]);
      const blocks = detectBlocks(intended, makeTimeseries(720, samples));
      expect(blocks).toHaveLength(4);
      // Strictly monotonic boundaries.
      for (let i = 1; i < blocks.length; i++) {
        expect(blocks[i].start_sec).toBeGreaterThanOrEqual(blocks[i - 1].end_sec - 1);
        expect(blocks[i].end_sec).toBeGreaterThan(blocks[i].start_sec);
      }
    });
  });

  describe("graceful degradation", () => {
    it("returns an empty array when timeseries duration is zero", () => {
      const intended: IntendedBlock[] = [
        block({ index: 0, duration_min: 10, type: "warmup" }),
      ];
      expect(
        detectBlocks(intended, makeTimeseries(0, [])),
      ).toEqual([]);
    });

    it("falls back to plan boundaries when neither power nor HR is present", () => {
      const intended: IntendedBlock[] = [
        block({ index: 0, duration_min: 10, type: "warmup" }),
        block({ index: 1, duration_min: 10, type: "easy" }),
      ];
      const samples = buildSamples(1200, [{ from: 0, to: 1200, cadence: 85 }]);
      const blocks = detectBlocks(intended, makeTimeseries(1200, samples));
      expect(blocks[0].end_sec).toBe(600);
      expect(blocks[0].alignment_confidence).toBeLessThanOrEqual(0.85);
    });

    it("clamps cumulative target boundaries that overrun the activity duration", () => {
      // Intended totals 30 min but activity is only 15 min long.
      const intended: IntendedBlock[] = [
        block({ index: 0, duration_min: 10, type: "warmup", target_watts: [120, 160] }),
        block({ index: 1, duration_min: 10, type: "work", target_watts: [240, 260] }),
        block({ index: 2, duration_min: 10, type: "cooldown", target_watts: [120, 160] }),
      ];
      const samples = buildSamples(900, [
        { from: 0, to: 600, power: 145 },
        { from: 600, to: 900, power: 250 },
      ]);
      const blocks = detectBlocks(intended, makeTimeseries(900, samples));
      expect(blocks).toHaveLength(3);
      // All boundaries are clamped to ≤ 900s and in monotonic order.
      for (let i = 1; i < blocks.length; i++) {
        expect(blocks[i].start_sec).toBeGreaterThan(blocks[i - 1].start_sec);
        expect(blocks[i].end_sec).toBeLessThanOrEqual(900);
      }
    });
  });

  describe("respects intended block ordering by index", () => {
    it("returns detected blocks in index order even when the input is shuffled", () => {
      const intended: IntendedBlock[] = [
        block({ index: 2, duration_min: 10, type: "cooldown", target_watts: [120, 160] }),
        block({ index: 0, duration_min: 10, type: "warmup", target_watts: [120, 160] }),
        block({ index: 1, duration_min: 10, type: "work", target_watts: [240, 260] }),
      ];
      const samples = buildSamples(1800, [
        { from: 0, to: 600, power: 145 },
        { from: 600, to: 1200, power: 250 },
        { from: 1200, to: 1800, power: 145 },
      ]);
      const blocks = detectBlocks(intended, makeTimeseries(1800, samples));
      expect(blocks.map((b) => b.intended.index)).toEqual([0, 1, 2]);
    });
  });
});

// ─── 5 hand-crafted fixtures with known structure ──────────────────────────
// Spec acceptance: ≥4 of 5 should hit alignment_confidence ≥ 0.7.

describe("hand-crafted fixtures (≥4/5 confidence ≥ 0.7)", () => {
  type Fixture = {
    name: string;
    intended: IntendedBlock[];
    timeseries: BlockDetectorTimeseries;
    expectsHighConfidence: boolean;
  };

  const fixtures: Fixture[] = [
    {
      name: "F1 — clean 3-block sweet-spot session",
      intended: [
        block({ index: 0, duration_min: 10, type: "warmup", target_watts: [130, 160] }),
        block({ index: 1, duration_min: 30, type: "work", target_watts: [220, 250] }),
        block({ index: 2, duration_min: 10, type: "cooldown", target_watts: [120, 150] }),
      ],
      timeseries: makeTimeseries(
        3000,
        buildSamples(3000, [
          { from: 0, to: 600, power: 145, hr: 128 },
          { from: 600, to: 2400, power: 235, hr: 162 },
          { from: 2400, to: 3000, power: 140, hr: 138 },
        ]),
      ),
      expectsHighConfidence: true,
    },
    {
      name: "F2 — 4×3-min VO2 with auto-laps",
      intended: [
        block({ index: 0, duration_min: 10, type: "warmup", target_watts: [120, 150] }),
        block({ index: 1, duration_min: 3, type: "work", target_watts: [310, 340] }),
        block({ index: 2, duration_min: 3, type: "easy", target_watts: [120, 150] }),
        block({ index: 3, duration_min: 3, type: "work", target_watts: [310, 340] }),
        block({ index: 4, duration_min: 3, type: "easy", target_watts: [120, 150] }),
        block({ index: 5, duration_min: 10, type: "cooldown", target_watts: [120, 150] }),
      ],
      timeseries: makeTimeseries(
        1920,
        buildSamples(1920, [
          { from: 0, to: 600, power: 140 },
          { from: 600, to: 780, power: 325 },
          { from: 780, to: 960, power: 140 },
          { from: 960, to: 1140, power: 325 },
          { from: 1140, to: 1320, power: 140 },
          { from: 1320, to: 1920, power: 140 },
        ]),
        [
          { start_sec: 0, end_sec: 600 },
          { start_sec: 600, end_sec: 780 },
          { start_sec: 780, end_sec: 960 },
          { start_sec: 960, end_sec: 1140 },
          { start_sec: 1140, end_sec: 1320 },
          { start_sec: 1320, end_sec: 1920 },
        ],
      ),
      expectsHighConfidence: true,
    },
    {
      name: "F3 — steady 60-min endurance ride",
      intended: [
        block({ index: 0, duration_min: 60, type: "easy", target_watts: [150, 180] }),
      ],
      timeseries: makeTimeseries(
        3600,
        buildSamples(3600, [{ from: 0, to: 3600, power: 165, hr: 138 }]),
      ),
      expectsHighConfidence: true,
    },
    {
      name: "F4 — over-under threshold session",
      intended: [
        block({ index: 0, duration_min: 10, type: "warmup", target_watts: [120, 150] }),
        block({ index: 1, duration_min: 5, type: "work", target_watts: [260, 290] }),
        block({ index: 2, duration_min: 5, type: "easy", target_watts: [200, 230] }),
        block({ index: 3, duration_min: 5, type: "work", target_watts: [260, 290] }),
        block({ index: 4, duration_min: 10, type: "cooldown", target_watts: [120, 150] }),
      ],
      timeseries: makeTimeseries(
        2100,
        buildSamples(2100, [
          { from: 0, to: 600, power: 140 },
          { from: 600, to: 900, power: 275 },
          { from: 900, to: 1200, power: 215 },
          { from: 1200, to: 1500, power: 275 },
          { from: 1500, to: 2100, power: 140 },
        ]),
      ),
      expectsHighConfidence: true,
    },
    {
      name: "F5 — athlete bonked mid-work-block (intentionally low confidence)",
      intended: [
        block({ index: 0, duration_min: 10, type: "warmup", target_watts: [130, 160] }),
        block({ index: 1, duration_min: 20, type: "work", target_watts: [270, 300] }),
        block({ index: 2, duration_min: 10, type: "cooldown", target_watts: [120, 150] }),
      ],
      timeseries: makeTimeseries(
        2400,
        // Athlete drifted significantly — only managed ~210W in the work block.
        buildSamples(2400, [
          { from: 0, to: 600, power: 145 },
          { from: 600, to: 1800, power: 210 },
          { from: 1800, to: 2400, power: 140 },
        ]),
      ),
      expectsHighConfidence: false,
    },
  ];

  it.each(fixtures)("$name", (fixture) => {
    const blocks = detectBlocks(fixture.intended, fixture.timeseries);
    expect(blocks.length).toBe(fixture.intended.length);

    if (fixture.expectsHighConfidence) {
      const minConfidence = Math.min(...blocks.map((b) => b.alignment_confidence));
      expect(minConfidence).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("≥4 of 5 fixtures hit alignment_confidence ≥ 0.7 across every block", () => {
    const passing = fixtures.filter((fixture) => {
      const blocks = detectBlocks(fixture.intended, fixture.timeseries);
      return blocks.every((b) => b.alignment_confidence >= 0.7);
    }).length;
    expect(passing).toBeGreaterThanOrEqual(4);
  });
});
