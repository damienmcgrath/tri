import { detectLegAnomalies, type Anomaly } from "./anomaly-detection";
import type { RaceSegmentData } from "@/lib/race-review";

function lap(overrides: Partial<{
  durationSec: number;
  avgHr: number | null;
  avgPower: number | null;
  avgPaceSecPerKm: number | null;
  avgPacePer100mSec: number | null;
  avgCadence: number | null;
}> = {}): Record<string, unknown> {
  // Match the metrics_v2 lap shape that getMetricsV2Laps coerces from.
  let i = 0;
  return {
    index: ++i,
    durationSec: overrides.durationSec ?? 60,
    avgHr: overrides.avgHr ?? null,
    avgPower: overrides.avgPower ?? null,
    avgPaceSecPerKm: overrides.avgPaceSecPerKm ?? null,
    avgPacePer100mSec: overrides.avgPacePer100mSec ?? null,
    avgCadence: overrides.avgCadence ?? null
  };
}

function makeSegment(role: RaceSegmentData["role"], laps: Record<string, unknown>[]): RaceSegmentData {
  // Re-index laps so getMetricsV2Laps can coerce them.
  const reindexed = laps.map((l, idx) => ({ ...l, index: idx }));
  return {
    activityId: "act-1",
    role,
    segmentIndex: 0,
    sportType: role === "swim" ? "swim" : role === "bike" ? "bike" : "run",
    durationSec: reindexed.reduce((sum, l: any) => sum + (l.durationSec ?? 0), 0),
    distanceM: 10000,
    avgHr: 150,
    avgPower: role === "bike" ? 220 : null,
    metricsV2: { laps: reindexed }
  };
}

describe("detectLegAnomalies", () => {
  it("returns no anomalies on a clean run", () => {
    const laps = Array.from({ length: 6 }, () =>
      lap({ avgHr: 150, avgPaceSecPerKm: 300, avgCadence: 178 })
    );
    expect(detectLegAnomalies(makeSegment("run", laps))).toEqual([]);
  });

  it("detects an HR spike", () => {
    const baseHr = 145;
    const laps = [
      lap({ avgHr: baseHr, avgPaceSecPerKm: 300 }),
      lap({ avgHr: baseHr + 1, avgPaceSecPerKm: 300 }),
      lap({ avgHr: baseHr + 2, avgPaceSecPerKm: 300 }),
      lap({ avgHr: 185, avgPaceSecPerKm: 305 }), // big spike
      lap({ avgHr: baseHr + 1, avgPaceSecPerKm: 300 }),
      lap({ avgHr: baseHr, avgPaceSecPerKm: 300 })
    ];
    const out = detectLegAnomalies(makeSegment("run", laps));
    expect(out.find((a) => a.type === "hr_spike")).toBeDefined();
  });

  it("detects a power dropout on bike with surrounding working laps", () => {
    const laps = [
      lap({ avgPower: 220, avgHr: 150 }),
      lap({ avgPower: 230, avgHr: 152 }),
      lap({ avgPower: 15, durationSec: 30, avgHr: 130 }), // dropout
      lap({ avgPower: 225, avgHr: 151 }),
      lap({ avgPower: 220, avgHr: 150 })
    ];
    const out = detectLegAnomalies(makeSegment("bike", laps));
    const dropout = out.find((a) => a.type === "power_dropout");
    expect(dropout).toBeDefined();
    expect(dropout!.observation).toMatch(/coast or mechanical/);
  });

  it("detects a pace break on run", () => {
    const laps = [
      lap({ avgPaceSecPerKm: 300, avgHr: 150 }),
      lap({ avgPaceSecPerKm: 302, avgHr: 151 }),
      lap({ avgPaceSecPerKm: 410, avgHr: 140, durationSec: 60 }), // walk break
      lap({ avgPaceSecPerKm: 305, avgHr: 152 }),
      lap({ avgPaceSecPerKm: 300, avgHr: 150 })
    ];
    const out = detectLegAnomalies(makeSegment("run", laps));
    const paceBreak = out.find((a) => a.type === "pace_break");
    expect(paceBreak).toBeDefined();
    expect(paceBreak!.observation).toMatch(/walk break/);
  });

  it("detects cadence drop in second half on run", () => {
    const laps = [
      lap({ avgPaceSecPerKm: 300, avgCadence: 180 }),
      lap({ avgPaceSecPerKm: 300, avgCadence: 178 }),
      lap({ avgPaceSecPerKm: 300, avgCadence: 178 }),
      lap({ avgPaceSecPerKm: 300, avgCadence: 162 }),
      lap({ avgPaceSecPerKm: 300, avgCadence: 160 }),
      lap({ avgPaceSecPerKm: 300, avgCadence: 158 })
    ];
    const out = detectLegAnomalies(makeSegment("run", laps));
    expect(out.find((a) => a.type === "cadence_drop")).toBeDefined();
  });

  it("caps at 3 anomalies and orders by severity", () => {
    const laps = [
      lap({ avgPower: 220, avgHr: 145, avgPaceSecPerKm: null }),
      lap({ avgPower: 225, avgHr: 150, avgPaceSecPerKm: null }),
      lap({ avgPower: 10, avgHr: 130, durationSec: 40 }), // dropout
      lap({ avgPower: 220, avgHr: 200 }),                  // hr spike
      lap({ avgPower: 220, avgHr: 150 })
    ];
    const out: Anomaly[] = detectLegAnomalies(makeSegment("bike", laps));
    expect(out.length).toBeLessThanOrEqual(3);
    if (out.find((a) => a.type === "power_dropout") && out.find((a) => a.type === "hr_spike")) {
      // power_dropout sorts before hr_spike
      const idxDrop = out.findIndex((a) => a.type === "power_dropout");
      const idxSpike = out.findIndex((a) => a.type === "hr_spike");
      expect(idxDrop).toBeLessThan(idxSpike);
    }
  });

  it("returns nothing when fewer than 3 laps", () => {
    const laps = [lap({ avgHr: 150 }), lap({ avgHr: 152 })];
    expect(detectLegAnomalies(makeSegment("run", laps))).toEqual([]);
  });
});
