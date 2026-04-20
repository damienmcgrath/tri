import { normalizePersistedArtifact, LEGACY_NARRATIVE_INSIGHT_PLACEHOLDER } from "./deterministic";
import type { WeeklyDebriefRecord } from "./types";

/**
 * Prod has weekly_debriefs rows written before `nonObviousInsight` existed on
 * the narrative schema. The read path must never throw on those — otherwise
 * the dashboard stops rendering the stored debrief.
 */
describe("normalizePersistedArtifact — legacy shape compatibility", () => {
  const BASE_FACTS = {
    weekLabel: "Week of Mar 9",
    weekRange: "Mar 9 – Mar 15",
    title: "A mostly intact week",
    statusLine: "Most of the planned work landed.",
    primaryTakeawayTitle: "The week had one clear strength",
    primaryTakeawayDetail: "Strength sessions anchored the week.",
    plannedSessions: 7,
    completedPlannedSessions: 6,
    completedSessions: 6,
    addedSessions: 0,
    skippedSessions: 1,
    remainingSessions: 0,
    keySessionsCompleted: 2,
    keySessionsMissed: 0,
    keySessionsTotal: 2,
    plannedMinutes: 420,
    completedPlannedMinutes: 360,
    completedMinutes: 360,
    skippedMinutes: 60,
    extraMinutes: 0,
    completionPct: 86,
    dominantSport: "run",
    keySessionStatus: "All key sessions landed",
    metrics: [
      { label: "Completion", value: "86%", tone: "positive" },
      { label: "Key sessions", value: "2 / 2", tone: "positive" },
      { label: "Skipped", value: "1", tone: "neutral" }
    ],
    factualBullets: ["6 of 7 sessions completed.", "All key sessions landed."],
    confidenceNote: null,
    narrativeSource: "ai",
    artifactStateLabel: "final",
    artifactStateNote: null,
    provisionalReviewCount: 0,
    weekShape: "normal",
    reflectionsSparse: false,
    feelsSnapshot: null
  };

  function buildLegacyRecord(overrides: Partial<WeeklyDebriefRecord> = {}): WeeklyDebriefRecord {
    return {
      week_start: "2026-03-09",
      week_end: "2026-03-15",
      status: "ready",
      source_updated_at: "2026-03-15T18:00:00.000Z",
      generated_at: "2026-03-15T18:05:00.000Z",
      generation_version: 5,
      facts: BASE_FACTS,
      narrative: {
        executiveSummary: "A mostly intact week.",
        highlights: ["one", "two", "three"],
        observations: ["one"],
        carryForward: ["one", "two"]
      },
      coach_share: {
        headline: "Mostly intact",
        summary: "A mostly intact week.",
        wins: ["one"],
        concerns: ["one"],
        carryForward: ["one", "two"]
      },
      helpful: null,
      accurate: null,
      feedback_note: null,
      feedback_updated_at: null,
      ...overrides
    };
  }

  test("parses a legacy narrative that lacks nonObviousInsight instead of throwing", () => {
    const record = buildLegacyRecord();
    const artifact = normalizePersistedArtifact(record, "ready");
    expect(artifact.narrative.nonObviousInsight).toBeTruthy();
    expect(artifact.narrative.nonObviousInsight).toMatch(/saved before this field existed/i);
    expect(artifact.narrative.executiveSummary).toBe("A mostly intact week.");
  });

  test("injects the exact LEGACY_NARRATIVE_INSIGHT_PLACEHOLDER sentinel so render sites can detect and hide it", () => {
    const record = buildLegacyRecord();
    const artifact = normalizePersistedArtifact(record, "ready");
    // The UI sentinel-checks against this exact constant to suppress the
    // Coach insight card for legacy rows. If the placeholder string is
    // changed here without updating the render site, legacy rows will
    // surface it as real athlete copy.
    expect(artifact.narrative.nonObviousInsight).toBe(LEGACY_NARRATIVE_INSIGHT_PLACEHOLDER);
  });

  test("preserves a present nonObviousInsight on newly-generated narratives", () => {
    const record = buildLegacyRecord({
      narrative: {
        executiveSummary: "Volume held while intensity climbed.",
        highlights: ["one", "two", "three"],
        observations: ["one"],
        carryForward: ["one", "two"],
        nonObviousInsight: "Threshold pace held the same 4:45/km ceiling for 3 weeks while HR at that pace dropped 4 bpm."
      }
    });
    const artifact = normalizePersistedArtifact(record, "ready");
    expect(artifact.narrative.nonObviousInsight).toMatch(/4 bpm/);
  });
});
