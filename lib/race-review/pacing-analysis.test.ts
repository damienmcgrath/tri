import { classifySplitType, computeDriftObservation, computeDecouplingObservation } from "./pacing-analysis";
import type { LegPacing } from "@/lib/race-review";

const watts = (first: number, last: number): LegPacing => ({
  halvesAvailable: true,
  firstHalf: first,
  lastHalf: last,
  deltaPct: ((last - first) / first) * 100,
  unit: "watts"
});

const runPace = (firstSec: number, lastSec: number): LegPacing => ({
  halvesAvailable: true,
  firstHalf: firstSec,
  lastHalf: lastSec,
  deltaPct: ((lastSec - firstSec) / firstSec) * 100,
  unit: "sec_per_km"
});

describe("classifySplitType", () => {
  it("returns null when halves unavailable", () => {
    expect(classifySplitType({ halvesAvailable: false })).toBeNull();
  });

  it("flags even split within ±2% on bike", () => {
    expect(classifySplitType(watts(220, 222))).toBe("even");
    expect(classifySplitType(watts(220, 217))).toBe("even");
  });

  it("flags positive split when bike output drops >2%", () => {
    expect(classifySplitType(watts(220, 200))).toBe("positive");
  });

  it("flags negative split when bike output rises >2%", () => {
    expect(classifySplitType(watts(220, 240))).toBe("negative");
  });

  it("flags positive split when run pace slows >2%", () => {
    expect(classifySplitType(runPace(300, 320))).toBe("positive");
  });

  it("flags negative split when run pace quickens >2%", () => {
    expect(classifySplitType(runPace(310, 290))).toBe("negative");
  });
});

describe("computeDriftObservation", () => {
  it("does not fire under the 5% gate", () => {
    expect(computeDriftObservation(watts(220, 215))).toBeNull(); // -2.3%
    expect(computeDriftObservation(runPace(300, 312))).toBeNull(); // +4%
  });

  it("fires above the 5% gate with direction copy", () => {
    const obs = computeDriftObservation(runPace(300, 320));
    expect(obs).not.toBeNull();
    expect(obs!).toMatch(/eased/);
    expect(obs!).toMatch(/6\.7%/); // 320/300 = 1.0667
  });

  it("describes bike fade as eased", () => {
    const obs = computeDriftObservation(watts(220, 200));
    expect(obs!).toMatch(/eased/);
  });

  it("describes bike build as lifted", () => {
    const obs = computeDriftObservation(watts(200, 220));
    expect(obs!).toMatch(/lifted/);
  });
});

describe("computeDecouplingObservation", () => {
  it("returns null when halves unavailable", () => {
    expect(computeDecouplingObservation({
      pacing: { halvesAvailable: false },
      hrFirstHalfBpm: 145,
      hrLastHalfBpm: 162
    })).toBeNull();
  });

  it("returns null when HR data missing", () => {
    expect(computeDecouplingObservation({
      pacing: watts(220, 215),
      hrFirstHalfBpm: null,
      hrLastHalfBpm: null
    })).toBeNull();
  });

  it("does not fire when total decoupling magnitude ≤ 8%", () => {
    // HR rose 4%, output stayed flat → magnitude 4%
    expect(computeDecouplingObservation({
      pacing: watts(220, 220),
      hrFirstHalfBpm: 145,
      hrLastHalfBpm: 151
    })).toBeNull();
  });

  it("fires for steady output with rising HR over 8%", () => {
    // HR rose ~10%, output flat
    const obs = computeDecouplingObservation({
      pacing: watts(220, 220),
      hrFirstHalfBpm: 145,
      hrLastHalfBpm: 160
    });
    expect(obs).not.toBeNull();
    expect(obs!).toMatch(/decoupling/);
    expect(obs!).toMatch(/steady output/);
  });

  it("fires when output eased and HR climbed", () => {
    // Output dropped 5%, HR rose 5% → magnitude 10%
    const obs = computeDecouplingObservation({
      pacing: runPace(300, 315),
      hrFirstHalfBpm: 150,
      hrLastHalfBpm: 158
    });
    expect(obs).not.toBeNull();
    expect(obs!).toMatch(/output eased/);
  });
});
