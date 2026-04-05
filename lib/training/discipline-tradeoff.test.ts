import {
  computeDeltas,
  classifyDeltaSeverity,
  generateRebalancingRecommendations,
  type BalanceSnapshot,
  type DisciplineDistribution,
} from "./discipline-tradeoff";

function makeSnapshot(overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    snapshotDate: "2026-04-04",
    windowDays: 21,
    actual: { swim: 0.20, bike: 0.45, run: 0.25, strength: 0.10 },
    target: { swim: 0.15, bike: 0.42, run: 0.33 },
    deltas: { swim: 5, bike: 3, run: -8 },
    totalHours: 12.5,
    hoursBySport: { swim: 2.5, bike: 5.6, run: 3.1, strength: 1.3 },
    ...overrides,
  };
}

describe("computeDeltas", () => {
  it("computes correct percentage-point deltas", () => {
    const actual: DisciplineDistribution = { swim: 0.20, bike: 0.45, run: 0.25 };
    const target: DisciplineDistribution = { swim: 0.15, bike: 0.42, run: 0.33 };

    const deltas = computeDeltas(actual, target);
    expect(deltas.swim).toBe(5);
    expect(deltas.bike).toBe(3);
    expect(deltas.run).toBe(-8);
  });

  it("returns zero deltas for matching distribution", () => {
    const dist: DisciplineDistribution = { swim: 0.15, bike: 0.42, run: 0.33 };
    const deltas = computeDeltas(dist, dist);
    expect(deltas.swim).toBe(0);
    expect(deltas.bike).toBe(0);
    expect(deltas.run).toBe(0);
  });
});

describe("classifyDeltaSeverity", () => {
  it("classifies on_target for small deltas", () => {
    expect(classifyDeltaSeverity(3)).toBe("on_target");
    expect(classifyDeltaSeverity(-4)).toBe("on_target");
  });

  it("classifies moderate for 5-9pp", () => {
    expect(classifyDeltaSeverity(5)).toBe("moderate");
    expect(classifyDeltaSeverity(-7)).toBe("moderate");
  });

  it("classifies significant for >=10pp", () => {
    expect(classifyDeltaSeverity(10)).toBe("significant");
    expect(classifyDeltaSeverity(-15)).toBe("significant");
  });
});

describe("generateRebalancingRecommendations", () => {
  it("recommends maintain when all sports on target", () => {
    const snapshot = makeSnapshot({
      deltas: { swim: 2, bike: -1, run: -1 },
    });

    const recs = generateRebalancingRecommendations(snapshot);
    expect(recs).toHaveLength(1);
    expect(recs[0]?.type).toBe("maintain");
  });

  it("recommends swap when one over and one under", () => {
    const snapshot = makeSnapshot({
      actual: { swim: 0.25, bike: 0.45, run: 0.20 },
      target: { swim: 0.15, bike: 0.42, run: 0.33 },
      deltas: { swim: 10, bike: 3, run: -13 },
    });

    const recs = generateRebalancingRecommendations(snapshot);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]?.type).toBe("swap");
    expect(recs[0]?.sport).toBe("run");
    expect(recs[0]?.summary).toContain("swim");
    expect(recs[0]?.summary).toContain("run");
  });

  it("recommends add when sport is under-invested", () => {
    const snapshot = makeSnapshot({
      actual: { swim: 0.12, bike: 0.42, run: 0.36 },
      target: { swim: 0.20, bike: 0.42, run: 0.33 },
      deltas: { swim: -8, bike: 0, run: 3 },
    });

    const recs = generateRebalancingRecommendations(snapshot);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]?.type).toBe("add");
    expect(recs[0]?.sport).toBe("swim");
  });

  it("recommends reduce when sport is over-invested", () => {
    const snapshot = makeSnapshot({
      actual: { swim: 0.15, bike: 0.55, run: 0.20 },
      target: { swim: 0.15, bike: 0.42, run: 0.33 },
      deltas: { swim: 0, bike: 13, run: -13 },
    });

    const recs = generateRebalancingRecommendations(snapshot);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    // Should recommend swap (bike over, run under) with priority
    expect(recs[0]?.type).toBe("swap");
  });
});
