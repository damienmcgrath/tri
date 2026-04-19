import {
  computeAerobicDecoupling,
  extractWeatherSignal,
  summarizeZoneDistribution
} from "./session-signals";

describe("computeAerobicDecoupling", () => {
  it("flags significant drift on a run when HR rises faster than pace holds", () => {
    const result = computeAerobicDecoupling({
      sport: "run",
      firstHalfAvgHr: 145,
      lastHalfAvgHr: 158,
      firstHalfPaceSPerKm: 320,
      lastHalfPaceSPerKm: 330
    });
    expect(result).not.toBeNull();
    expect(result!.basis).toBe("pace");
    expect(result!.percent).toBeGreaterThan(10);
    expect(result!.severity).toBe("poor_durability");
  });

  it("reports stable when HR-power ratio barely moves on a bike", () => {
    const result = computeAerobicDecoupling({
      sport: "bike",
      firstHalfAvgHr: 140,
      lastHalfAvgHr: 141,
      firstHalfAvgPower: 200,
      lastHalfAvgPower: 198
    });
    expect(result).not.toBeNull();
    expect(result!.basis).toBe("power");
    expect(Math.abs(result!.percent)).toBeLessThan(3);
    expect(result!.severity).toBe("stable");
  });

  it("returns null for swim even when halves are present", () => {
    const result = computeAerobicDecoupling({
      sport: "swim",
      firstHalfAvgHr: 135,
      lastHalfAvgHr: 145,
      firstHalfPaceSPerKm: 300,
      lastHalfPaceSPerKm: 320
    });
    expect(result).toBeNull();
  });

  it("returns null when the relevant output signal is missing", () => {
    const result = computeAerobicDecoupling({
      sport: "bike",
      firstHalfAvgHr: 140,
      lastHalfAvgHr: 148,
      firstHalfAvgPower: null,
      lastHalfAvgPower: 200
    });
    expect(result).toBeNull();
  });
});

describe("summarizeZoneDistribution", () => {
  it("formats a typical run zone distribution", () => {
    const result = summarizeZoneDistribution([60, 1200, 600, 120, 0], "HR");
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("Z2:");
    const zone2 = result!.zones.find((z) => z.zone === 2)!;
    expect(zone2.pct).toBeGreaterThan(50);
    expect(result!.zones[4].pct).toBe(0);
  });

  it("returns null for empty or all-zero input", () => {
    expect(summarizeZoneDistribution([], "HR")).toBeNull();
    expect(summarizeZoneDistribution([0, 0, 0], "HR")).toBeNull();
    expect(summarizeZoneDistribution(null, "HR")).toBeNull();
  });
});

describe("extractWeatherSignal", () => {
  it("flags hot conditions and wide temperature ranges", () => {
    const result = extractWeatherSignal({
      avgTemperature: 30,
      minTemperature: 22,
      maxTemperature: 33
    });
    expect(result).not.toBeNull();
    expect(result!.avgTemperatureC).toBe(30);
    expect(result!.notable.some((n) => n.includes("hot"))).toBe(true);
    expect(result!.notable.some((n) => n.includes("range"))).toBe(true);
  });

  it("returns null when every temperature field is missing", () => {
    expect(extractWeatherSignal({})).toBeNull();
    expect(extractWeatherSignal(null)).toBeNull();
    expect(extractWeatherSignal({ avgTemperature: null })).toBeNull();
  });

  it("produces no notable flags for temperate conditions", () => {
    const result = extractWeatherSignal({
      temperature: 15,
      avgTemperature: 15,
      minTemperature: 13,
      maxTemperature: 17
    });
    expect(result).not.toBeNull();
    expect(result!.notable).toEqual([]);
  });
});
