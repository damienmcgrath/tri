import {
  buildRaceFacts,
  buildDeterministicRaceReview,
  generateRaceReview,
  type RaceBundleData,
  type RaceSegmentData,
  type RaceProfileForReview
} from "./race-review";

const mockCallOpenAIWithFallback = jest.fn();

jest.mock("./ai/call-with-fallback", () => ({
  callOpenAIWithFallback: (...args: unknown[]) => mockCallOpenAIWithFallback(...args)
}));

jest.mock("./openai", () => ({
  getCoachModel: () => "gpt-5-mini",
  getOpenAIClient: () => ({}),
  getCoachRequestTimeoutMs: () => 60000,
  extractJsonObject: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}));

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeBundle(overrides: Partial<RaceBundleData> = {}): RaceBundleData {
  return {
    id: "bundle-1",
    startedAt: "2026-04-26T08:03:08.000Z",
    endedAt: "2026-04-26T10:34:00.000Z",
    totalDurationSec: 9090,
    totalDistanceM: 50000,
    source: "strava_reconstructed",
    goalTimeSec: null,
    goalStrategySummary: null,
    preRaceCtl: null,
    preRaceAtl: null,
    preRaceTsb: null,
    preRaceTsbState: null,
    taperComplianceScore: null,
    taperComplianceSummary: null,
    athleteRating: null,
    athleteNotes: null,
    issuesFlagged: [],
    finishPosition: null,
    ageGroupPosition: null,
    subjectiveCapturedAt: "2026-04-26T20:00:00.000Z",
    inferredTransitions: false,
    ...overrides
  };
}

function makeSegment(role: RaceSegmentData["role"], overrides: Partial<RaceSegmentData> = {}): RaceSegmentData {
  const defaults: RaceSegmentData = {
    activityId: `act-${role}`,
    role,
    segmentIndex: ["swim", "t1", "bike", "t2", "run"].indexOf(role),
    sportType: role,
    durationSec: role === "swim" ? 1601 : role === "t1" ? 130 : role === "bike" ? 4619 : role === "t2" ? 99 : 2641,
    distanceM: role === "swim" ? 1500 : role === "bike" ? 40000 : role === "run" ? 10000 : null,
    avgHr: 150,
    avgPower: role === "bike" ? 220 : null,
    metricsV2: null
  };
  return { ...defaults, ...overrides };
}

function makeBikeMetricsV2WithHalves(firstHalf: number, lastHalf: number) {
  return {
    halves: { firstHalfAvgPower: firstHalf, lastHalfAvgPower: lastHalf }
  };
}

function makeRunMetricsV2WithLaps(lapsPaceSecPerKm: number[]) {
  return {
    laps: lapsPaceSecPerKm.map((pace, i) => ({
      index: i + 1,
      durationSec: 300,
      distanceM: 1000,
      avgPaceSecPerKm: pace
    }))
  };
}

function makeRaceProfile(overrides: Partial<RaceProfileForReview> = {}): RaceProfileForReview {
  return {
    id: "profile-1",
    name: "Joe Hannon Olympic",
    date: "2026-04-26",
    distanceType: "olympic",
    idealDisciplineDistribution: { swim: 0.15, bike: 0.55, run: 0.30 },
    ...overrides
  };
}

// ─── buildRaceFacts ─────────────────────────────────────────────────────────

describe("buildRaceFacts", () => {
  it("computes discipline distribution as fraction of total duration", () => {
    const bundle = makeBundle({ totalDurationSec: 9090 });
    const segments = [
      makeSegment("swim"),
      makeSegment("t1"),
      makeSegment("bike"),
      makeSegment("t2"),
      makeSegment("run")
    ];

    const facts = buildRaceFacts({ bundle, segments, plannedSession: null, raceProfile: null });

    expect(facts.disciplineDistributionActual.swim).toBeCloseTo(1601 / 9090, 4);
    expect(facts.disciplineDistributionActual.bike).toBeCloseTo(4619 / 9090, 4);
    expect(facts.disciplineDistributionActual.run).toBeCloseTo(2641 / 9090, 4);
    expect(facts.disciplineDistributionActual.t1).toBeCloseTo(130 / 9090, 4);
    expect(facts.disciplineDistributionActual.t2).toBeCloseTo(99 / 9090, 4);
  });

  it("computes delta vs ideal distribution, folding T1 into bike and T2 into run", () => {
    const bundle = makeBundle({ totalDurationSec: 10000 });
    const segments = [
      makeSegment("swim", { durationSec: 1500 }), // 0.15
      makeSegment("t1", { durationSec: 100 }),    // 0.01
      makeSegment("bike", { durationSec: 5000 }), // 0.50
      makeSegment("t2", { durationSec: 100 }),    // 0.01
      makeSegment("run", { durationSec: 3300 })   // 0.33
    ];

    const profile = makeRaceProfile({
      idealDisciplineDistribution: { swim: 0.15, bike: 0.55, run: 0.30 }
    });

    const facts = buildRaceFacts({ bundle, segments, plannedSession: null, raceProfile: profile });

    // bike+t1 = 0.51 → delta -0.04 vs 0.55 ideal
    expect(facts.disciplineDistributionDelta?.bike).toBeCloseTo(0.51 - 0.55, 4);
    // run+t2 = 0.34 → delta +0.04 vs 0.30 ideal
    expect(facts.disciplineDistributionDelta?.run).toBeCloseTo(0.34 - 0.30, 4);
    // swim = 0.15 → delta 0
    expect(facts.disciplineDistributionDelta?.swim).toBeCloseTo(0, 4);
  });

  it("returns null distribution delta when no race profile is supplied", () => {
    const bundle = makeBundle();
    const segments = [makeSegment("swim"), makeSegment("bike"), makeSegment("run")];

    const facts = buildRaceFacts({ bundle, segments, plannedSession: null, raceProfile: null });

    expect(facts.disciplineDistributionDelta).toBeNull();
  });

  it("uses metrics_v2.halves for bike pacing when available", () => {
    const bundle = makeBundle();
    const segments = [
      makeSegment("swim"),
      makeSegment("bike", { metricsV2: makeBikeMetricsV2WithHalves(220, 215) }),
      makeSegment("run")
    ];

    const facts = buildRaceFacts({ bundle, segments, plannedSession: null, raceProfile: null });

    expect(facts.pacing.bike?.halvesAvailable).toBe(true);
    if (facts.pacing.bike?.halvesAvailable) {
      expect(facts.pacing.bike.firstHalf).toBe(220);
      expect(facts.pacing.bike.lastHalf).toBe(215);
      expect(facts.pacing.bike.unit).toBe("watts");
      expect(facts.pacing.bike.deltaPct).toBeCloseTo(((215 - 220) / 220) * 100, 1);
    }
  });

  it("computes run halves from laps when laps data is present", () => {
    const bundle = makeBundle();
    const segments = [
      makeSegment("swim"),
      makeSegment("bike"),
      makeSegment("run", {
        durationSec: 1500,
        metricsV2: makeRunMetricsV2WithLaps([280, 280, 290, 300, 310])
      })
    ];

    const facts = buildRaceFacts({ bundle, segments, plannedSession: null, raceProfile: null });

    expect(facts.pacing.run?.halvesAvailable).toBe(true);
    if (facts.pacing.run?.halvesAvailable) {
      expect(facts.pacing.run.unit).toBe("sec_per_km");
      // Second half slower → positive delta
      expect(facts.pacing.run.deltaPct).toBeGreaterThan(0);
    }
  });

  it("marks halves unavailable when metrics_v2 is null", () => {
    const bundle = makeBundle();
    const segments = [makeSegment("swim"), makeSegment("bike"), makeSegment("run")];

    const facts = buildRaceFacts({ bundle, segments, plannedSession: null, raceProfile: null });

    expect(facts.pacing.bike?.halvesAvailable).toBe(false);
    expect(facts.pacing.run?.halvesAvailable).toBe(false);
  });

  it("captures transition durations", () => {
    const bundle = makeBundle();
    const segments = [
      makeSegment("swim"),
      makeSegment("t1", { durationSec: 130 }),
      makeSegment("bike"),
      makeSegment("t2", { durationSec: 99 }),
      makeSegment("run")
    ];

    const facts = buildRaceFacts({ bundle, segments, plannedSession: null, raceProfile: null });

    expect(facts.transitions.t1DurationSec).toBe(130);
    expect(facts.transitions.t2DurationSec).toBe(99);
  });

  it("handles 3-segment bundles (no transitions)", () => {
    const bundle = makeBundle();
    const segments = [makeSegment("swim"), makeSegment("bike"), makeSegment("run")];

    const facts = buildRaceFacts({ bundle, segments, plannedSession: null, raceProfile: null });

    expect(facts.transitions.t1DurationSec).toBeNull();
    expect(facts.transitions.t2DurationSec).toBeNull();
  });
});

// ─── buildDeterministicRaceReview ───────────────────────────────────────────

describe("buildDeterministicRaceReview", () => {
  it("produces a non-empty headline, narrative and coach take", () => {
    const facts = buildRaceFacts({
      bundle: makeBundle(),
      segments: [
        makeSegment("swim"),
        makeSegment("t1"),
        makeSegment("bike", { metricsV2: makeBikeMetricsV2WithHalves(220, 218) }),
        makeSegment("t2"),
        makeSegment("run")
      ],
      plannedSession: null,
      raceProfile: null
    });

    const review = buildDeterministicRaceReview(facts);

    expect(review.headline.length).toBeGreaterThan(0);
    expect(review.headline.length).toBeLessThanOrEqual(120);
    expect(review.narrative.length).toBeGreaterThan(0);
    expect(review.narrative.length).toBeLessThanOrEqual(900);
    expect(review.coachTake.length).toBeGreaterThan(0);
    expect(review.coachTake.length).toBeLessThanOrEqual(220);
  });

  it("emits transition notes when T1/T2 are present", () => {
    const facts = buildRaceFacts({
      bundle: makeBundle(),
      segments: [
        makeSegment("swim"),
        makeSegment("t1", { durationSec: 130 }),
        makeSegment("bike"),
        makeSegment("t2", { durationSec: 99 }),
        makeSegment("run")
      ],
      plannedSession: null,
      raceProfile: null
    });

    const review = buildDeterministicRaceReview(facts);

    expect(review.transitionNotes).not.toBeNull();
    expect(review.transitionNotes).toMatch(/T1/);
    expect(review.transitionNotes).toMatch(/T2/);
  });

  it("returns null transition notes when transitions are absent", () => {
    const facts = buildRaceFacts({
      bundle: makeBundle(),
      segments: [makeSegment("swim"), makeSegment("bike"), makeSegment("run")],
      plannedSession: null,
      raceProfile: null
    });

    const review = buildDeterministicRaceReview(facts);

    expect(review.transitionNotes).toBeNull();
  });

  it("populates pacingNotes for bike when halves data is present", () => {
    const facts = buildRaceFacts({
      bundle: makeBundle(),
      segments: [
        makeSegment("swim"),
        makeSegment("bike", { metricsV2: makeBikeMetricsV2WithHalves(220, 215) }),
        makeSegment("run")
      ],
      plannedSession: null,
      raceProfile: null
    });

    const review = buildDeterministicRaceReview(facts);

    expect(review.pacingNotes.bike).not.toBeNull();
    expect(review.pacingNotes.bike?.note).toContain("220W");
    expect(review.pacingNotes.bike?.note).toContain("215W");
  });

  it("leaves pacingNotes null for legs without halves data", () => {
    const facts = buildRaceFacts({
      bundle: makeBundle(),
      segments: [makeSegment("swim"), makeSegment("bike"), makeSegment("run")],
      plannedSession: null,
      raceProfile: null
    });

    const review = buildDeterministicRaceReview(facts);

    expect(review.pacingNotes.swim).toBeNull();
    expect(review.pacingNotes.bike).toBeNull();
    expect(review.pacingNotes.run).toBeNull();
  });
});

// ─── generateRaceReview ─────────────────────────────────────────────────────

type SupabaseStub = {
  inserts: Array<{ table: string; payload: unknown }>;
  upserts: Array<{ table: string; payload: unknown; onConflict: string | null }>;
};

function buildSupabaseStub(opts: {
  bundleRow?: Record<string, unknown> | null;
  segmentRows?: Array<Record<string, unknown>>;
  linkRows?: Array<Record<string, unknown>>;
  plannedRow?: Record<string, unknown> | null;
  profileRow?: Record<string, unknown> | null;
  upsertResult?: { data: { id: string } | null; error: { message: string } | null };
}) {
  const trace: SupabaseStub = { inserts: [], upserts: [] };
  // Explicit `null` means "no bundle"; only fill the default when the key is absent.
  const bundleRow: Record<string, unknown> | null = "bundleRow" in opts
    ? (opts.bundleRow ?? null)
    : {
        id: "bundle-1",
        user_id: "user-1",
        started_at: "2026-04-26T08:03:08.000Z",
        ended_at: "2026-04-26T10:34:00.000Z",
        total_duration_sec: 9090,
        total_distance_m: 50000,
        source: "strava_reconstructed",
        // Phase 1B: subjective gate. Tests default to inputs captured.
        subjective_captured_at: "2026-04-26T20:00:00.000Z",
        athlete_rating: 4,
        athlete_notes: null,
        issues_flagged: [],
        finish_position: null,
        age_group_position: null,
        goal_time_sec: null,
        goal_strategy_summary: null,
        pre_race_ctl: null,
        pre_race_atl: null,
        pre_race_tsb: null,
        pre_race_tsb_state: null,
        taper_compliance_score: null,
        taper_compliance_summary: null,
        inferred_transitions: false
      };
  const segmentRows = opts.segmentRows ?? [];
  const linkRows = opts.linkRows ?? [];
  const plannedRow = opts.plannedRow ?? null;
  const profileRow = opts.profileRow ?? null;
  const upsertResult = opts.upsertResult ?? { data: { id: "review-1" }, error: null };

  const supabase: any = {};
  supabase.from = (table: string) => {
    if (table === "race_bundles") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: bundleRow, error: null })
            })
          })
        })
      };
    }
    if (table === "completed_activities") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () => ({ data: segmentRows, error: null })
            })
          })
        })
      };
    }
    if (table === "session_activity_links") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: async () => ({ data: linkRows, error: null })
            })
          })
        })
      };
    }
    if (table === "sessions") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: plannedRow, error: null })
            })
          })
        })
      };
    }
    if (table === "race_profiles") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: profileRow, error: null })
                })
              })
            })
          })
        })
      };
    }
    if (table === "race_reviews") {
      return {
        upsert: (payload: unknown, options: { onConflict?: string }) => {
          trace.upserts.push({ table, payload, onConflict: options?.onConflict ?? null });
          return {
            select: () => ({
              single: async () => upsertResult
            })
          };
        }
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  };
  return { supabase, trace };
}

describe("generateRaceReview", () => {
  beforeEach(() => {
    mockCallOpenAIWithFallback.mockReset();
  });

  it("returns skipped when bundle is not found", async () => {
    const { supabase } = buildSupabaseStub({ bundleRow: null });
    const result = await generateRaceReview({ supabase: supabase as any, userId: "user-1", bundleId: "missing" });
    expect(result).toEqual({ status: "skipped", reason: "bundle_not_found" });
  });

  it("returns skipped when fewer than 3 segments are present", async () => {
    const { supabase } = buildSupabaseStub({
      segmentRows: [
        { id: "a1", race_segment_role: "swim", race_segment_index: 0, duration_sec: 1500, sport_type: "swim", distance_m: 1500, avg_hr: 145, avg_power: null, metrics_v2: null },
        { id: "a2", race_segment_role: "bike", race_segment_index: 1, duration_sec: 4500, sport_type: "bike", distance_m: 40000, avg_hr: 152, avg_power: 220, metrics_v2: null }
      ]
    });
    const result = await generateRaceReview({ supabase: supabase as any, userId: "user-1", bundleId: "bundle-1" });
    expect(result).toEqual({ status: "skipped", reason: "insufficient_segments" });
  });

  it("returns skipped when subjective inputs have not been captured yet (Phase 1B gate)", async () => {
    const { supabase } = buildSupabaseStub({
      bundleRow: {
        id: "bundle-1",
        user_id: "user-1",
        started_at: "2026-04-26T08:03:08.000Z",
        ended_at: "2026-04-26T10:34:00.000Z",
        total_duration_sec: 9090,
        total_distance_m: 50000,
        source: "strava_reconstructed",
        subjective_captured_at: null,
        athlete_rating: null,
        athlete_notes: null,
        issues_flagged: [],
        inferred_transitions: false
      },
      segmentRows: [
        { id: "a1", race_segment_role: "swim", race_segment_index: 0, duration_sec: 1500, sport_type: "swim", distance_m: 1500, avg_hr: 145, avg_power: null, metrics_v2: null },
        { id: "a2", race_segment_role: "bike", race_segment_index: 1, duration_sec: 4500, sport_type: "bike", distance_m: 40000, avg_hr: 152, avg_power: 220, metrics_v2: null },
        { id: "a3", race_segment_role: "run",  race_segment_index: 2, duration_sec: 2400, sport_type: "run",  distance_m: 10000, avg_hr: 158, avg_power: null, metrics_v2: null }
      ]
    });
    const result = await generateRaceReview({ supabase: supabase as any, userId: "user-1", bundleId: "bundle-1" });
    expect(result).toEqual({ status: "skipped", reason: "subjective_required" });
  });

  it("upserts an AI-source race review when OpenAI succeeds", async () => {
    mockCallOpenAIWithFallback.mockResolvedValue({
      value: {
        verdict: {
          headline: "Finished in 2:31:30 with bike held 220→218W across halves.",
          perDiscipline: {
            swim: { status: "on_plan", summary: "Swim came in steady." },
            bike: { status: "on_plan", summary: "Held within 1% across halves." },
            run: { status: "on_plan", summary: "Run held even." }
          },
          coachTake: {
            target: "Hold 220W ±2% across halves",
            scope: "next race-pace ride",
            successCriterion: "Halves move less than 2%",
            progression: "If steady, extend duration by 10 minutes"
          },
          emotionalFrame: null
        },
        raceStory: {
          overall: "Race came together — swim controlled, bike steady, run held shape across halves.",
          perLeg: {
            swim: null,
            bike: { narrative: "Bike held 220→218W.", keyEvidence: ["Halves moved -0.9%."] },
            run: null
          },
          transitions: "T1 2:10, T2 1:39.",
          crossDisciplineInsight: null
        }
      },
      source: "ai"
    });

    const { supabase, trace } = buildSupabaseStub({
      segmentRows: [
        { id: "a1", race_segment_role: "swim", race_segment_index: 0, duration_sec: 1601, sport_type: "swim", distance_m: 1500, avg_hr: 145, avg_power: null, metrics_v2: null },
        { id: "a2", race_segment_role: "t1",   race_segment_index: 1, duration_sec: 130,  sport_type: "strength", distance_m: 200, avg_hr: 140, avg_power: null, metrics_v2: null },
        { id: "a3", race_segment_role: "bike", race_segment_index: 2, duration_sec: 4619, sport_type: "bike",  distance_m: 40000, avg_hr: 152, avg_power: 220, metrics_v2: { halves: { firstHalfAvgPower: 220, lastHalfAvgPower: 218 } } },
        { id: "a4", race_segment_role: "t2",   race_segment_index: 3, duration_sec: 99,   sport_type: "strength", distance_m: 150, avg_hr: 142, avg_power: null, metrics_v2: null },
        { id: "a5", race_segment_role: "run",  race_segment_index: 4, duration_sec: 2641, sport_type: "run",   distance_m: 10000, avg_hr: 158, avg_power: null, metrics_v2: null }
      ],
      linkRows: [
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" }
      ],
      plannedRow: { id: "session-race", type: "Olympic (race)", session_name: "Joe Hannon Olympic", target: null },
      profileRow: {
        id: "profile-1",
        name: "Joe Hannon Olympic",
        date: "2026-04-26",
        distance_type: "olympic",
        ideal_discipline_distribution: { swim: 0.15, bike: 0.55, run: 0.30 }
      }
    });

    const result = await generateRaceReview({ supabase: supabase as any, userId: "user-1", bundleId: "bundle-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.source).toBe("ai");
    expect(result.plannedSessionId).toBe("session-race");
    expect(result.reviewId).toBe("review-1");

    expect(trace.upserts).toHaveLength(1);
    const upsert = trace.upserts[0];
    expect(upsert.table).toBe("race_reviews");
    expect(upsert.onConflict).toBe("race_bundle_id");
    expect(upsert.payload).toMatchObject({
      user_id: "user-1",
      race_bundle_id: "bundle-1",
      planned_session_id: "session-race",
      headline: expect.stringContaining("2:31:30"),
      coach_take: expect.stringContaining("220W"),
      model_used: "gpt-5-mini",
      is_provisional: false
    });
    // Phase 1B: structured layers persisted alongside legacy columns.
    expect((upsert.payload as any).verdict).toMatchObject({
      headline: expect.any(String),
      coachTake: expect.objectContaining({ target: expect.any(String) })
    });
    expect((upsert.payload as any).race_story).toMatchObject({
      overall: expect.any(String)
    });
    expect((upsert.payload as any).pacing_arc_data).toBeDefined();
    // Halves data should be merged into pacing_notes for the bike leg.
    expect((upsert.payload as any).pacing_notes.bike).toMatchObject({
      firstHalf: 220,
      lastHalf: 218,
      unit: "watts"
    });
  });

  it("marks the row provisional when the AI call falls back", async () => {
    mockCallOpenAIWithFallback.mockResolvedValue({
      value: {
        verdict: {
          headline: "Fallback headline.",
          perDiscipline: { swim: null, bike: null, run: null },
          coachTake: {
            target: "Hold even-split race pacing",
            scope: "next race-pace session",
            successCriterion: "Halves move less than 2%",
            progression: "Extend by 10 minutes"
          },
          emotionalFrame: null
        },
        raceStory: {
          overall: "Race completed.",
          perLeg: { swim: null, bike: null, run: null },
          transitions: null,
          crossDisciplineInsight: null
        }
      },
      source: "fallback"
    });

    const { supabase, trace } = buildSupabaseStub({
      segmentRows: [
        { id: "a1", race_segment_role: "swim", race_segment_index: 0, duration_sec: 1500, sport_type: "swim", distance_m: 1500, avg_hr: 145, avg_power: null, metrics_v2: null },
        { id: "a2", race_segment_role: "bike", race_segment_index: 1, duration_sec: 4500, sport_type: "bike", distance_m: 40000, avg_hr: 152, avg_power: 220, metrics_v2: null },
        { id: "a3", race_segment_role: "run",  race_segment_index: 2, duration_sec: 2400, sport_type: "run",  distance_m: 10000, avg_hr: 158, avg_power: null, metrics_v2: null }
      ],
      linkRows: [
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" }
      ],
      plannedRow: { id: "session-race", type: "Race", session_name: "Race", target: null },
      profileRow: null
    });

    const result = await generateRaceReview({ supabase: supabase as any, userId: "user-1", bundleId: "bundle-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.source).toBe("fallback");

    const upsert = trace.upserts[0];
    expect(upsert.payload).toMatchObject({
      is_provisional: true,
      model_used: "fallback"
    });
  });

  it("returns skipped when the upsert fails", async () => {
    mockCallOpenAIWithFallback.mockResolvedValue({
      value: {
        verdict: {
          headline: "h",
          perDiscipline: { swim: null, bike: null, run: null },
          coachTake: { target: "t", scope: "s", successCriterion: "x", progression: "p" },
          emotionalFrame: null
        },
        raceStory: {
          overall: "n",
          perLeg: { swim: null, bike: null, run: null },
          transitions: null,
          crossDisciplineInsight: null
        }
      },
      source: "ai"
    });

    const { supabase } = buildSupabaseStub({
      segmentRows: [
        { id: "a1", race_segment_role: "swim", race_segment_index: 0, duration_sec: 1500, sport_type: "swim", distance_m: 1500, avg_hr: 145, avg_power: null, metrics_v2: null },
        { id: "a2", race_segment_role: "bike", race_segment_index: 1, duration_sec: 4500, sport_type: "bike", distance_m: 40000, avg_hr: 152, avg_power: 220, metrics_v2: null },
        { id: "a3", race_segment_role: "run",  race_segment_index: 2, duration_sec: 2400, sport_type: "run",  distance_m: 10000, avg_hr: 158, avg_power: null, metrics_v2: null }
      ],
      linkRows: [
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" }
      ],
      upsertResult: { data: null, error: { message: "RLS denied" } }
    });

    const result = await generateRaceReview({ supabase: supabase as any, userId: "user-1", bundleId: "bundle-1" });

    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") return;
    expect(result.reason).toContain("upsert_failed");
  });

  it("forces emotionalFrame to null when the deterministic trigger did not fire", async () => {
    // AI tries to set emotionalFrame; the orchestrator must overwrite it.
    mockCallOpenAIWithFallback.mockResolvedValue({
      value: {
        verdict: {
          headline: "Strong even-split race in 2:31:30.",
          perDiscipline: { swim: null, bike: null, run: null },
          coachTake: { target: "t", scope: "s", successCriterion: "x", progression: "p" },
          emotionalFrame: "Tough day on the bike — the AI invented this when it should not have."
        },
        raceStory: {
          overall: "Solid race.",
          perLeg: { swim: null, bike: null, run: null },
          transitions: null,
          crossDisciplineInsight: null
        }
      },
      source: "ai"
    });

    const { supabase, trace } = buildSupabaseStub({
      // Default bundle has rating=4 and no issues, so trigger does NOT fire.
      segmentRows: [
        { id: "a1", race_segment_role: "swim", race_segment_index: 0, duration_sec: 1500, sport_type: "swim", distance_m: 1500, avg_hr: 145, avg_power: null, metrics_v2: null },
        { id: "a2", race_segment_role: "bike", race_segment_index: 1, duration_sec: 4500, sport_type: "bike", distance_m: 40000, avg_hr: 152, avg_power: 220, metrics_v2: null },
        { id: "a3", race_segment_role: "run",  race_segment_index: 2, duration_sec: 2400, sport_type: "run",  distance_m: 10000, avg_hr: 158, avg_power: null, metrics_v2: null }
      ],
      linkRows: [
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" }
      ],
      plannedRow: { id: "session-race", type: "Race", session_name: "Race", target: null }
    });

    const result = await generateRaceReview({ supabase: supabase as any, userId: "user-1", bundleId: "bundle-1" });
    expect(result.status).toBe("ok");

    const persisted = (trace.upserts[0].payload as any).verdict;
    expect(persisted.emotionalFrame).toBeNull();
    // emotional_frame top-level column also forced null.
    expect((trace.upserts[0].payload as any).emotional_frame).toBeNull();
  });

  it("forces crossDisciplineInsight to null when the deterministic gate did not detect a hypothesis", async () => {
    mockCallOpenAIWithFallback.mockResolvedValue({
      value: {
        verdict: {
          headline: "Even-split race in 2:31:30.",
          perDiscipline: { swim: null, bike: null, run: null },
          coachTake: { target: "t", scope: "s", successCriterion: "x", progression: "p" },
          emotionalFrame: null
        },
        raceStory: {
          overall: "Solid race.",
          perLeg: { swim: null, bike: null, run: null },
          transitions: null,
          // AI invents an insight; orchestrator must overwrite to null.
          crossDisciplineInsight: "Bike fade caused run HR drift — the AI invented this."
        }
      },
      source: "ai"
    });

    const { supabase, trace } = buildSupabaseStub({
      segmentRows: [
        { id: "a1", race_segment_role: "swim", race_segment_index: 0, duration_sec: 1500, sport_type: "swim", distance_m: 1500, avg_hr: 145, avg_power: null, metrics_v2: null },
        { id: "a2", race_segment_role: "bike", race_segment_index: 1, duration_sec: 4500, sport_type: "bike", distance_m: 40000, avg_hr: 152, avg_power: 220, metrics_v2: null },
        { id: "a3", race_segment_role: "run",  race_segment_index: 2, duration_sec: 2400, sport_type: "run",  distance_m: 10000, avg_hr: 158, avg_power: null, metrics_v2: null }
      ],
      linkRows: [
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" },
        { planned_session_id: "session-race", confirmation_status: "confirmed" }
      ]
    });

    const result = await generateRaceReview({ supabase: supabase as any, userId: "user-1", bundleId: "bundle-1" });
    expect(result.status).toBe("ok");

    const persisted = (trace.upserts[0].payload as any).race_story;
    expect(persisted.crossDisciplineInsight).toBeNull();
    expect((trace.upserts[0].payload as any).cross_discipline_insight).toBeNull();
  });

  it("persists Phase 1C segment_diagnostics with reference frames + AI narratives", async () => {
    // Layered AI call returns the full Phase 1B shape; segment narrative call
    // returns one paragraph per discipline. mockResolvedValueOnce ordering
    // mirrors the call order in generateRaceReview: layered first, then
    // segment narratives.
    mockCallOpenAIWithFallback.mockResolvedValueOnce({
      value: {
        verdict: {
          headline: "Finished in 2:31:30 with bike held 220→218W across halves.",
          perDiscipline: {
            swim: { status: "on_plan", summary: "Swim came in steady." },
            bike: { status: "on_plan", summary: "Held within 1% across halves." },
            run: { status: "on_plan", summary: "Run held even." }
          },
          coachTake: {
            target: "Hold 220W ±2% across halves",
            scope: "next race-pace ride",
            successCriterion: "Halves move less than 2%",
            progression: "If steady, extend duration by 10 minutes"
          },
          emotionalFrame: null
        },
        raceStory: {
          overall: "Race came together — swim controlled, bike steady, run held shape.",
          perLeg: {
            swim: null,
            bike: { narrative: "Bike held 220→218W.", keyEvidence: ["Halves moved -0.9%."] },
            run: null
          },
          transitions: "T1 2:10, T2 1:39.",
          crossDisciplineInsight: null
        }
      },
      source: "ai"
    });
    mockCallOpenAIWithFallback.mockResolvedValueOnce({
      value: {
        swim: "Swim came in steady at 1:40 /100m.",
        bike: "Bike held 220W average — IF 0.88, in the appropriate range.",
        run: "Run paced even at 4:30 /km."
      },
      source: "ai"
    });

    const segmentRows = [
      { id: "a1", race_segment_role: "swim", race_segment_index: 0, duration_sec: 1601, sport_type: "swim", distance_m: 1500, avg_hr: 145, avg_power: null, metrics_v2: { laps: [{ index: 0, durationSec: 800, avgPacePer100mSec: 100, avgHr: 142 }, { index: 1, durationSec: 801, avgPacePer100mSec: 100, avgHr: 148 }] } },
      { id: "a2", race_segment_role: "t1",   race_segment_index: 1, duration_sec: 130,  sport_type: "strength", distance_m: 200, avg_hr: 140, avg_power: null, metrics_v2: null },
      { id: "a3", race_segment_role: "bike", race_segment_index: 2, duration_sec: 4619, sport_type: "bike",  distance_m: 40000, avg_hr: 152, avg_power: 220, metrics_v2: { halves: { firstHalfAvgPower: 222, lastHalfAvgPower: 218 } } },
      { id: "a4", race_segment_role: "t2",   race_segment_index: 3, duration_sec: 99,   sport_type: "strength", distance_m: 150, avg_hr: 142, avg_power: null, metrics_v2: null },
      { id: "a5", race_segment_role: "run",  race_segment_index: 4, duration_sec: 2641, sport_type: "run",   distance_m: 10000, avg_hr: 158, avg_power: null, metrics_v2: { laps: [{ index: 0, durationSec: 800, avgPaceSecPerKm: 270, avgHr: 156 }, { index: 1, durationSec: 800, avgPaceSecPerKm: 272, avgHr: 159 }, { index: 2, durationSec: 1041, avgPaceSecPerKm: 274, avgHr: 161 }] } }
    ];

    // Custom supabase that handles the Phase 1C tables (athlete_ftp_history,
    // race_profiles for prior-race lookup, sessions for the comparable pool).
    const trace: SupabaseStub = { inserts: [], upserts: [] };
    const supabase: any = {};
    supabase.from = (table: string) => {
      if (table === "race_bundles") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "bundle-1",
                    user_id: "user-1",
                    started_at: "2026-04-26T08:03:08.000Z",
                    ended_at: "2026-04-26T10:34:00.000Z",
                    total_duration_sec: 9090,
                    total_distance_m: 50000,
                    source: "garmin_multisport",
                    subjective_captured_at: "2026-04-26T20:00:00.000Z",
                    athlete_rating: 4,
                    athlete_notes: null,
                    issues_flagged: [],
                    finish_position: null,
                    age_group_position: null,
                    goal_time_sec: 9000,
                    goal_strategy_summary: null,
                    pre_race_ctl: null,
                    pre_race_atl: null,
                    pre_race_tsb: null,
                    pre_race_tsb_state: null,
                    taper_compliance_score: null,
                    taper_compliance_summary: null,
                    inferred_transitions: false
                  },
                  error: null
                })
              })
            })
          })
        };
      }
      if (table === "completed_activities") {
        return {
          select: () => ({
            eq: (col: string, val: unknown) => ({
              eq: (_col: string, _val: unknown) => ({
                order: async () => ({ data: segmentRows, error: null }),
                // For prior-race leg lookup (no order chained).
                _data: segmentRows
              })
            })
          })
        };
      }
      if (table === "session_activity_links") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    { planned_session_id: "session-race", confirmation_status: "confirmed" },
                    { planned_session_id: "session-race", confirmation_status: "confirmed" },
                    { planned_session_id: "session-race", confirmation_status: "confirmed" },
                    { planned_session_id: "session-race", confirmation_status: "confirmed" },
                    { planned_session_id: "session-race", confirmation_status: "confirmed" }
                  ],
                  error: null
                })
              })
            })
          })
        };
      }
      if (table === "sessions") {
        // Two distinct chains: planned-session lookup uses
        // .eq().eq().maybeSingle(); recent-session pool uses
        // .eq().gte().lt().eq() (then awaited as the array result).
        const recentPool = [
          { id: "best-bike", date: "2026-04-12", sport: "bike", type: "tempo", session_name: "Race-pace 40km", session_role: "key", duration_minutes: 75, status: "completed" },
          { id: "long-run", date: "2026-04-08", sport: "run", type: "long", session_name: "Long endurance run", session_role: "supporting", duration_minutes: 45, status: "completed" }
        ];
        const eqAfterLt = () => Promise.resolve({ data: recentPool, error: null });
        const ltAfterGte = () => ({ eq: eqAfterLt });
        const gteAfterFirstEq = () => ({ lt: ltAfterGte });
        const eqAfterFirstEq = () => ({
          maybeSingle: async () => ({
            data: { id: "session-race", type: "Olympic (race)", session_name: "Joe Hannon Olympic", target: null },
            error: null
          })
        });
        const firstEq = () => ({
          eq: eqAfterFirstEq,
          gte: gteAfterFirstEq
        });
        return {
          select: () => ({ eq: firstEq })
        };
      }
      if (table === "race_profiles") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: "profile-1",
                        name: "Joe Hannon Olympic",
                        date: "2026-04-26",
                        distance_type: "olympic",
                        ideal_discipline_distribution: { swim: 0.15, bike: 0.55, run: 0.30 }
                      },
                      error: null
                    })
                  })
                }),
                lt: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [],
                      error: null
                    })
                  })
                })
              })
            })
          })
        };
      }
      if (table === "athlete_ftp_history") {
        return {
          select: () => ({
            eq: () => ({
              lte: () => ({
                order: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { value: 250, recorded_at: "2026-04-01" },
                        error: null
                      })
                    })
                  })
                })
              })
            })
          })
        };
      }
      if (table === "race_reviews") {
        return {
          upsert: (payload: unknown, options: { onConflict?: string }) => {
            trace.upserts.push({ table, payload, onConflict: options?.onConflict ?? null });
            return {
              select: () => ({
                single: async () => ({ data: { id: "review-1" }, error: null })
              })
            };
          }
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const result = await generateRaceReview({ supabase: supabase as any, userId: "user-1", bundleId: "bundle-1" });
    expect(result.status).toBe("ok");

    const payload = trace.upserts[0].payload as any;
    expect(payload.segment_diagnostics).not.toBeNull();
    const diags = payload.segment_diagnostics as any[];
    expect(diags.map((d) => d.discipline).sort()).toEqual(["bike", "run", "swim"]);
    const bike = diags.find((d) => d.discipline === "bike");
    expect(bike.referenceFrames.vsThreshold).not.toBeNull();
    expect(bike.referenceFrames.vsThreshold.thresholdValue).toBe(250);
    expect(bike.referenceFrames.vsThreshold.intensityFactor).toBeGreaterThan(0.8);
    expect(bike.referenceFrames.vsBestComparableTraining).not.toBeNull();
    expect(bike.aiNarrative).toMatch(/IF 0\.88/);
    expect(payload.transitions_analysis).not.toBeNull();
    expect(payload.transitions_analysis.t1.populationMedianSec).toBe(150);
  });
});
