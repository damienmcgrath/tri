import { findBestComparableTraining, type ComparableCandidate } from "./best-comparable";

const baseCandidate = (overrides: Partial<ComparableCandidate>): ComparableCandidate => ({
  sessionId: "s1",
  date: "2026-04-01",
  sport: "run",
  durationSec: 3600,
  sessionName: null,
  type: null,
  sessionRole: null,
  ...overrides
});

describe("findBestComparableTraining", () => {
  it("returns null with empty pool", () => {
    const out = findBestComparableTraining({
      discipline: "run",
      raceLegDurationSec: 3600,
      candidates: []
    });
    expect(out).toBeNull();
  });

  it("ignores candidates with the wrong sport", () => {
    const out = findBestComparableTraining({
      discipline: "run",
      raceLegDurationSec: 3600,
      candidates: [baseCandidate({ sport: "bike", sessionName: "Race-pace ride" })]
    });
    expect(out).toBeNull();
  });

  it("matches a race-pace session of comparable duration", () => {
    const out = findBestComparableTraining({
      discipline: "run",
      raceLegDurationSec: 3600,
      candidates: [
        baseCandidate({
          sessionId: "race-pace-run",
          durationSec: 3600,
          sessionName: "10K race-pace tempo",
          sessionRole: "key"
        }),
        baseCandidate({
          sessionId: "easy-recovery",
          durationSec: 3600,
          sessionName: "Easy recovery jog",
          sessionRole: "recovery"
        })
      ]
    });
    expect(out).not.toBeNull();
    expect(out!.sessionId).toBe("race-pace-run");
  });

  it("returns null when nothing meets the score floor", () => {
    const out = findBestComparableTraining({
      discipline: "run",
      raceLegDurationSec: 3600,
      candidates: [
        baseCandidate({
          sessionId: "tiny-recovery",
          durationSec: 1500, // way off duration AND recovery intent
          sessionName: "Easy recovery shakeout",
          sessionRole: "recovery"
        })
      ]
    });
    expect(out).toBeNull();
  });

  it("rejects candidates outside ±60% duration", () => {
    const out = findBestComparableTraining({
      discipline: "run",
      raceLegDurationSec: 3600,
      candidates: [
        baseCandidate({
          sessionId: "marathon-paced",
          durationSec: 7800, // 117% over
          sessionName: "Marathon-paced long run"
        })
      ]
    });
    expect(out).toBeNull();
  });

  it("prefers race-pace over endurance when both are close", () => {
    const out = findBestComparableTraining({
      discipline: "bike",
      raceLegDurationSec: 7200,
      candidates: [
        baseCandidate({
          sessionId: "endurance",
          sport: "bike",
          durationSec: 7200,
          sessionName: "Z2 endurance ride",
          sessionRole: "supporting"
        }),
        baseCandidate({
          sessionId: "race-pace",
          sport: "bike",
          durationSec: 7200,
          sessionName: "Race-pace 70.3 effort",
          sessionRole: "key"
        })
      ]
    });
    expect(out!.sessionId).toBe("race-pace");
  });
});
