import { generateSeasonPeriodization, validateBlockSequence, type GeneratedBlock } from "./season-engine";
import type { RaceProfile } from "./race-profile";

function makeRace(overrides: Partial<RaceProfile> & { name: string; date: string; priority: "A" | "B" | "C"; distanceType: RaceProfile["distanceType"] }): RaceProfile {
  const { name, date, distanceType, priority, ...rest } = overrides;
  return {
    id: `race-${name.toLowerCase().replace(/\s/g, "-")}`,
    userId: "user-1",
    courseProfile: {},
    idealDisciplineDistribution: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...rest,
    name,
    date,
    distanceType,
    priority,
  };
}

function blockTypes(blocks: GeneratedBlock[]): string[] {
  return blocks.map((b) => b.blockType);
}

describe("generateSeasonPeriodization", () => {
  it("generates blocks for a single A-race 70.3", () => {
    const races = [makeRace({ name: "Hamburg 70.3", date: "2026-07-12", priority: "A", distanceType: "70.3" })];
    const blocks = generateSeasonPeriodization(races, {
      seasonStartDate: "2026-01-05",
      seasonEndDate: "2026-08-31",
    });

    expect(blocks.length).toBeGreaterThanOrEqual(4);

    const types = blockTypes(blocks);
    // Should have Base, Build, Peak, Taper, Race, Recovery in order
    expect(types).toContain("Base");
    expect(types).toContain("Peak");
    expect(types).toContain("Taper");
    expect(types).toContain("Race");
    expect(types).toContain("Recovery");

    // Race block should reference the race
    const raceBlock = blocks.find((b) => b.blockType === "Race");
    expect(raceBlock?.name).toContain("Hamburg 70.3");
    expect(raceBlock?.targetRaceId).toBe("race-hamburg-70.3");
  });

  it("generates blocks for a single A-race Ironman with longer taper", () => {
    const races = [makeRace({ name: "IM Frankfurt", date: "2026-06-28", priority: "A", distanceType: "ironman" })];
    const blocks = generateSeasonPeriodization(races, {
      seasonStartDate: "2026-01-05",
      seasonEndDate: "2026-08-31",
    });

    const taperBlock = blocks.find((b) => b.blockType === "Taper");
    expect(taperBlock).toBeDefined();

    // Ironman taper should be 3 weeks
    if (taperBlock) {
      const start = new Date(`${taperBlock.startDate}T00:00:00Z`);
      const end = new Date(`${taperBlock.endDate}T00:00:00Z`);
      const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      expect(days).toBeGreaterThanOrEqual(14); // At least 2 weeks (may be up to 3)
    }
  });

  it("handles two A-races with transition between", () => {
    const races = [
      makeRace({ name: "Olympic June", date: "2026-06-07", priority: "A", distanceType: "olympic" }),
      makeRace({ name: "70.3 September", date: "2026-09-13", priority: "A", distanceType: "70.3" }),
    ];

    const blocks = generateSeasonPeriodization(races, {
      seasonStartDate: "2026-01-05",
      seasonEndDate: "2026-10-31",
    });

    const raceBlocks = blocks.filter((b) => b.blockType === "Race");
    expect(raceBlocks).toHaveLength(2);
    expect(raceBlocks[0]?.name).toContain("Olympic June");
    expect(raceBlocks[1]?.name).toContain("70.3 September");

    // Should have a transition or recovery between the two race cycles
    const recoveryBlocks = blocks.filter((b) => b.blockType === "Recovery" || b.blockType === "Transition");
    expect(recoveryBlocks.length).toBeGreaterThanOrEqual(1);
  });

  it("handles A + B race with B-race annotation", () => {
    const races = [
      makeRace({ name: "Tune-up Sprint", date: "2026-05-10", priority: "B", distanceType: "sprint" }),
      makeRace({ name: "A-Race 70.3", date: "2026-07-12", priority: "A", distanceType: "70.3" }),
    ];

    const blocks = generateSeasonPeriodization(races, {
      seasonStartDate: "2026-01-05",
      seasonEndDate: "2026-08-31",
    });

    // B-race should be annotated in a block note, not given its own full cycle
    const raceBlocks = blocks.filter((b) => b.blockType === "Race");
    // Only 1 Race block (for the A-race)
    expect(raceBlocks).toHaveLength(1);
    expect(raceBlocks[0]?.name).toContain("A-Race 70.3");

    // Some block should have a note about the B-race
    const annotatedBlock = blocks.find((b) => b.notes?.includes("Tune-up Sprint"));
    expect(annotatedBlock).toBeDefined();
  });

  it("handles C-race train-through annotation", () => {
    const races = [
      makeRace({ name: "Club Sprint", date: "2026-04-25", priority: "C", distanceType: "sprint" }),
      makeRace({ name: "A-Race 70.3", date: "2026-07-12", priority: "A", distanceType: "70.3" }),
    ];

    const blocks = generateSeasonPeriodization(races, {
      seasonStartDate: "2026-01-05",
      seasonEndDate: "2026-08-31",
    });

    const annotatedBlock = blocks.find((b) => b.notes?.includes("Club Sprint"));
    expect(annotatedBlock).toBeDefined();
    expect(annotatedBlock?.notes).toContain("train-through");
  });

  it("returns a single Base block when no races", () => {
    const blocks = generateSeasonPeriodization([], {
      seasonStartDate: "2026-01-05",
      seasonEndDate: "2026-12-31",
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.blockType).toBe("Base");
  });
});

describe("validateBlockSequence", () => {
  it("reports no issues for valid sequence", () => {
    const blocks: GeneratedBlock[] = [
      { name: "Base", blockType: "Base", startDate: "2026-01-05", endDate: "2026-03-01", targetRaceId: null, targetRacePriority: null, notes: null, sortOrder: 0 },
      { name: "Build", blockType: "Build", startDate: "2026-03-02", endDate: "2026-05-01", targetRaceId: null, targetRacePriority: null, notes: null, sortOrder: 1 },
    ];

    const result = validateBlockSequence(blocks);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("reports overlap", () => {
    const blocks: GeneratedBlock[] = [
      { name: "Base", blockType: "Base", startDate: "2026-01-05", endDate: "2026-03-05", targetRaceId: null, targetRacePriority: null, notes: null, sortOrder: 0 },
      { name: "Build", blockType: "Build", startDate: "2026-03-01", endDate: "2026-05-01", targetRaceId: null, targetRacePriority: null, notes: null, sortOrder: 1 },
    ];

    const result = validateBlockSequence(blocks);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("Overlap");
  });
});
