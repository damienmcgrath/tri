import { generateRaceSeededPrompts, type SeededPromptsInput } from "@/lib/race-review/seeded-prompts";
import type { RaceBundleSummary } from "@/lib/race/bundle-helpers";

function buildSummary(overrides: {
  bundle?: Partial<RaceBundleSummary["bundle"]>;
  review?: Partial<NonNullable<RaceBundleSummary["review"]>> | null;
  raceProfile?: RaceBundleSummary["raceProfile"];
  lessons?: RaceBundleSummary["lessons"];
} = {}): RaceBundleSummary {
  const baseBundle: RaceBundleSummary["bundle"] = {
    id: "bundle-1",
    user_id: "u1",
    started_at: "2026-04-15T08:00:00.000Z",
    ended_at: "2026-04-15T11:30:00.000Z",
    total_duration_sec: 9000,
    total_distance_m: 51500,
    source: "garmin_multisport",
    race_profile_id: "profile-1",
    goal_time_sec: 8400,
    goal_strategy_summary: null,
    course_profile_snapshot: {},
    pre_race_ctl: 80,
    pre_race_atl: 70,
    pre_race_tsb: 10,
    pre_race_tsb_state: "fresh",
    pre_race_ramp_rate: 1,
    pre_race_snapshot_at: "2026-04-14T00:00:00.000Z",
    pre_race_snapshot_status: "captured",
    taper_compliance_score: 0.92,
    taper_compliance_summary: "clean",
    athlete_rating: 4,
    athlete_notes: "Strong race",
    issues_flagged: [],
    finish_position: null,
    age_group_position: null,
    subjective_captured_at: "2026-04-15T20:00:00.000Z",
    status: "reviewed",
    inferred_transitions: false
  };

  const baseReview: NonNullable<RaceBundleSummary["review"]> = {
    headline: null,
    narrative: null,
    coach_take: null,
    transition_notes: null,
    pacing_notes: null,
    discipline_distribution_actual: null,
    discipline_distribution_delta: null,
    is_provisional: false,
    generated_at: "2026-04-15T20:30:00.000Z",
    verdict: null,
    race_story: null,
    leg_status: { swim: { status: "on_plan" }, bike: { status: "on_plan" }, run: { status: "on_plan" } },
    emotional_frame: null,
    cross_discipline_insight: null,
    pacing_arc_data: null,
    tone_violations: null,
    segment_diagnostics: null,
    transitions_analysis: null,
    model_used: "test"
  };

  return {
    bundle: { ...baseBundle, ...overrides.bundle },
    raceProfile: overrides.raceProfile ?? { id: "profile-1", name: "Olympic A", date: "2026-04-15", distance_type: "olympic" },
    segments: [],
    review: overrides.review === null ? null : { ...baseReview, ...(overrides.review ?? {}) },
    lessons: overrides.lessons ?? null
  };
}

describe("generateRaceSeededPrompts", () => {
  it("AUDIT: never produces 'Was my taper right?' when taper was clean and TSB state is fresh/absorbing", () => {
    const cases = [
      { taper_compliance_score: 0.95, pre_race_tsb_state: "fresh" as const },
      { taper_compliance_score: 0.85, pre_race_tsb_state: "absorbing" as const },
      { taper_compliance_score: null, pre_race_tsb_state: "fresh" as const }
    ];

    for (const bundleOverride of cases) {
      const input: SeededPromptsInput = {
        summary: buildSummary({ bundle: bundleOverride }),
        priorRaces: [],
        nextRace: null
      };
      const prompts = generateRaceSeededPrompts(input);
      expect(prompts.find((p) => p.reason === "taper_off" || p.reason === "fatigued_at_start")).toBeUndefined();
      expect(prompts.find((p) => p.prompt.includes("taper"))).toBeUndefined();
    }
  });

  it("produces 'Why did the bike fade?' when bike leg status is faded", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary({
        review: {
          leg_status: { swim: { status: "on_plan" }, bike: { status: "faded" }, run: { status: "on_plan" } }
        }
      }),
      priorRaces: [],
      nextRace: null
    };
    const prompts = generateRaceSeededPrompts(input);
    expect(prompts[0]?.prompt).toBe("Why did the bike fade?");
    expect(prompts[0]?.reason).toBe("bike_fade");
  });

  it("reads leg_status when production payload uses { label } shape (deterministic upstream)", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary({
        review: {
          leg_status: { swim: { label: "on_plan" }, bike: { label: "faded" }, run: { label: "on_plan" } }
        }
      }),
      priorRaces: [],
      nextRace: null
    };
    const prompts = generateRaceSeededPrompts(input);
    expect(prompts[0]?.reason).toBe("bike_fade");
  });

  it("produces 'Was my taper right?' when taper compliance is below threshold", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary({ bundle: { taper_compliance_score: 0.65 } }),
      priorRaces: [],
      nextRace: null
    };
    const prompts = generateRaceSeededPrompts(input);
    const taperPrompt = prompts.find((p) => p.reason === "taper_off");
    expect(taperPrompt?.prompt).toBe("Was my taper right?");
  });

  it("produces 'Was my taper right?' when pre-race TSB state is fatigued", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary({ bundle: { pre_race_tsb_state: "fatigued" } }),
      priorRaces: [],
      nextRace: null
    };
    const prompts = generateRaceSeededPrompts(input);
    const taperPrompt = prompts.find((p) => p.reason === "fatigued_at_start");
    expect(taperPrompt?.prompt).toBe("Was my taper right?");
  });

  it("produces a cross-discipline what-if when bike→run insight is present", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary({
        review: {
          cross_discipline_insight: "Pushed bike too hard early; run pace cratered after 5k as legs gave out."
        }
      }),
      priorRaces: [],
      nextRace: null
    };
    const prompts = generateRaceSeededPrompts(input);
    const cross = prompts.find((p) => p.reason === "cross_discipline_insight");
    expect(cross?.prompt).toContain("run");
    expect(cross?.prompt.toLowerCase()).toContain("bike");
  });

  it("compares to a prior race when same distance type is available", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary(),
      priorRaces: [
        { bundleId: "prior-1", name: "Olympic B", date: "2026-01-15", distanceType: "olympic" },
        { bundleId: "prior-2", name: "Half Iron", date: "2025-09-15", distanceType: "half_iron" }
      ],
      nextRace: null
    };
    const prompts = generateRaceSeededPrompts(input);
    const compare = prompts.find((p) => p.reason === "prior_race_compare");
    expect(compare?.prompt).toContain("Olympic B");
    // Different-distance race must NOT be picked when a same-distance one exists.
    expect(compare?.prompt).not.toContain("Half Iron");
  });

  it("suggests next-race training change when a future race is within horizon", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary(),
      priorRaces: [],
      nextRace: { raceProfileId: "next", name: "Warsaw 70.3", date: "2026-08-01", distanceType: "half_iron", daysUntil: 60 }
    };
    const prompts = generateRaceSeededPrompts(input);
    const nextPrompt = prompts.find((p) => p.reason === "next_race_implication");
    expect(nextPrompt?.prompt).toContain("Warsaw 70.3");
  });

  it("does NOT suggest next-race prompt when the next race is beyond horizon", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary(),
      priorRaces: [],
      nextRace: { raceProfileId: "next", name: "Far Future", date: "2027-01-01", distanceType: "half_iron", daysUntil: 250 }
    };
    const prompts = generateRaceSeededPrompts(input);
    expect(prompts.find((p) => p.reason === "next_race_implication")).toBeUndefined();
  });

  it("caps output at 5 prompts and sorts by priority", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary({
        bundle: { taper_compliance_score: 0.6, issues_flagged: ["nutrition"] },
        review: {
          leg_status: { swim: { status: "faded" }, bike: { status: "faded" }, run: { status: "faded" } },
          cross_discipline_insight: "Bike fade hit the run hard."
        }
      }),
      priorRaces: [{ bundleId: "p1", name: "A", date: "2025-12-01", distanceType: "olympic" }],
      nextRace: { raceProfileId: "n1", name: "Next", date: "2026-06-01", distanceType: "olympic", daysUntil: 45 }
    };
    const prompts = generateRaceSeededPrompts(input);
    expect(prompts.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < prompts.length; i += 1) {
      expect(prompts[i - 1].priority).toBeGreaterThanOrEqual(prompts[i].priority);
    }
    // Highest-priority should be the bike fade.
    expect(prompts[0].reason).toBe("bike_fade");
  });

  it("includes fallback prompts for clean races", () => {
    const input: SeededPromptsInput = {
      summary: buildSummary({
        lessons: {
          athleteProfileTakeaways: [],
          trainingImplications: [
            { headline: "Increase tempo volume", change: "+15min/week", priority: "high", rationale: "Run faded" }
          ],
          carryForward: null,
          referencesRaceIds: [],
          supersededByRaceId: null,
          isProvisional: false,
          generatedAt: null,
          modelUsed: null
        }
      }),
      priorRaces: [],
      nextRace: null
    };
    const prompts = generateRaceSeededPrompts(input);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts.find((p) => p.reason === "fallback_overall")).toBeDefined();
  });
});
