import { getTransitionNorm } from "./transition-norms";
import type { RaceProfileForReview } from "@/lib/race-review";

const baseProfile: Omit<RaceProfileForReview, "distanceType"> = {
  id: "rp-1",
  name: "Test Race",
  date: "2026-04-15",
  idealDisciplineDistribution: null
};

describe("getTransitionNorm", () => {
  it.each([
    ["sprint", 90, 70],
    ["olympic", 150, 90],
    ["70.3", 240, 150],
    ["ironman", 360, 240]
  ] as const)("returns medians for %s", (distance, t1, t2) => {
    const norm = getTransitionNorm({ ...baseProfile, distanceType: distance });
    expect(norm).toEqual({ t1Sec: t1, t2Sec: t2 });
  });

  it("returns null for unknown distance type", () => {
    expect(getTransitionNorm({ ...baseProfile, distanceType: "custom" })).toBeNull();
  });

  it("returns null when no profile", () => {
    expect(getTransitionNorm(null)).toBeNull();
  });
});
