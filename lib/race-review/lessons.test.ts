import {
  buildDeterministicLessons,
  lessonsSanityCheck
} from "./lessons";
import { raceLessonsSchema } from "./lessons-schemas";

type ThisRace = Parameters<typeof buildDeterministicLessons>[0];
type PriorRace = Parameters<typeof buildDeterministicLessons>[1][number];

const baseThisRace: ThisRace = {
  bundleId: "bundle-1",
  raceName: "Olympic A",
  raceDate: "2026-04-15",
  distanceType: "olympic",
  finishSec: 9000,
  goalSec: 8700,
  goalDeltaSec: 300,
  verdict: { headline: "Finished in 2:30:00; +5:00 over 2:25:00 goal" },
  raceStory: { overall: "Race story" },
  legStatus: {
    swim: { label: "on_plan", evidence: ["Swim held 2:00/100m"] },
    bike: { label: "over", evidence: ["First half +6% over target"] },
    run: { label: "faded", evidence: ["Second half eased 4.5%"] }
  },
  segmentDiagnostics: null,
  athleteRating: 3,
  athleteNotes: null,
  issuesFlagged: [],
  emotionalFrame: null,
  crossDisciplineInsight: "Bike over-effort cost the run"
};

const buildPrior = (overrides: Partial<PriorRace> = {}): PriorRace => ({
  bundleId: "bundle-prior-1",
  raceName: "Olympic Prior",
  raceDate: "2025-09-15",
  distanceType: "olympic",
  finishSec: 9100,
  goalSec: 8900,
  goalDeltaSec: 200,
  verdict: null,
  legStatus: { bike: { label: "over", evidence: [] } },
  primaryFinding: "Bike over-effort recurring",
  ...overrides
});

describe("buildDeterministicLessons", () => {
  it("emits a valid first-race lesson with low confidence and no carry-forward when no goal context", () => {
    const noGoal: ThisRace = { ...baseThisRace, goalSec: null, goalDeltaSec: null };
    const lessons = buildDeterministicLessons(noGoal, []);
    raceLessonsSchema.parse(lessons);
    expect(lessons.athleteProfileTakeaways).toHaveLength(1);
    expect(lessons.athleteProfileTakeaways[0].confidence).toBe("low");
    expect(lessons.athleteProfileTakeaways[0].referencesCount).toBe(0);
    expect(lessons.trainingImplications.length).toBeGreaterThanOrEqual(1);
  });

  it("emits a carry-forward referencing the loss leg when goal exists", () => {
    const lessons = buildDeterministicLessons(baseThisRace, []);
    raceLessonsSchema.parse(lessons);
    expect(lessons.carryForward).not.toBeNull();
    expect(lessons.carryForward?.expiresAfterRaceId).toBe(baseThisRace.bundleId);
    expect(/\d/.test(lessons.carryForward?.instruction ?? "")).toBe(true);
  });

  it("calibrates confidence to medium with 1 prior race", () => {
    const lessons = buildDeterministicLessons(baseThisRace, [buildPrior()]);
    expect(lessons.athleteProfileTakeaways[0].confidence).toBe("medium");
    expect(lessons.athleteProfileTakeaways[0].referencesCount).toBe(1);
  });

  it("calibrates confidence to high with 2+ prior races", () => {
    const priors = [buildPrior(), buildPrior({ bundleId: "bundle-prior-2" })];
    const lessons = buildDeterministicLessons(baseThisRace, priors);
    expect(lessons.athleteProfileTakeaways[0].confidence).toBe("high");
    expect(lessons.athleteProfileTakeaways[0].referencesCount).toBe(2);
  });

  it("picks bike as the loss leg when bike is over and run also flags", () => {
    const lessons = buildDeterministicLessons(baseThisRace, []);
    expect(lessons.trainingImplications[0].headline.toLowerCase()).toContain("bike");
    expect(lessons.trainingImplications[0].priority).toBe("high");
  });

  it("falls back to a 'consolidate' implication when no leg flags a loss", () => {
    const cleanRace: ThisRace = {
      ...baseThisRace,
      legStatus: {
        swim: { label: "on_plan", evidence: [] },
        bike: { label: "on_plan", evidence: [] },
        run: { label: "on_plan", evidence: [] }
      }
    };
    const lessons = buildDeterministicLessons(cleanRace, []);
    expect(lessons.trainingImplications[0].priority).toBe("medium");
    expect(lessons.carryForward).toBeNull();
  });
});

describe("lessonsSanityCheck", () => {
  it("rejects a carry-forward whose instruction has no digit", () => {
    const lessons = buildDeterministicLessons(baseThisRace, []);
    const broken = {
      ...lessons,
      carryForward: lessons.carryForward
        ? { ...lessons.carryForward, instruction: "Trust your taper." }
        : null
    };
    expect(lessonsSanityCheck(broken)).toMatch(/missing a number/i);
  });

  it("rejects a training implication whose change has no digit", () => {
    const lessons = buildDeterministicLessons(baseThisRace, []);
    const broken = {
      ...lessons,
      trainingImplications: lessons.trainingImplications.map((i) => ({
        ...i,
        change: "Hold steady, listen to your body."
      }))
    };
    expect(lessonsSanityCheck(broken)).toMatch(/missing a number/i);
  });

  it("accepts a well-formed lessons object", () => {
    const lessons = buildDeterministicLessons(baseThisRace, []);
    expect(lessonsSanityCheck(lessons)).toBeUndefined();
  });
});
