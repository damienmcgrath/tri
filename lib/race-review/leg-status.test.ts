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
});
