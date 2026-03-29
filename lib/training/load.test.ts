import {
  computeTssFromPower,
  computeTssFromHr,
  computeTssFromRunPace,
  computeTssFromSwimPace,
  computeTssFromDuration,
  resolveTss,
  type MetricsInput,
  type AthleteThresholds
} from "./load";

describe("computeTssFromPower", () => {
  it("returns ~100 TSS for 1 hour at FTP", () => {
    // 1hr at FTP: NP=250, IF=1.0, duration=3600, FTP=250
    const tss = computeTssFromPower(250, 1.0, 3600, 250);
    expect(tss).toBe(100);
  });

  it("returns ~50 TSS for 30 min at FTP", () => {
    const tss = computeTssFromPower(250, 1.0, 1800, 250);
    expect(tss).toBe(50);
  });

  it("returns higher TSS for above-threshold effort", () => {
    // NP=275 at FTP=250 → IF=1.1
    const tss = computeTssFromPower(275, 1.1, 3600, 250);
    expect(tss).toBeGreaterThan(100);
    // (3600 × 275 × 1.1) / (250 × 3600) × 100 = 121
    expect(tss).toBeCloseTo(121, 0);
  });

  it("returns lower TSS for sub-threshold effort", () => {
    // NP=200 at FTP=250 → IF=0.8
    const tss = computeTssFromPower(200, 0.8, 3600, 250);
    expect(tss).toBeLessThan(100);
    expect(tss).toBeCloseTo(64, 0);
  });

  it("derives IF when not provided", () => {
    const tss = computeTssFromPower(250, null, 3600, 250);
    expect(tss).toBe(100);
  });

  it("returns null when FTP is missing", () => {
    expect(computeTssFromPower(250, 1.0, 3600, null)).toBeNull();
  });

  it("returns null when NP is missing", () => {
    expect(computeTssFromPower(null, 1.0, 3600, 250)).toBeNull();
  });

  it("returns null when duration is missing", () => {
    expect(computeTssFromPower(250, 1.0, null, 250)).toBeNull();
  });

  it("clamps extreme values below 999", () => {
    // Very long at very high NP
    const tss = computeTssFromPower(500, 2.0, 36000, 250);
    expect(tss).toBeLessThanOrEqual(999);
  });
});

describe("computeTssFromHr", () => {
  it("returns ~100 TSS for 1 hour at threshold HR", () => {
    // At threshold: avgHr≈170, maxHr=190, resting=50
    // hrRatio = (170-50)/(190-50) = 120/140 ≈ 0.857
    // TSS = 1 × 0.857² × 100 ≈ 73.4
    const tss = computeTssFromHr(170, 190, 50, 3600);
    expect(tss).toBeGreaterThan(50);
    expect(tss).toBeLessThan(120);
  });

  it("returns low TSS for easy effort", () => {
    // Easy: avgHr=120, maxHr=190, resting=50
    const tss = computeTssFromHr(120, 190, 50, 3600);
    expect(tss).toBeLessThan(50);
  });

  it("scales with duration", () => {
    const tss1h = computeTssFromHr(150, 190, 50, 3600)!;
    const tss2h = computeTssFromHr(150, 190, 50, 7200)!;
    expect(tss2h).toBeCloseTo(tss1h * 2, 0);
  });

  it("returns null when avgHr is missing", () => {
    expect(computeTssFromHr(null, 190, 50, 3600)).toBeNull();
  });

  it("returns null when maxHr is missing", () => {
    expect(computeTssFromHr(150, null, 50, 3600)).toBeNull();
  });

  it("uses default resting HR when not provided", () => {
    const tss = computeTssFromHr(150, 190, null, 3600);
    expect(tss).toBeGreaterThan(0);
  });
});

describe("computeTssFromRunPace", () => {
  it("returns ~100 TSS for 1 hour at threshold pace", () => {
    // Running at threshold: avgPace=300s/km, threshold=300s/km
    const tss = computeTssFromRunPace(300, 300, 3600);
    expect(tss).toBe(100);
  });

  it("returns lower TSS for slower-than-threshold pace", () => {
    // Easy pace: 360s/km, threshold=300s/km → IF=0.833
    const tss = computeTssFromRunPace(360, 300, 3600);
    expect(tss).toBeLessThan(100);
  });

  it("returns higher TSS for faster-than-threshold pace", () => {
    const tss = computeTssFromRunPace(270, 300, 3600);
    expect(tss).toBeGreaterThan(100);
  });

  it("returns null when pace is missing", () => {
    expect(computeTssFromRunPace(null, 300, 3600)).toBeNull();
  });
});

describe("computeTssFromSwimPace", () => {
  it("returns ~100 TSS for 1 hour at CSS", () => {
    const tss = computeTssFromSwimPace(100, 100, 3600);
    expect(tss).toBe(100);
  });

  it("returns lower TSS for slower pace", () => {
    const tss = computeTssFromSwimPace(120, 100, 3600);
    expect(tss).toBeLessThan(100);
  });
});

describe("computeTssFromDuration", () => {
  it("returns moderate TSS for generic 1-hour session", () => {
    const tss = computeTssFromDuration(3600, "run");
    expect(tss).toBeGreaterThan(40);
    expect(tss).toBeLessThan(80);
  });

  it("returns lower TSS for recovery sessions", () => {
    const recovery = computeTssFromDuration(3600, "run", "recovery_run")!;
    const generic = computeTssFromDuration(3600, "run")!;
    expect(recovery).toBeLessThan(generic);
  });

  it("returns higher TSS for threshold sessions", () => {
    const threshold = computeTssFromDuration(3600, "run", "threshold_intervals")!;
    const generic = computeTssFromDuration(3600, "run")!;
    expect(threshold).toBeGreaterThan(generic);
  });

  it("returns lower TSS for strength", () => {
    const strength = computeTssFromDuration(3600, "strength")!;
    const run = computeTssFromDuration(3600, "run")!;
    expect(strength).toBeLessThan(run);
  });

  it("returns null for zero duration", () => {
    expect(computeTssFromDuration(0, "run")).toBeNull();
  });

  it("returns null for null duration", () => {
    expect(computeTssFromDuration(null, "run")).toBeNull();
  });
});

describe("resolveTss", () => {
  const baseThresholds: AthleteThresholds = {
    ftp: 250,
    maxHr: 190,
    restingHr: 50,
    thresholdRunPace: 300,
    thresholdSwimPace: 100
  };

  it("prefers device TSS when available", () => {
    const metrics: MetricsInput = {
      metricsV2: { load: { trainingStressScore: 85 }, power: { intensityFactor: 0.92 } },
      sport: "bike",
      durationSec: 3600,
      avgHr: 150,
      maxHr: 175,
      avgPower: 220
    };
    const result = resolveTss(metrics, baseThresholds);
    expect(result.source).toBe("device");
    expect(result.tss).toBe(85);
  });

  it("falls back to power-based TSS when no device TSS", () => {
    const metrics: MetricsInput = {
      metricsV2: { power: { normalizedPower: 250 } },
      sport: "bike",
      durationSec: 3600,
      avgHr: 150,
      maxHr: 175,
      avgPower: 230
    };
    const result = resolveTss(metrics, baseThresholds);
    expect(result.source).toBe("power");
    expect(result.tss).toBe(100); // NP=250, FTP=250 → TSS=100
  });

  it("falls back to HR-based TSS when no power", () => {
    const metrics: MetricsInput = {
      metricsV2: {},
      sport: "run",
      durationSec: 3600,
      avgHr: 155,
      maxHr: 180,
      avgPower: null
    };
    const result = resolveTss(metrics, baseThresholds);
    expect(result.source).toBe("hr");
    expect(result.tss).toBeGreaterThan(0);
  });

  it("falls back to pace-based TSS for running", () => {
    const metrics: MetricsInput = {
      metricsV2: { pace: { avgPaceSecPerKm: 300 } },
      sport: "run",
      durationSec: 3600,
      avgHr: null,
      maxHr: null,
      avgPower: null
    };
    const thresholds: AthleteThresholds = {
      ...baseThresholds,
      maxHr: null,
      restingHr: null
    };
    const result = resolveTss(metrics, thresholds);
    expect(result.source).toBe("pace");
    expect(result.tss).toBe(100);
  });

  it("falls back to duration estimate as last resort", () => {
    const metrics: MetricsInput = {
      metricsV2: {},
      sport: "run",
      durationSec: 3600,
      avgHr: null,
      maxHr: null,
      avgPower: null
    };
    const thresholds: AthleteThresholds = {
      ftp: null,
      maxHr: null,
      restingHr: null,
      thresholdRunPace: null,
      thresholdSwimPace: null
    };
    const result = resolveTss(metrics, thresholds);
    expect(result.source).toBe("duration_estimate");
    expect(result.tss).toBeGreaterThan(0);
  });
});
