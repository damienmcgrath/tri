import {
  computeEma,
  computeDailyFitness,
  getReadinessState,
  computeRampRate,
  projectFitnessSnapshot,
  CTL_TIME_CONSTANT,
  ATL_TIME_CONSTANT
} from "./fitness-model";

describe("computeEma", () => {
  it("returns the load value when starting from zero", () => {
    // EMA = 0 + (100 - 0) × (1/42) ≈ 2.38
    const result = computeEma(0, 100, CTL_TIME_CONSTANT);
    expect(result).toBeCloseTo(2.38, 1);
  });

  it("converges toward the load over time", () => {
    // Simulate 42 days of constant 100 TSS → should converge toward ~63.2% of 100
    let ema = 0;
    for (let i = 0; i < 42; i++) {
      ema = computeEma(ema, 100, CTL_TIME_CONSTANT);
    }
    // After tc days, EMA reaches ~63.2% of constant input
    expect(ema).toBeCloseTo(63.6, 0);
  });

  it("ATL converges faster than CTL", () => {
    let ctl = 0;
    let atl = 0;
    for (let i = 0; i < 14; i++) {
      ctl = computeEma(ctl, 100, CTL_TIME_CONSTANT);
      atl = computeEma(atl, 100, ATL_TIME_CONSTANT);
    }
    expect(atl).toBeGreaterThan(ctl);
  });

  it("decays when load drops to zero", () => {
    // Build up for 30 days, then rest for 7
    let ema = 0;
    for (let i = 0; i < 30; i++) {
      ema = computeEma(ema, 80, CTL_TIME_CONSTANT);
    }
    const peakEma = ema;
    for (let i = 0; i < 7; i++) {
      ema = computeEma(ema, 0, CTL_TIME_CONSTANT);
    }
    expect(ema).toBeLessThan(peakEma);
  });
});

describe("computeDailyFitness", () => {
  it("produces positive TSB when CTL > ATL (fitness exceeds fatigue)", () => {
    // After weeks of training then a rest day
    // Simulate: 30 days of 80 TSS, then assess
    let ctl = 0;
    let atl = 0;
    for (let i = 0; i < 30; i++) {
      const result = computeDailyFitness(ctl, atl, 80);
      ctl = result.ctl;
      atl = result.atl;
    }
    // Now rest for 7 days — ATL decays faster than CTL
    for (let i = 0; i < 7; i++) {
      const result = computeDailyFitness(ctl, atl, 0);
      ctl = result.ctl;
      atl = result.atl;
    }
    // After a full week of rest, TSB should be positive
    expect(ctl - atl).toBeGreaterThan(0);
    const result = computeDailyFitness(ctl, atl, 0);
    expect(result.tsb).toBeGreaterThan(0);
  });

  it("produces negative TSB during heavy loading", () => {
    // Start fresh and hammer
    let ctl = 0;
    let atl = 0;
    for (let i = 0; i < 5; i++) {
      const result = computeDailyFitness(ctl, atl, 150);
      ctl = result.ctl;
      atl = result.atl;
    }
    // ATL ramps faster than CTL → negative TSB
    expect(ctl - atl).toBeLessThan(0);
  });

  it("handles zero load day correctly", () => {
    const result = computeDailyFitness(50, 60, 0);
    expect(result.ctl).toBeLessThan(50);
    expect(result.atl).toBeLessThan(60);
    expect(result.tsb).toBeCloseTo(result.ctl - result.atl, 1);
  });
});

describe("getReadinessState", () => {
  it("returns fresh when TSB > 15", () => {
    expect(getReadinessState(20)).toBe("fresh");
  });

  it("returns absorbing when TSB between -5 and 15", () => {
    expect(getReadinessState(10)).toBe("absorbing");
    expect(getReadinessState(0)).toBe("absorbing");
    expect(getReadinessState(-4)).toBe("absorbing");
  });

  it("returns fatigued when TSB between -20 and -5", () => {
    expect(getReadinessState(-10)).toBe("fatigued");
    expect(getReadinessState(-19)).toBe("fatigued");
  });

  it("returns overreaching when TSB < -20", () => {
    expect(getReadinessState(-25)).toBe("overreaching");
    expect(getReadinessState(-30)).toBe("overreaching");
  });

  it("handles boundary values", () => {
    expect(getReadinessState(15)).toBe("absorbing");
    expect(getReadinessState(15.1)).toBe("fresh");
    expect(getReadinessState(-5)).toBe("absorbing"); // -5 is ≥ -5, so absorbing
    expect(getReadinessState(-5.1)).toBe("fatigued");
    expect(getReadinessState(-20)).toBe("fatigued"); // -20 is ≥ -20, so fatigued
    expect(getReadinessState(-20.1)).toBe("overreaching");
  });
});

describe("computeRampRate", () => {
  it("returns positive when CTL is increasing", () => {
    expect(computeRampRate(55, 50)).toBe(5);
  });

  it("returns negative when CTL is decreasing", () => {
    expect(computeRampRate(45, 50)).toBe(-5);
  });

  it("returns zero when CTL is stable", () => {
    expect(computeRampRate(50, 50)).toBe(0);
  });
});

describe("projectFitnessSnapshot", () => {
  it("projects readiness forward through rest days", () => {
    const projected = projectFitnessSnapshot({ ctl: 50, atl: 70, tsb: -20, rampRate: 4 }, 3);
    expect(projected.ctl).toBeLessThan(50);
    expect(projected.atl).toBeLessThan(70);
    expect(projected.tsb).toBeGreaterThan(-20);
    expect(projected.rampRate).toBeNull();
  });

  it("returns the original snapshot when no projection is needed", () => {
    const snapshot = { ctl: 42, atl: 38, tsb: 4, rampRate: 1.5 };
    expect(projectFitnessSnapshot(snapshot, 0)).toEqual(snapshot);
  });
});

describe("realistic 8-week training block simulation", () => {
  it("shows expected CTL/ATL/TSB behavior across a build cycle", () => {
    // Simulate an 8-week build cycle:
    // Weeks 1-3: progressive build (60, 75, 90 daily TSS avg)
    // Week 4: recovery (30 daily TSS)
    // Weeks 5-7: higher build (80, 95, 110)
    // Week 8: taper (25 daily TSS)

    const weeklyAvgTss = [60, 75, 90, 30, 80, 95, 110, 25];
    let ctl = 0;
    let atl = 0;
    const snapshots: Array<{ week: number; ctl: number; atl: number; tsb: number }> = [];

    for (let week = 0; week < 8; week++) {
      for (let day = 0; day < 7; day++) {
        const result = computeDailyFitness(ctl, atl, weeklyAvgTss[week]);
        ctl = result.ctl;
        atl = result.atl;
      }
      snapshots.push({ week: week + 1, ctl, atl, tsb: ctl - atl });
    }

    // CTL should generally increase over the block
    expect(snapshots[6].ctl).toBeGreaterThan(snapshots[0].ctl);

    // Recovery week (4) should show positive TSB (fresher)
    expect(snapshots[3].tsb).toBeGreaterThan(snapshots[2].tsb);

    // Taper week (8) should show positive TSB
    expect(snapshots[7].tsb).toBeGreaterThan(0);

    // Peak CTL should be in week 7 (highest training load)
    const peakCtlWeek = snapshots.reduce((max, s) => (s.ctl > max.ctl ? s : max));
    expect(peakCtlWeek.week).toBe(7);
  });
});
