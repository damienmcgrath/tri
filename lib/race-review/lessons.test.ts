import {
  buildDeterministicLessons,
  lessonsSanityCheck,
  recomputeSupersession
} from "./lessons";
import { raceLessonsSchema } from "./lessons-schemas";
import { getCarryForwardForUpcomingRace, type RaceWeekContext } from "@/lib/training/race-week";
import { buildRaceWeekBriefFallback } from "@/lib/ai/prompts/race-week-brief";

// ─── Supabase mock for race_lessons + race_bundles tables ────────────────────

type LessonRow = {
  id: string;
  user_id: string;
  race_bundle_id: string;
  superseded_by_race_id: string | null;
};
type BundleRow = { id: string; user_id: string; started_at: string };

function buildLessonsSupabaseMock(tables: { race_lessons: LessonRow[]; race_bundles: BundleRow[] }) {
  // Each .from() call records filters in a per-call state, then resolves on
  // the terminal awaited call. Supports the chains used by
  // recomputeSupersession + getCarryForwardForUpcomingRace.
  const tableState = {
    race_lessons: tables.race_lessons,
    race_bundles: tables.race_bundles
  };

  function makeQuery(table: keyof typeof tableState) {
    type FilterFn = (row: any) => boolean;
    const filters: FilterFn[] = [];
    let selection = "*";
    let updatePayload: Record<string, unknown> | null = null;
    let inIds: { col: string; ids: string[] } | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let maybeSingleMode = false;
    let isUpdate = false;

    const exec = () => {
      let rows: any[] = (tableState[table] as any[]).slice();
      for (const f of filters) rows = rows.filter(f);
      if (inIds) {
        rows = rows.filter((r) => inIds!.ids.includes((r as any)[inIds!.col]));
      }
      if (orderBy) {
        rows.sort((a: any, b: any) => {
          const av = a[orderBy!.col];
          const bv = b[orderBy!.col];
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (orderBy!.asc ? 1 : -1);
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);

      if (isUpdate && updatePayload) {
        for (const row of rows) Object.assign(row, updatePayload);
      }
      return rows;
    };

    const builder: any = {
      select(cols?: string) {
        if (cols) selection = cols;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        isUpdate = true;
        updatePayload = payload;
        return builder;
      },
      eq(col: string, value: unknown) {
        filters.push((row) => (row as any)[col] === value);
        return builder;
      },
      neq(col: string, value: unknown) {
        filters.push((row) => (row as any)[col] !== value);
        return builder;
      },
      lt(col: string, value: unknown) {
        filters.push((row) => (row as any)[col] < (value as any));
        return builder;
      },
      lte(col: string, value: unknown) {
        filters.push((row) => (row as any)[col] <= (value as any));
        return builder;
      },
      gte(col: string, value: unknown) {
        filters.push((row) => (row as any)[col] >= (value as any));
        return builder;
      },
      is(col: string, value: unknown) {
        filters.push((row) => (row as any)[col] === value);
        return builder;
      },
      in(col: string, ids: string[]) {
        inIds = { col, ids };
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, asc: opts?.ascending ?? true };
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      maybeSingle() {
        maybeSingleMode = true;
        const rows = exec();
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      single() {
        const rows = exec();
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve: any, reject: any) {
        // Awaiting the builder directly returns { data, error: null }.
        const rows = exec();
        // Approximate "select after update" behavior by including the updated rows.
        const data = maybeSingleMode ? rows[0] ?? null : rows;
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
    };
    // Hint TS: silence unused warning on `selection`.
    void selection;
    return builder;
  }

  return {
    from(table: string) {
      if (table !== "race_lessons" && table !== "race_bundles") {
        throw new Error(`unexpected table: ${table}`);
      }
      return makeQuery(table as keyof typeof tableState);
    }
  };
}

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

describe("recomputeSupersession", () => {
  it("supersedes older lessons by the most recent race regardless of which row was just regenerated", async () => {
    // Given two races (Jan + Feb) and a freshly regenerated Jan row whose
    // superseded_by_race_id is null. The Feb race already exists. After
    // recompute, Jan must be marked superseded by Feb (NOT current).
    const tables = {
      race_lessons: [
        { id: "lesson-jan", user_id: "u1", race_bundle_id: "bundle-jan", superseded_by_race_id: null },
        { id: "lesson-feb", user_id: "u1", race_bundle_id: "bundle-feb", superseded_by_race_id: null }
      ],
      race_bundles: [
        { id: "bundle-jan", user_id: "u1", started_at: "2026-01-15T08:00:00.000Z" },
        { id: "bundle-feb", user_id: "u1", started_at: "2026-02-15T08:00:00.000Z" }
      ]
    };
    const supabase = buildLessonsSupabaseMock(tables) as any;
    await recomputeSupersession(supabase, "u1");
    const jan = tables.race_lessons.find((r) => r.id === "lesson-jan");
    const feb = tables.race_lessons.find((r) => r.id === "lesson-feb");
    expect(jan?.superseded_by_race_id).toBe("bundle-feb");
    expect(feb?.superseded_by_race_id).toBeNull();
  });

  it("clears supersession when there is only one race left", async () => {
    const tables = {
      race_lessons: [
        { id: "lesson-only", user_id: "u1", race_bundle_id: "bundle-only", superseded_by_race_id: "bundle-other" }
      ],
      race_bundles: [{ id: "bundle-only", user_id: "u1", started_at: "2026-04-01T08:00:00.000Z" }]
    };
    const supabase = buildLessonsSupabaseMock(tables) as any;
    await recomputeSupersession(supabase, "u1");
    expect(tables.race_lessons[0].superseded_by_race_id).toBeNull();
  });

  it("does not touch rows belonging to other users", async () => {
    const tables = {
      race_lessons: [
        { id: "lesson-u1-1", user_id: "u1", race_bundle_id: "b-u1-1", superseded_by_race_id: null },
        { id: "lesson-u2-1", user_id: "u2", race_bundle_id: "b-u2-1", superseded_by_race_id: null }
      ],
      race_bundles: [
        { id: "b-u1-1", user_id: "u1", started_at: "2026-04-01T08:00:00.000Z" },
        { id: "b-u2-1", user_id: "u2", started_at: "2025-04-01T08:00:00.000Z" }
      ]
    };
    const supabase = buildLessonsSupabaseMock(tables) as any;
    await recomputeSupersession(supabase, "u1");
    expect(tables.race_lessons.find((r) => r.id === "lesson-u2-1")?.superseded_by_race_id).toBeNull();
  });
});

describe("getCarryForwardForUpcomingRace", () => {
  function setup(opts: {
    lessons: Array<{
      id: string;
      race_bundle_id: string;
      superseded_by_race_id: string | null;
      carry_forward: unknown;
    }>;
    bundles: Array<{ id: string; started_at: string; race_profile_id?: string | null }>;
  }) {
    const lessonsRows = opts.lessons.map((l) => ({ user_id: "u1", ...l }));
    const bundleRows = opts.bundles.map((b) => ({
      user_id: "u1",
      race_profile_id: null,
      ...b
    }));
    return {
      from(table: string) {
        const filters: Array<(row: any) => boolean> = [];
        let inIds: { col: string; ids: string[] } | null = null;
        let order: { col: string; asc: boolean } | null = null;
        let limitN: number | null = null;
        let maybeSingleMode = false;
        const data =
          table === "race_lessons"
            ? lessonsRows
            : table === "race_bundles"
              ? bundleRows
              : table === "race_profiles"
                ? []
                : [];
        const builder: any = {
          select() { return builder; },
          eq(col: string, value: unknown) { filters.push((r) => (r as any)[col] === value); return builder; },
          is(col: string, value: unknown) { filters.push((r) => (r as any)[col] === value); return builder; },
          lt(col: string, value: unknown) { filters.push((r) => (r as any)[col] < (value as any)); return builder; },
          in(col: string, ids: string[]) { inIds = { col, ids }; return builder; },
          order(col: string, o?: { ascending?: boolean }) { order = { col, asc: o?.ascending ?? true }; return builder; },
          limit(n: number) { limitN = n; return builder; },
          maybeSingle() { maybeSingleMode = true; return Promise.resolve({ data: exec()[0] ?? null, error: null }); },
          then(resolve: any, reject: any) {
            const rows = exec();
            const out = maybeSingleMode ? rows[0] ?? null : rows;
            return Promise.resolve({ data: out, error: null }).then(resolve, reject);
          }
        };
        function exec(): any[] {
          let rows: any[] = (data as any[]).slice();
          for (const f of filters) rows = rows.filter(f);
          if (inIds) rows = rows.filter((r) => inIds!.ids.includes((r as any)[inIds!.col]));
          if (order) {
            rows.sort((a, b) => {
              const av = (a as any)[order!.col];
              const bv = (b as any)[order!.col];
              if (av === bv) return 0;
              return (av < bv ? -1 : 1) * (order!.asc ? 1 : -1);
            });
          }
          if (limitN !== null) rows = rows.slice(0, limitN);
          return rows;
        }
        return builder;
      }
    };
  }

  const validCf = {
    headline: "Open the bike controlled",
    instruction: "Start the bike at 155W not 165W for the first 5 minutes.",
    successCriterion: "Halves move <2%",
    expiresAfterRaceId: "bundle-prior-feb"
  };

  it("returns the carry-forward only from the most recent non-superseded prior race", async () => {
    const supabase = setup({
      lessons: [
        // older: superseded by feb. Should be ignored even though it has a CF.
        {
          id: "lesson-jan",
          race_bundle_id: "bundle-jan",
          superseded_by_race_id: "bundle-feb",
          carry_forward: { ...validCf, headline: "OLD JAN ADVICE" }
        },
        // most recent: active and has a valid CF.
        {
          id: "lesson-feb",
          race_bundle_id: "bundle-feb",
          superseded_by_race_id: null,
          carry_forward: { ...validCf, headline: "FEB ADVICE" }
        }
      ],
      bundles: [
        { id: "bundle-jan", started_at: "2026-01-15T08:00:00.000Z" },
        { id: "bundle-feb", started_at: "2026-02-15T08:00:00.000Z" }
      ]
    });
    const result = await getCarryForwardForUpcomingRace(supabase as any, "u1", "2026-04-01", "upcoming-race");
    expect(result).not.toBeNull();
    expect((result as any).headline).toBe("FEB ADVICE");
  });

  it("returns null when the most recent active prior race intentionally has no carry-forward — does NOT fall through", async () => {
    const supabase = setup({
      lessons: [
        // OLDER race has stale advice, but NEWER race chose null. We must not resurrect.
        {
          id: "lesson-jan",
          race_bundle_id: "bundle-jan",
          superseded_by_race_id: "bundle-feb",
          carry_forward: { ...validCf, headline: "OLD JAN ADVICE" }
        },
        {
          id: "lesson-feb",
          race_bundle_id: "bundle-feb",
          superseded_by_race_id: null,
          carry_forward: null
        }
      ],
      bundles: [
        { id: "bundle-jan", started_at: "2026-01-15T08:00:00.000Z" },
        { id: "bundle-feb", started_at: "2026-02-15T08:00:00.000Z" }
      ]
    });
    const result = await getCarryForwardForUpcomingRace(supabase as any, "u1", "2026-04-01", "upcoming-race");
    expect(result).toBeNull();
  });

  it("returns null when there are no prior races", async () => {
    const supabase = setup({ lessons: [], bundles: [] });
    const result = await getCarryForwardForUpcomingRace(supabase as any, "u1", "2026-04-01", "upcoming-race");
    expect(result).toBeNull();
  });
});

describe("buildRaceWeekBriefFallback", () => {
  function makeCtx(overrides: Partial<RaceWeekContext> = {}): RaceWeekContext {
    return {
      proximity: "race_day",
      race: {
        id: "race-1",
        name: "Olympic A",
        date: "2026-04-26",
        type: "olympic",
        priority: "A",
        daysUntil: 0,
        swimDistanceM: 1500,
        bikeDistanceKm: 40,
        runDistanceKm: 10,
        bikeElevationM: null,
        courseType: null,
        expectedConditions: null
      },
      readiness: { tsb: 5, readinessState: "fresh", ctlTrend: "stable" },
      recentExecution: { lastWeekScore: 80, keySessionsHit: 3, keySessionsTotal: 4, feelTrend: [4, 4, 5], averageFeel: 4.3 },
      taperStatus: { inTaper: true, taperWeek: 2, volumeReductionPct: 50 },
      carryForward: null,
      ...overrides
    };
  }

  const cf = {
    headline: "Open the bike controlled",
    instruction: "Open at 155W not 165W for the first 5 minutes; let HR rise after.",
    successCriterion: "Halves move <2%",
    fromRaceName: "Olympic Prior",
    fromRaceDate: "2026-02-15"
  };

  it("surfaces carry-forward in race_guidance on race day", () => {
    const out = buildRaceWeekBriefFallback(makeCtx({ carryForward: cf, proximity: "race_day" }), null);
    expect(out.race_guidance).not.toBeNull();
    expect(out.race_guidance ?? "").toContain("155W");
    expect(out.brief_text).toContain("155W");
  });

  it("surfaces carry-forward in race_guidance the day before the race", () => {
    const out = buildRaceWeekBriefFallback(makeCtx({ carryForward: cf, proximity: "day_before", race: { ...makeCtx().race, daysUntil: 1 } }), null);
    expect(out.race_guidance).not.toBeNull();
    expect(out.race_guidance ?? "").toContain("155W");
  });

  it("falls back to confidence statement when there is no carry-forward", () => {
    const out = buildRaceWeekBriefFallback(makeCtx({ carryForward: null }), null);
    expect(out.race_guidance).not.toBeNull();
    expect(out.race_guidance ?? "").not.toContain("155W");
  });

  it("does not put carry-forward in race_guidance during pre_race_week (too early to act on it)", () => {
    const out = buildRaceWeekBriefFallback(
      makeCtx({ carryForward: cf, proximity: "pre_race_week", race: { ...makeCtx().race, daysUntil: 10 } }),
      null
    );
    // The confidence statement is the better surface 10 days out.
    expect(out.race_guidance ?? "").not.toContain("155W");
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
