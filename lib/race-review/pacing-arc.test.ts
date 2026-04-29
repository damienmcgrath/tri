import { buildPacingArcData } from "./pacing-arc";
import type { RaceSegmentData } from "@/lib/race-review";

function seg(role: RaceSegmentData["role"], partial: Partial<RaceSegmentData> = {}): RaceSegmentData {
  return {
    activityId: `act-${role}`,
    role,
    segmentIndex: ["swim", "t1", "bike", "t2", "run"].indexOf(role),
    sportType: role,
    durationSec: 1000,
    distanceM: 1000,
    avgHr: 150,
    avgPower: role === "bike" ? 220 : null,
    metricsV2: null,
    ...partial
  };
}

describe("buildPacingArcData", () => {
  it("emits points across all legs in cumulative-time order", () => {
    const result = buildPacingArcData({
      segments: [seg("swim"), seg("t1", { durationSec: 100 }), seg("bike"), seg("t2", { durationSec: 100 }), seg("run")],
      inferredTransitions: false,
      thresholdHrBpm: null
    });

    expect(result.totalDurationSec).toBe(3200);
    expect(result.legBoundaries.map((l) => l.role)).toEqual(["swim", "bike", "run"]);
    expect(result.transitions.map((t) => t.role)).toEqual(["t1", "t2"]);
    // Transition cursor advances correctly — bike should start after swim+T1.
    expect(result.legBoundaries[1].startSec).toBe(1100);
  });

  it("marks transitions inferred for Strava-stitched bundles", () => {
    const result = buildPacingArcData({
      segments: [seg("swim"), seg("t1", { durationSec: 30 }), seg("bike"), seg("t2", { durationSec: 30 }), seg("run")],
      inferredTransitions: true,
      thresholdHrBpm: null
    });

    expect(result.inferredGaps).toBe(true);
    expect(result.transitions.every((t) => t.inferred)).toBe(true);
  });

  it("inferredGaps stays false when there are no transition segments", () => {
    const result = buildPacingArcData({
      segments: [seg("swim"), seg("bike"), seg("run")],
      inferredTransitions: true,
      thresholdHrBpm: null
    });
    expect(result.inferredGaps).toBe(false);
  });

  it("emits per-lap points when metrics_v2.laps is present", () => {
    const segments = [
      seg("swim"),
      seg("bike", {
        durationSec: 1200,
        metricsV2: {
          laps: [
            { index: 1, durationSec: 600, avgPower: 220, avgHr: 150 },
            { index: 2, durationSec: 600, avgPower: 215, avgHr: 152 }
          ]
        }
      }),
      seg("run")
    ];
    const result = buildPacingArcData({ segments, inferredTransitions: false, thresholdHrBpm: 165 });

    const bikePoints = result.points.filter((p) => p.role === "bike");
    expect(bikePoints.length).toBe(2);
    expect(bikePoints[0].power).toBe(220);
    expect(bikePoints[1].power).toBe(215);
    expect(result.thresholdHrBpm).toBe(165);
  });

  it("falls back to a single midpoint when no laps data", () => {
    const segments = [seg("swim"), seg("bike", { metricsV2: null }), seg("run")];
    const result = buildPacingArcData({ segments, inferredTransitions: false, thresholdHrBpm: null });

    const bikePoints = result.points.filter((p) => p.role === "bike");
    expect(bikePoints.length).toBe(1);
  });
});
