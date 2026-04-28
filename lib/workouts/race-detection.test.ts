import { detectRaceBundle, type RaceCandidate } from "./race-detection";

const baseStart = new Date("2026-04-26T08:03:08.000Z").getTime();

function at(offsetSec: number, durationSec: number, sport: string, id?: string): RaceCandidate {
  return {
    id: id ?? `${sport}-${offsetSec}`,
    sport,
    durationSec,
    startUtc: new Date(baseStart + offsetSec * 1000).toISOString()
  };
}

describe("detectRaceBundle", () => {
  it("matches a full 5-segment Olympic shape (swim, t1, bike, t2, run)", () => {
    const candidates: RaceCandidate[] = [
      at(0, 1601, "swim"),
      at(1601 + 2, 130, "transition"),
      at(1601 + 132 + 2, 4619, "cycling"),
      at(1601 + 132 + 4621 + 2, 99, "transition"),
      at(1601 + 132 + 4621 + 101 + 2, 2641, "running")
    ];
    const result = detectRaceBundle(candidates, { plannedDurationMin: 150 });
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.orderedSegments.map((s) => s.role)).toEqual(["swim", "t1", "bike", "t2", "run"]);
    expect(result.orderedSegments.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("matches a 3-segment shape with no transitions recorded", () => {
    const candidates: RaceCandidate[] = [
      at(0, 1500, "swim"),
      at(1500 + 60, 4500, "bike"),
      at(1500 + 60 + 4500 + 60, 2400, "run")
    ];
    const result = detectRaceBundle(candidates);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.orderedSegments.map((s) => s.role)).toEqual(["swim", "bike", "run"]);
  });

  it("treats short Strava-style strength activities as transitions", () => {
    const candidates: RaceCandidate[] = [
      at(0, 1601, "swim"),
      at(1605, 130, "strength"),
      at(1740, 4619, "bike"),
      at(6361, 99, "workout"),
      at(6462, 2641, "run")
    ];
    const result = detectRaceBundle(candidates);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.orderedSegments.find((s) => s.role === "t1")?.id).toBe("strength-1605");
    expect(result.orderedSegments.find((s) => s.role === "t2")?.id).toBe("workout-6361");
  });

  it("rejects when no swim is present", () => {
    const result = detectRaceBundle([
      at(0, 4500, "bike"),
      at(4500 + 60, 2400, "run"),
      at(7000, 100, "transition")
    ]);
    expect(result).toEqual({ matched: false, reason: "no_swim" });
  });

  it("rejects when run comes before bike (wrong order)", () => {
    const result = detectRaceBundle([
      at(0, 1500, "swim"),
      at(1600, 2400, "running"),
      at(4100, 4500, "cycling")
    ]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe("no_run_after_bike");
  });

  it("rejects when adjacent gap exceeds threshold", () => {
    const candidates: RaceCandidate[] = [
      at(0, 1500, "swim"),
      at(1500 + 3600, 4500, "bike"), // 1 hour gap before bike
      at(1500 + 3600 + 4500 + 60, 2400, "run")
    ];
    const result = detectRaceBundle(candidates);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe("gap_too_long");
  });

  it("rejects when an inferred transition is too long", () => {
    const candidates: RaceCandidate[] = [
      at(0, 1500, "swim"),
      at(1505, 1200, "strength"), // 20 min "transition"
      at(2705 + 5, 4500, "bike"),
      at(2705 + 5 + 4500 + 60, 2400, "run")
    ];
    const result = detectRaceBundle(candidates);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe("transition_too_long");
  });

  it("rejects when total duration is far from the planned race", () => {
    const candidates: RaceCandidate[] = [
      at(0, 60, "swim"),
      at(120, 60, "bike"),
      at(240, 60, "run")
    ];
    const result = detectRaceBundle(candidates, { plannedDurationMin: 150 });
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe("duration_out_of_range");
  });

  it("rejects when fewer than three candidates are supplied", () => {
    const result = detectRaceBundle([at(0, 1500, "swim"), at(1600, 4500, "bike")]);
    expect(result).toEqual({ matched: false, reason: "fewer_than_three_candidates" });
  });
});
