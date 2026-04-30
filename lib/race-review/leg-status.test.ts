import { classifyLegStatus } from "./leg-status";
import type { LegPacing } from "@/lib/race-review";

const halves = (firstHalf: number, lastHalf: number, unit: "watts" | "sec_per_km" | "sec_per_100m"): LegPacing => ({
  halvesAvailable: true,
  firstHalf,
  lastHalf,
  deltaPct: ((lastHalf - firstHalf) / firstHalf) * 100,
  unit
});

describe("classifyLegStatus", () => {
  it("returns null when halves data is unavailable", () => {
    expect(classifyLegStatus({ pacing: { halvesAvailable: false }, targetOutput: 220 })).toBeNull();
    expect(classifyLegStatus({ pacing: undefined, targetOutput: 220 })).toBeNull();
  });

  it("labels bike on_plan when halves stable and avg within 5% of target", () => {
    const pacing = halves(220, 219, "watts");
    const result = classifyLegStatus({ pacing, targetOutput: 220 });
    expect(result?.label).toBe("on_plan");
  });

  it("labels bike strong when avg ≥3% above target with stable halves", () => {
    const pacing = halves(230, 229, "watts");
    const result = classifyLegStatus({ pacing, targetOutput: 220 });
    expect(result?.label).toBe("strong");
  });

  it("labels bike under when avg ≥5% under target with stable halves", () => {
    const pacing = halves(206, 207, "watts");
    const result = classifyLegStatus({ pacing, targetOutput: 220 });
    expect(result?.label).toBe("under");
  });

  it("labels bike over when first half ≥4% above target", () => {
    const pacing = halves(232, 220, "watts");
    const result = classifyLegStatus({ pacing, targetOutput: 220 });
    expect(result?.label).toBe("over");
  });

  it("labels bike faded when second half drops 4–7% vs first half", () => {
    const pacing = halves(220, 210, "watts");
    const result = classifyLegStatus({ pacing, targetOutput: 220 });
    expect(result?.label).toBe("faded");
  });

  it("labels bike cooked when second half drops ≥8%", () => {
    const pacing = halves(220, 200, "watts");
    const result = classifyLegStatus({ pacing, targetOutput: 220 });
    expect(result?.label).toBe("cooked");
  });

  it("labels run cooked when HR drifts ≥6bpm AND pace drops ≥3%", () => {
    const pacing = halves(280, 290, "sec_per_km");
    const result = classifyLegStatus({ pacing, targetOutput: 280, hrDriftBpm: 8 });
    expect(result?.label).toBe("cooked");
  });

  it("labels run faded when pace drops 4–7% with no HR signal", () => {
    const pacing = halves(280, 295, "sec_per_km");
    const result = classifyLegStatus({ pacing, targetOutput: 280 });
    expect(result?.label).toBe("faded");
  });

  it("evidence sentence references the drop magnitude", () => {
    const pacing = halves(220, 200, "watts");
    const result = classifyLegStatus({ pacing, targetOutput: 220 });
    expect(result?.evidence[0]).toMatch(/9\.[0-9]/);
  });

  describe("whole-leg fallback (halves not available)", () => {
    it("returns null when no leg average is provided", () => {
      const result = classifyLegStatus({
        pacing: { halvesAvailable: false },
        targetOutput: 100
      });
      expect(result).toBeNull();
    });

    it("returns null when leg average has no unit", () => {
      const result = classifyLegStatus({
        pacing: { halvesAvailable: false },
        targetOutput: 100,
        legAverageOutput: 102
      });
      expect(result).toBeNull();
    });

    it("labels swim on_plan when avg is within 3% of target", () => {
      const result = classifyLegStatus({
        pacing: { halvesAvailable: false },
        targetOutput: 100,
        legAverageOutput: 101,
        legAverageUnit: "sec_per_100m"
      });
      expect(result?.label).toBe("on_plan");
      expect(result?.evidence[0]).toMatch(/halves not available/);
    });

    it("labels swim strong when avg is ≥3% faster than target", () => {
      // pace lower-is-better — 95 vs 100 → 5% faster
      const result = classifyLegStatus({
        pacing: { halvesAvailable: false },
        targetOutput: 100,
        legAverageOutput: 95,
        legAverageUnit: "sec_per_100m"
      });
      expect(result?.label).toBe("strong");
    });

    it("labels swim under when avg is ≥5% slower than target", () => {
      // 110 vs 100 → 10% slower (under target)
      const result = classifyLegStatus({
        pacing: { halvesAvailable: false },
        targetOutput: 100,
        legAverageOutput: 110,
        legAverageUnit: "sec_per_100m"
      });
      expect(result?.label).toBe("under");
    });

    it("labels bike strong when avg watts ≥3% above target", () => {
      // watts higher-is-better — 230 vs 220 → strong
      const result = classifyLegStatus({
        pacing: { halvesAvailable: false },
        targetOutput: 220,
        legAverageOutput: 230,
        legAverageUnit: "watts"
      });
      expect(result?.label).toBe("strong");
    });

    it("never emits over/faded/cooked from the fallback", () => {
      // Even a wildly slow leg average maps to under, not faded/cooked.
      const result = classifyLegStatus({
        pacing: { halvesAvailable: false },
        targetOutput: 100,
        legAverageOutput: 130,
        legAverageUnit: "sec_per_100m"
      });
      expect(["on_plan", "strong", "under"]).toContain(result?.label);
    });
  });
});
