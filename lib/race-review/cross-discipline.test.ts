import {
  detectCrossDisciplineSignal,
  athleteAccountSuppressesInsight
} from "./cross-discipline";
import type { LegPacing } from "@/lib/race-review";

const halves = (
  firstHalf: number,
  lastHalf: number,
  unit: "watts" | "sec_per_km" | "sec_per_100m"
): LegPacing => ({
  halvesAvailable: true,
  firstHalf,
  lastHalf,
  deltaPct: ((lastHalf - firstHalf) / firstHalf) * 100,
  unit
});

describe("detectCrossDisciplineSignal", () => {
  it("detects bike_fade → run_hr_drift when bike eased ≥3% and run HR drifted ≥4 with held pace", () => {
    const result = detectCrossDisciplineSignal({
      bikePacing: halves(220, 210, "watts"), // -4.5% drop
      runPacing: halves(280, 282, "sec_per_km"), // 0.7% slowdown
      runHrDriftBpm: 7,
      swimRating: null,
      athleteAccountSuppresses: false
    });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.hypothesis).toBe("bike_fade_to_run_hr_drift");
      expect(result.evidence.length).toBeGreaterThan(0);
    }
  });

  it("detects swim_overcook → bike_under when swim rated ≤2 and bike fades", () => {
    const result = detectCrossDisciplineSignal({
      bikePacing: halves(220, 210, "watts"),
      runPacing: halves(290, 292, "sec_per_km"),
      runHrDriftBpm: 1,
      swimRating: 2,
      athleteAccountSuppresses: false
    });
    expect(result.detected).toBe(true);
    if (result.detected) expect(result.hypothesis).toBe("swim_overcook_to_bike_under");
  });

  it("detects run_fade_at_constant_pace when pace held but HR drifted", () => {
    const result = detectCrossDisciplineSignal({
      bikePacing: halves(220, 220, "watts"),
      runPacing: halves(280, 281, "sec_per_km"),
      runHrDriftBpm: 8,
      swimRating: null,
      athleteAccountSuppresses: false
    });
    expect(result.detected).toBe(true);
    if (result.detected) expect(result.hypothesis).toBe("run_fade_at_constant_pace");
  });

  // ─── ≥3 INDEPENDENT-LEGS test cases (acceptance #3) ─────────────────────

  it("returns null when bike held steady AND run pace+HR held steady", () => {
    const result = detectCrossDisciplineSignal({
      bikePacing: halves(220, 219, "watts"),
      runPacing: halves(280, 281, "sec_per_km"),
      runHrDriftBpm: 1,
      swimRating: 4,
      athleteAccountSuppresses: false
    });
    expect(result.detected).toBe(false);
  });

  it("returns null when bike eased but run had no HR drift (legs disconnected)", () => {
    const result = detectCrossDisciplineSignal({
      bikePacing: halves(220, 210, "watts"), // bike fade
      runPacing: halves(280, 290, "sec_per_km"), // run also faded but on its own
      runHrDriftBpm: 0,
      swimRating: 4,
      athleteAccountSuppresses: false
    });
    expect(result.detected).toBe(false);
  });

  it("returns null when run faded but bike was clean (independent run-side fade)", () => {
    const result = detectCrossDisciplineSignal({
      bikePacing: halves(220, 220, "watts"),
      runPacing: halves(280, 295, "sec_per_km"), // run faded 5%
      runHrDriftBpm: 2, // no clear HR signal
      swimRating: 4,
      athleteAccountSuppresses: false
    });
    expect(result.detected).toBe(false);
  });

  it("suppresses when athlete account explains the issue (illness in notes)", () => {
    const result = detectCrossDisciplineSignal({
      bikePacing: halves(220, 210, "watts"),
      runPacing: halves(280, 282, "sec_per_km"),
      runHrDriftBpm: 7,
      swimRating: null,
      athleteAccountSuppresses: true
    });
    expect(result.detected).toBe(false);
  });
});

describe("athleteAccountSuppressesInsight", () => {
  it("suppresses when issuesFlagged contains illness", () => {
    expect(athleteAccountSuppressesInsight({ notes: null, issuesFlagged: ["illness"] })).toBe(true);
  });

  it("suppresses when notes mention stomach issues", () => {
    expect(
      athleteAccountSuppressesInsight({ notes: "Felt fine until km 30 then stomach issue", issuesFlagged: [] })
    ).toBe(true);
  });

  it("suppresses on mechanical issue tag", () => {
    expect(athleteAccountSuppressesInsight({ notes: null, issuesFlagged: ["mechanical"] })).toBe(true);
  });

  it("does not suppress on benign notes", () => {
    expect(athleteAccountSuppressesInsight({ notes: "Strong tailwind on the back half", issuesFlagged: [] })).toBe(false);
  });

  it("does not suppress with empty inputs", () => {
    expect(athleteAccountSuppressesInsight({ notes: null, issuesFlagged: [] })).toBe(false);
  });
});
