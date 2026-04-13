import { inferExtraIntent, EXTRA_INTENT_OPTIONS } from "./infer-extra-intent";

const baseZone = (zone: number, durationSec: number) => ({
  zone,
  durationSec,
  pctOfSession: null,
});

describe("inferExtraIntent", () => {
  test("classifies short, mostly-Z1/Z2 effort as recovery", () => {
    const result = inferExtraIntent({
      sport_type: "run",
      duration_sec: 30 * 60,
      metrics_v2: {
        zones: {
          hr: [
            baseZone(1, 900),
            baseZone(2, 720),
            baseZone(3, 180),
          ],
        },
      },
    });

    expect(result.intentCategory).toBe("recovery");
    expect(result.rationale).toMatch(/zone 1-2/);
  });

  test("classifies mostly Z1-Z2 run over 45 min as easy endurance", () => {
    const result = inferExtraIntent({
      sport_type: "run",
      duration_sec: 60 * 60,
      metrics_v2: {
        zones: {
          hr: [
            baseZone(1, 1500),
            baseZone(2, 1800),
            baseZone(3, 300),
          ],
        },
      },
    });

    expect(result.intentCategory).toBe("easy endurance");
  });

  test("classifies long runs by duration even with easy intensity", () => {
    const result = inferExtraIntent({
      sport_type: "run",
      duration_sec: 100 * 60,
      metrics_v2: {
        zones: {
          hr: [baseZone(1, 2000), baseZone(2, 4000)],
        },
      },
    });

    expect(result.intentCategory).toBe("long endurance run");
    expect(result.rationale).toMatch(/100 min/);
  });

  test("classifies long rides by duration threshold (≥150 min)", () => {
    const result = inferExtraIntent({
      sport_type: "bike",
      duration_sec: 180 * 60,
      metrics_v2: {
        zones: {
          hr: [baseZone(1, 3600), baseZone(2, 7200)],
        },
      },
    });

    expect(result.intentCategory).toBe("long endurance ride");
  });

  test("classifies ≥20% time in Z4+ as threshold intervals (HR signal)", () => {
    const result = inferExtraIntent({
      sport_type: "bike",
      duration_sec: 60 * 60,
      metrics_v2: {
        zones: {
          hr: [
            baseZone(1, 600),
            baseZone(2, 1200),
            baseZone(3, 900),
            baseZone(4, 900),
          ],
        },
      },
    });

    expect(result.intentCategory).toBe("threshold intervals");
    expect(result.rationale).toMatch(/zone 4/);
  });

  test("classifies ≥20% time in Z4+ as threshold intervals (power signal)", () => {
    const result = inferExtraIntent({
      sport_type: "bike",
      duration_sec: 60 * 60,
      metrics_v2: {
        zones: {
          power: [
            baseZone(1, 600),
            baseZone(2, 1200),
            baseZone(3, 900),
            baseZone(4, 900),
          ],
        },
      },
    });

    expect(result.intentCategory).toBe("threshold intervals");
  });

  test("uses variability index + lap structure to flag intervals when zones are missing", () => {
    const result = inferExtraIntent({
      sport_type: "bike",
      duration_sec: 60 * 60,
      metrics_v2: {
        power: { variabilityIndex: 1.22 },
        laps: [
          { index: 0, distanceM: 2000, durationSec: 600 },
          { index: 1, distanceM: 1500, durationSec: 300 },
          { index: 2, distanceM: 1500, durationSec: 300 },
          { index: 3, distanceM: 2000, durationSec: 600 },
        ],
      },
    });

    expect(result.intentCategory).toBe("threshold intervals");
    expect(result.rationale).toMatch(/variability/);
  });

  test("does not classify steady ride with high VI but no lap structure as threshold", () => {
    const result = inferExtraIntent({
      sport_type: "bike",
      duration_sec: 60 * 60,
      metrics_v2: {
        power: { variabilityIndex: 1.22 },
      },
    });

    // Without lap structure we can't confirm intervals, so fall through.
    expect(result.intentCategory).not.toBe("threshold intervals");
  });

  test("defaults to easy endurance when no intensity signals are available", () => {
    const result = inferExtraIntent({
      sport_type: "run",
      duration_sec: 45 * 60,
      metrics_v2: null,
    });

    expect(result.intentCategory).toBe("easy endurance");
    expect(result.rationale).toMatch(/no strong intensity signals|defaulted/i);
  });

  test("returns extra swim label for swim sport", () => {
    const result = inferExtraIntent({
      sport_type: "swim",
      duration_sec: 45 * 60,
      metrics_v2: {},
    });

    expect(result.intentCategory).toBe("extra swim");
  });

  test("returns extra strength label for strength sport", () => {
    const result = inferExtraIntent({
      sport_type: "strength",
      duration_sec: 30 * 60,
      metrics_v2: {},
    });

    expect(result.intentCategory).toBe("extra strength");
  });

  test("recovery classification requires a duration under the threshold", () => {
    // Same easy zone mix but at 60 min — should be easy endurance, not recovery.
    const result = inferExtraIntent({
      sport_type: "run",
      duration_sec: 60 * 60,
      metrics_v2: {
        zones: {
          hr: [baseZone(1, 2000), baseZone(2, 1600)],
        },
      },
    });

    expect(result.intentCategory).toBe("easy endurance");
  });

  test("handles zone arrays in snake_case duration_sec keys", () => {
    const result = inferExtraIntent({
      sport_type: "run",
      duration_sec: 60 * 60,
      metrics_v2: {
        zones: {
          hr: [
            { zone: 1, duration_sec: 1800, pct_of_session: 50 },
            { zone: 2, duration_sec: 1200, pct_of_session: 33 },
            { zone: 3, duration_sec: 600, pct_of_session: 17 },
          ],
        },
      },
    });

    expect(result.intentCategory).toBe("easy endurance");
  });
});

describe("EXTRA_INTENT_OPTIONS", () => {
  test("covers every intent category that inferExtraIntent can return", () => {
    const optionValues = new Set(EXTRA_INTENT_OPTIONS.map((o) => o.value));
    const knownCategories = [
      "recovery",
      "easy endurance",
      "long endurance run",
      "long endurance ride",
      "threshold intervals",
      "extra swim",
      "extra strength",
    ];
    for (const cat of knownCategories) {
      expect(optionValues).toContain(cat);
    }
  });

  test("each option has a non-empty label", () => {
    for (const opt of EXTRA_INTENT_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  test("sport-specific options have correct sport filters", () => {
    const runOpt = EXTRA_INTENT_OPTIONS.find((o) => o.value === "long endurance run");
    expect(runOpt?.sports).toEqual(["run"]);

    const bikeOpt = EXTRA_INTENT_OPTIONS.find((o) => o.value === "long endurance ride");
    expect(bikeOpt?.sports).toEqual(["bike"]);

    const swimOpt = EXTRA_INTENT_OPTIONS.find((o) => o.value === "extra swim");
    expect(swimOpt?.sports).toEqual(["swim"]);

    const recoveryOpt = EXTRA_INTENT_OPTIONS.find((o) => o.value === "recovery");
    expect(recoveryOpt?.sports).toEqual(["run", "bike"]);

    const easyOpt = EXTRA_INTENT_OPTIONS.find((o) => o.value === "easy endurance");
    expect(easyOpt?.sports).toEqual(["run", "bike"]);

    const thresholdOpt = EXTRA_INTENT_OPTIONS.find((o) => o.value === "threshold intervals");
    expect(thresholdOpt?.sports).toEqual(["run", "bike"]);
  });

  test("swim and strength only see their own options", () => {
    const swimOptions = EXTRA_INTENT_OPTIONS.filter(
      (o) => o.sports === null || o.sports.includes("swim")
    );
    expect(swimOptions.map((o) => o.value)).toEqual(["extra swim"]);

    const strengthOptions = EXTRA_INTENT_OPTIONS.filter(
      (o) => o.sports === null || o.sports.includes("strength")
    );
    expect(strengthOptions.map((o) => o.value)).toEqual(["extra strength"]);
  });
});
