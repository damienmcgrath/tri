const PREVIEW_USER_ID = "11111111-1111-4111-8111-111111111111";
const PREVIEW_PLAN_ID = "22222222-2222-4222-8222-222222222222";
const PREVIEW_WEEK_ONE_ID = "33333333-3333-4333-8333-333333333331";
const PREVIEW_WEEK_TWO_ID = "33333333-3333-4333-8333-333333333332";
const PREVIEW_WEEK_THREE_ID = "33333333-3333-4333-8333-333333333333";
const PREVIEW_UPLOAD_ID = "44444444-4444-4444-8444-444444444444";
const PREVIEW_ACTIVITY_ONE_ID = "55555555-5555-4555-8555-555555555551";
const PREVIEW_ACTIVITY_TWO_ID = "55555555-5555-4555-8555-555555555552";
const PREVIEW_ACTIVITY_THREE_ID = "55555555-5555-4555-8555-555555555553";
const PREVIEW_ACTIVITY_EXTRA_RUN_ID = "55555555-5555-4555-8555-555555555554";
const PREVIEW_ACTIVITY_UNREVIEWED_ID = "55555555-5555-4555-8555-555555555555";
const PREVIEW_ACTIVITY_SWIM_ID = "55555555-5555-4555-8555-555555555556";
const PREVIEW_ACTIVITY_LONG_RUN_ID = "55555555-5555-4555-8555-555555555557";
const PREVIEW_LINK_ONE_ID = "66666666-6666-4666-8666-666666666661";
const PREVIEW_LINK_TWO_ID = "66666666-6666-4666-8666-666666666662";
const PREVIEW_LINK_EXTRA_RUN_ID = "66666666-6666-4666-8666-666666666663";
const PREVIEW_LINK_SWIM_ID = "66666666-6666-4666-8666-666666666664";
const PREVIEW_LINK_LONG_RUN_ID = "66666666-6666-4666-8666-666666666665";
const PREVIEW_WEEK_FOUR_ID = "33333333-3333-4333-8333-333333333334";
const PREVIEW_WEEK_FIVE_ID = "33333333-3333-4333-8333-333333333335";

function previewMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const dist = day === 0 ? 6 : day - 1;
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dist));
  return mon.toISOString().slice(0, 10);
}

function previewDateOffset(mondayIso: string, offset: number): string {
  const d = new Date(`${mondayIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

type PreviewTableName =
  | "profiles"
  | "training_plans"
  | "training_weeks"
  | "sessions"
  | "planned_sessions"
  | "completed_sessions"
  | "completed_activities"
  | "session_activity_links"
  | "activity_uploads"
  | "athlete_context"
  | "athlete_checkins"
  | "athlete_observed_patterns"
  | "weekly_debriefs"
  | "ingestion_events"
  | "session_feels"
  | "session_verdicts"
  | "adaptation_rationales"
  | "morning_briefs"
  | "training_scores"
  | "week_transition_briefings"
  | "session_comparisons"
  | "session_intensity_profiles"
  | "weekly_intensity_summaries"
  | "session_load";

export type PreviewDatabase = Record<PreviewTableName, Array<Record<string, unknown>>>;

export function getPreviewUser() {
  return {
    id: PREVIEW_USER_ID,
    email: "preview@tri.ai",
    user_metadata: {
      full_name: "Preview Athlete",
      timezone: "Europe/Dublin",
      race_name: "Galway 70.3",
      race_date: "2026-06-21"
    }
  };
}

export function createPreviewDatabase(): PreviewDatabase {
  return {
    profiles: [
      {
        id: PREVIEW_USER_ID,
        display_name: "Preview Athlete",
        avatar_url: null,
        active_plan_id: PREVIEW_PLAN_ID,
        race_date: "2026-06-21",
        race_name: "Galway 70.3"
      }
    ],
    training_plans: [
      {
        id: PREVIEW_PLAN_ID,
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        name: "70.3 Build Block",
        start_date: "2026-03-09",
        duration_weeks: 12,
        updated_at: "2026-03-15T08:00:00.000Z"
      }
    ],
    training_weeks: [
      {
        id: PREVIEW_WEEK_ONE_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_index: 1,
        week_start_date: "2026-03-09",
        focus: "Build",
        notes: "Settle into the build and keep easy days honest.",
        target_minutes: 510,
        target_tss: 430
      },
      {
        id: PREVIEW_WEEK_TWO_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_index: 2,
        week_start_date: "2026-03-16",
        focus: "Build",
        notes: "Carry bike quality, keep long run smooth.",
        target_minutes: 560,
        target_tss: 470
      },
      {
        id: PREVIEW_WEEK_THREE_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_index: 3,
        week_start_date: "2026-03-23",
        focus: "Recovery",
        notes: "Reduce volume and absorb work.",
        target_minutes: 360,
        target_tss: 280
      },
      {
        id: PREVIEW_WEEK_FOUR_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_index: 4,
        week_start_date: "2026-03-30",
        focus: "Build",
        notes: "Ramp back up after recovery. Two key sessions anchor the week.",
        target_minutes: 540,
        target_tss: 450
      },
      {
        id: PREVIEW_WEEK_FIVE_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_index: 5,
        week_start_date: previewMonday(),
        focus: "Build",
        notes: "Continue build phase with balanced discipline work.",
        target_minutes: 520,
        target_tss: 440
      }
    ],
    sessions: [
      {
        id: "77777777-7777-4777-8777-777777777771",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_ONE_ID,
        date: "2026-03-09",
        sport: "swim",
        discipline: "swim",
        type: "CSS Intervals",
        session_name: "CSS Intervals",
        target: "12 x 100m @ CSS with 20s rest",
        duration_minutes: 50,
        intent_category: "threshold",
        session_role: "key",
        status: "completed",
        day_order: 1,
        notes: "Strong control through the final block.",
        created_at: "2026-03-08T18:00:00.000Z",
        is_key: true,
        execution_result: {
          status: "matched_intent",
          executionScore: 91,
          executionScoreBand: "On target",
          executionScoreSummary: "Pacing stayed tight and the intended threshold stimulus landed.",
          whyItMatters: "This supports swim economy without adding unnecessary fatigue.",
          recommendedNextAction: "Keep the same send-off next week and hold stroke length through the final reps."
        }
      },
      {
        id: "77777777-7777-4777-8777-777777777772",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_ONE_ID,
        date: "2026-03-10",
        sport: "bike",
        discipline: "bike",
        type: "FTP Build",
        session_name: "FTP Build",
        target: "3 x 12 min @ 92-95% FTP",
        duration_minutes: 75,
        intent_category: "threshold",
        session_role: "key",
        status: "completed",
        day_order: 1,
        notes: null,
        created_at: "2026-03-08T18:01:00.000Z",
        is_key: true,
        execution_result: {
          status: "partial_intent",
          executionScore: 74,
          executionScoreBand: "Partial match",
          executionScoreSummary: "The first two reps landed, but power faded late.",
          whyItMatters: "Late fade reduces the quality of the session's sustained-threshold signal.",
          recommendedNextAction: "NEXT threshold set: 3×12 min @ 245–255W, 6 min easy between. If average interval power holds ≥248W through all three reps, extend the final rep to 14 min.",
          componentScores: {
            intentMatch: { score: 70, weight: 0.4, detail: "HR missing — cannot verify cardiovascular load against threshold target." },
            pacingExecution: { score: 65, weight: 0.25, detail: "Power faded ~6% on the final rep; variability index 1.08." },
            completion: { score: 85, weight: 0.2, detail: "All three reps completed; total duration matched plan." },
            recoveryCompliance: { score: 80, weight: 0.15, detail: "TSS within the weekly envelope; next-day session still easy." },
            composite: 74,
            dataCompletenessPct: 0.55,
            missingCriticalData: ["Heart rate"]
          }
        }
      },
      {
        id: "77777777-7777-4777-8777-777777777773",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_ONE_ID,
        date: "2026-03-11",
        sport: "run",
        discipline: "run",
        type: "Easy Run",
        session_name: "Easy Run",
        target: "45 min easy aerobic",
        duration_minutes: 45,
        intent_category: "easy",
        session_role: "supporting",
        status: "completed",
        day_order: 1,
        notes: null,
        created_at: "2026-03-08T18:02:00.000Z",
        is_key: false,
        execution_result: {
          status: "matched_intent",
          executionScore: 88,
          executionScoreBand: "On target",
          executionScoreSummary: "A relaxed aerobic run that stayed well controlled.",
          whyItMatters: "It preserved recovery between the heavier bike and brick work.",
          recommendedNextAction: "Keep cadence light and avoid drifting into steady-state effort."
        }
      },
      {
        id: "77777777-7777-4777-8777-777777777774",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_ONE_ID,
        date: "2026-03-12",
        sport: "bike",
        discipline: "bike",
        type: "Aerobic Ride",
        session_name: "Aerobic Ride",
        target: "60 min easy spin",
        duration_minutes: 60,
        intent_category: "recovery",
        session_role: "recovery",
        status: "skipped",
        day_order: 1,
        notes: "[skipped 2026-03-12] Travel day compression.",
        created_at: "2026-03-08T18:03:00.000Z",
        is_key: false,
        execution_result: {
          status: "missed_intent",
          executionScore: 42,
          executionScoreBand: "Missed intent",
          executionScoreSummary: "The recovery spin was skipped, so the week lost an easy flush session.",
          whyItMatters: "Missing low-cost recovery work can make the weekend feel heavier than it should.",
          recommendedNextAction: "Do not cram this back in. Protect the weekend key sessions instead."
        }
      },
      {
        id: "77777777-7777-4777-8777-777777777775",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_ONE_ID,
        date: "2026-03-13",
        sport: "run",
        discipline: "run",
        type: "Brick Run",
        session_name: "Brick Run",
        target: "35 min steady off the bike",
        duration_minutes: 35,
        intent_category: "threshold",
        session_role: "key",
        status: "skipped",
        day_order: 1,
        notes: null,
        created_at: "2026-03-08T18:04:00.000Z",
        is_key: true,
        execution_result: null
      },
      {
        id: "77777777-7777-4777-8777-777777777776",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_ONE_ID,
        date: "2026-03-14",
        sport: "bike",
        discipline: "bike",
        type: "Race Prep Brick",
        session_name: "Race Prep Brick",
        target: "2h bike + 20 min run",
        duration_minutes: 140,
        intent_category: "long",
        session_role: "key",
        status: "skipped",
        day_order: 1,
        notes: "Fuel every 20 min and stay capped on climbs.",
        created_at: "2026-03-08T18:05:00.000Z",
        is_key: true,
        execution_result: null
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_ONE_ID,
        date: "2026-03-15",
        sport: "run",
        discipline: "run",
        type: "Long Run",
        session_name: "Long Run",
        target: "95 min aerobic with last 15 steady",
        duration_minutes: 95,
        intent_category: "long",
        session_role: "key",
        status: "completed",
        day_order: 1,
        notes: "Legs felt heavy from the start. HR crept up despite easy pace. Cut the last 3km.",
        created_at: "2026-03-08T18:06:00.000Z",
        is_key: true,
        execution_result: {
          status: "partial_intent",
          intentMatchStatus: "partial_intent",
          executionScore: 68,
          executionScoreBand: "Partial match",
          executionScoreSummary: "HR elevated 8bpm above easy ceiling. Significant pace drift in the final third. Session cut short by 7 minutes.",
          whyItMatters: "Elevated HR and late fade suggest incomplete recovery from midweek sessions. The aerobic stimulus was partially delivered but at higher physiological cost than intended.",
          recommendedNextAction: "Reduce Tuesday's threshold intensity to protect recovery before the next key bike session."
        }
      },
      {
        id: "77777777-7777-4777-8777-777777777778",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_TWO_ID,
        date: "2026-03-16",
        sport: "swim",
        discipline: "swim",
        type: "Pull Endurance",
        session_name: "Pull Endurance",
        target: "3 x 600 pull aerobic",
        duration_minutes: 55,
        intent_category: "easy",
        session_role: "supporting",
        status: "planned",
        day_order: 1,
        notes: null,
        created_at: "2026-03-08T18:07:00.000Z",
        is_key: false,
        execution_result: null
      },
      // ── Week 4 sessions (current week: 2026-03-30 → 2026-04-05) ──
      {
        id: "77777777-7777-4777-8777-77777777778a",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_FOUR_ID,
        date: "2026-03-30",
        sport: "swim",
        discipline: "swim",
        type: "CSS Intervals",
        session_name: "CSS Intervals",
        target: "10 x 100m @ CSS with 15s rest",
        duration_minutes: 50,
        intent_category: "threshold",
        session_role: "key",
        status: "completed",
        day_order: 1,
        notes: "Smooth turnover through the final set.",
        created_at: "2026-03-29T18:00:00.000Z",
        is_key: true,
        execution_result: {
          status: "matched_intent",
          executionScore: 89,
          executionScoreBand: "On target",
          executionScoreSummary: "CSS pace held consistently with controlled rest intervals.",
          whyItMatters: "Threshold swim work builds lactate clearance for race-day pacing.",
          recommendedNextAction: "Maintain the same send-off; consider adding 2 reps next week."
        }
      },
      {
        id: "77777777-7777-4777-8777-77777777778b",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_FOUR_ID,
        date: "2026-03-31",
        sport: "bike",
        discipline: "bike",
        type: "FTP Intervals",
        session_name: "FTP Intervals",
        target: "3 x 12 min @ 92-95% FTP",
        duration_minutes: 75,
        intent_category: "threshold",
        session_role: "key",
        status: "completed",
        day_order: 1,
        notes: null,
        created_at: "2026-03-29T18:01:00.000Z",
        is_key: true,
        execution_result: {
          status: "matched_intent",
          executionScore: 85,
          executionScoreBand: "On target",
          executionScoreSummary: "Power held steady across all three intervals. Cadence consistent at 88rpm.",
          whyItMatters: "Clean FTP work confirms threshold capacity is tracking well for race build.",
          recommendedNextAction: "NEXT sweet-spot set: 3×12 min @ 250–260W, 6 min easy between. If average interval power holds ≥255W and cadence stays 88rpm, extend the third rep to 15 min."
        }
      },
      {
        id: "77777777-7777-4777-8777-77777777778c",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_FOUR_ID,
        date: "2026-04-01",
        sport: "run",
        discipline: "run",
        type: "Easy Run",
        session_name: "Easy Run",
        target: "40 min easy aerobic",
        duration_minutes: 40,
        intent_category: "easy",
        session_role: "recovery",
        status: "completed",
        day_order: 1,
        notes: null,
        created_at: "2026-03-29T18:02:00.000Z",
        is_key: false,
        execution_result: {
          status: "matched_intent",
          executionScore: 92,
          executionScoreBand: "On target",
          executionScoreSummary: "A controlled easy run. HR stayed well below the aerobic ceiling.",
          whyItMatters: "Flush run between key sessions supports recovery.",
          recommendedNextAction: "Keep these honest — avoid steady-state drift."
        }
      },
      {
        id: "77777777-7777-4777-8777-77777777778d",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_FOUR_ID,
        date: "2026-04-02",
        sport: "strength",
        discipline: "strength",
        type: "Core & Mobility",
        session_name: "Core & Mobility",
        target: "Core stability + hip mobility circuit",
        duration_minutes: 30,
        intent_category: "recovery",
        session_role: "supporting",
        status: "planned",
        day_order: 1,
        notes: null,
        created_at: "2026-03-29T18:03:00.000Z",
        is_key: false,
        execution_result: null
      },
      {
        id: "77777777-7777-4777-8777-77777777778e",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_FOUR_ID,
        date: "2026-04-04",
        sport: "run",
        discipline: "run",
        type: "Tempo Run",
        session_name: "Tempo Run",
        target: "45 min with 3 x 8 min @ threshold",
        duration_minutes: 45,
        intent_category: "threshold",
        session_role: "key",
        status: "planned",
        day_order: 1,
        notes: "Focus on cadence and relaxed shoulders.",
        created_at: "2026-03-29T18:04:00.000Z",
        is_key: true,
        execution_result: null
      },
      {
        id: "77777777-7777-4777-8777-77777777778f",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        plan_id: PREVIEW_PLAN_ID,
        week_id: PREVIEW_WEEK_FOUR_ID,
        date: "2026-04-05",
        sport: "bike",
        discipline: "bike",
        type: "Long Ride",
        session_name: "Long Ride",
        target: "2h30 aerobic with rolling hills",
        duration_minutes: 150,
        intent_category: "long",
        session_role: "key",
        status: "planned",
        day_order: 1,
        notes: "Fuel every 20 min. Cap power on climbs.",
        created_at: "2026-03-29T18:05:00.000Z",
        is_key: true,
        execution_result: null
      },
      // ── Week 5 sessions (current week — dynamically dated) ──
      ...(() => {
        const mon = previewMonday();
        return [
          {
            id: "77777777-7777-4777-8777-777777777790",
            user_id: PREVIEW_USER_ID,
            athlete_id: PREVIEW_USER_ID,
            plan_id: PREVIEW_PLAN_ID,
            week_id: PREVIEW_WEEK_FIVE_ID,
            date: previewDateOffset(mon, 0),
            sport: "swim",
            discipline: "swim",
            type: "Endurance Swim",
            session_name: "Endurance Swim",
            target: "2000m continuous aerobic",
            duration_minutes: 45,
            intent_category: "easy",
            session_role: "supporting",
            status: "completed",
            day_order: 1,
            notes: null,
            created_at: new Date().toISOString(),
            is_key: false,
            execution_result: { status: "matched_intent", executionScore: 88, executionScoreBand: "On target", executionScoreSummary: "Solid aerobic swim.", whyItMatters: "Builds aerobic base.", recommendedNextAction: "Maintain." }
          },
          {
            id: "77777777-7777-4777-8777-777777777791",
            user_id: PREVIEW_USER_ID,
            athlete_id: PREVIEW_USER_ID,
            plan_id: PREVIEW_PLAN_ID,
            week_id: PREVIEW_WEEK_FIVE_ID,
            date: previewDateOffset(mon, 1),
            sport: "bike",
            discipline: "bike",
            type: "Sweet Spot Intervals",
            session_name: "Sweet Spot Intervals",
            target: "3 x 15 min @ 88-93% FTP",
            duration_minutes: 75,
            intent_category: "threshold",
            session_role: "key",
            status: "completed",
            day_order: 1,
            notes: null,
            created_at: new Date().toISOString(),
            is_key: true,
            execution_result: { status: "matched_intent", executionScore: 82, executionScoreBand: "On target", executionScoreSummary: "Intervals clean.", whyItMatters: "Sweet spot builds FTP.", recommendedNextAction: "Hold same targets." }
          },
          {
            id: "77777777-7777-4777-8777-777777777792",
            user_id: PREVIEW_USER_ID,
            athlete_id: PREVIEW_USER_ID,
            plan_id: PREVIEW_PLAN_ID,
            week_id: PREVIEW_WEEK_FIVE_ID,
            date: previewDateOffset(mon, 2),
            sport: "run",
            discipline: "run",
            type: "Easy Run",
            session_name: "Easy Run",
            target: "35 min easy aerobic",
            duration_minutes: 35,
            intent_category: "easy",
            session_role: "recovery",
            status: "completed",
            day_order: 1,
            notes: null,
            created_at: new Date().toISOString(),
            is_key: false,
            execution_result: { status: "matched_intent", executionScore: 90, executionScoreBand: "On target", executionScoreSummary: "Controlled easy run.", whyItMatters: "Recovery between key sessions.", recommendedNextAction: "Keep easy." }
          },
          {
            id: "77777777-7777-4777-8777-777777777793",
            user_id: PREVIEW_USER_ID,
            athlete_id: PREVIEW_USER_ID,
            plan_id: PREVIEW_PLAN_ID,
            week_id: PREVIEW_WEEK_FIVE_ID,
            date: previewDateOffset(mon, 4),
            sport: "bike",
            discipline: "bike",
            type: "Endurance Ride",
            session_name: "Endurance Ride",
            target: "90 min aerobic with cadence drills",
            duration_minutes: 90,
            intent_category: "easy",
            session_role: "supporting",
            status: "planned",
            day_order: 1,
            notes: null,
            created_at: new Date().toISOString(),
            is_key: false,
            execution_result: null
          },
          {
            id: "77777777-7777-4777-8777-777777777794",
            user_id: PREVIEW_USER_ID,
            athlete_id: PREVIEW_USER_ID,
            plan_id: PREVIEW_PLAN_ID,
            week_id: PREVIEW_WEEK_FIVE_ID,
            date: previewDateOffset(mon, 5),
            sport: "run",
            discipline: "run",
            type: "Tempo Run",
            session_name: "Tempo Run",
            target: "50 min with 3 x 10 min @ threshold",
            duration_minutes: 50,
            intent_category: "threshold",
            session_role: "key",
            status: "planned",
            day_order: 1,
            notes: null,
            created_at: new Date().toISOString(),
            is_key: true,
            execution_result: null
          }
        ];
      })()
    ],
    planned_sessions: [],
    completed_sessions: [
      { id: "88888888-8888-4888-8888-888888888881", user_id: PREVIEW_USER_ID, date: "2026-03-09", sport: "swim" },
      { id: "88888888-8888-4888-8888-888888888882", user_id: PREVIEW_USER_ID, date: "2026-03-10", sport: "bike" },
      { id: "88888888-8888-4888-8888-888888888883", user_id: PREVIEW_USER_ID, date: "2026-03-11", sport: "run" }
    ],
    completed_activities: [
      {
        id: PREVIEW_ACTIVITY_SWIM_ID,
        user_id: PREVIEW_USER_ID,
        upload_id: PREVIEW_UPLOAD_ID,
        sport_type: "swim",
        start_time_utc: "2026-03-09T06:30:00.000Z",
        end_time_utc: "2026-03-09T07:18:00.000Z",
        duration_sec: 2880,
        moving_duration_sec: 2880,
        elapsed_duration_sec: 2880,
        distance_m: 1800,
        avg_hr: 132,
        avg_power: null,
        avg_cadence: null,
        max_hr: 148,
        max_power: null,
        elevation_gain_m: null,
        elevation_loss_m: null,
        calories: 480,
        avg_pace_per_100m_sec: 92,
        avg_stroke_rate_spm: 26,
        avg_swolf: 38,
        pool_length_m: 25,
        laps_count: 12,
        activity_vendor: "garmin",
        activity_type_raw: "swimming",
        activity_subtype_raw: "pool_swimming",
        source: "upload",
        parse_summary: null,
        notes: "CSS intervals — 12 x 100m. Pacing held cleanly through the last set.",
        schedule_status: "scheduled",
        is_unplanned: false,
        is_race: false,
        created_at: "2026-03-09T07:20:00.000Z",
        updated_at: "2026-03-09T07:20:00.000Z",
        metrics_v2: {
          paceZones: [
            { zone: 1, durationSec: 300, pctOfSession: 0.10 },
            { zone: 2, durationSec: 900, pctOfSession: 0.31 },
            { zone: 3, durationSec: 1350, pctOfSession: 0.47 },
            { zone: 4, durationSec: 330, pctOfSession: 0.11 }
          ],
          laps: [
            { index: 1, durationSec: 95, distanceM: 100, avgPacePer100mSec: 95 },
            { index: 2, durationSec: 94, distanceM: 100, avgPacePer100mSec: 94 },
            { index: 3, durationSec: 92, distanceM: 100, avgPacePer100mSec: 92 },
            { index: 4, durationSec: 91, distanceM: 100, avgPacePer100mSec: 91 },
            { index: 5, durationSec: 91, distanceM: 100, avgPacePer100mSec: 91 },
            { index: 6, durationSec: 90, distanceM: 100, avgPacePer100mSec: 90 }
          ]
        }
      },
      {
        id: PREVIEW_ACTIVITY_ONE_ID,
        user_id: PREVIEW_USER_ID,
        upload_id: PREVIEW_UPLOAD_ID,
        sport_type: "bike",
        start_time_utc: "2026-03-10T06:15:00.000Z",
        end_time_utc: "2026-03-10T07:29:00.000Z",
        duration_sec: 4440,
        moving_duration_sec: 4360,
        elapsed_duration_sec: 4440,
        distance_m: 38200,
        avg_hr: 148,
        avg_power: 212,
        avg_cadence: 88,
        max_hr: 171,
        max_power: 356,
        elevation_gain_m: 420,
        elevation_loss_m: 418,
        calories: 812,
        avg_pace_per_100m_sec: null,
        avg_stroke_rate_spm: null,
        avg_swolf: null,
        pool_length_m: null,
        laps_count: 6,
        activity_vendor: "garmin",
        activity_type_raw: "cycling",
        activity_subtype_raw: "indoor_cycling",
        source: "upload",
        parse_summary: null,
        notes: "Good control through the middle rep.",
        schedule_status: "scheduled",
        is_unplanned: false,
        is_race: false,
        created_at: "2026-03-10T07:40:00.000Z",
        updated_at: "2026-03-10T07:40:00.000Z",
        metrics_v2: {
          power: {
            normalizedPower: 218,
            variabilityIndex: 1.03,
            intensityFactor: 0.88,
            totalWorkKj: 940
          },
          load: {
            trainingStressScore: 83
          },
          cadence: {
            avgCadence: 88,
            maxCadence: 106
          },
          pauses: {
            count: 1,
            totalPausedSec: 34
          },
          environment: {
            avgTemperature: 18.4
          },
          activity: {
            sportProfileName: "Indoor Bike"
          },
          laps: [
            { index: 1, durationSec: 720, distanceM: 11200, avgHr: 146, avgPower: 220, normalizedPower: 224, avgCadence: 89 },
            { index: 2, durationSec: 720, distanceM: 10950, avgHr: 151, avgPower: 217, normalizedPower: 221, avgCadence: 88 }
          ],
          powerZones: [
            { zone: 1, powerMin: null, powerMax: 150, durationSec: 620, pctOfSession: 0.14 },
            { zone: 2, powerMin: 151, powerMax: 210, durationSec: 1180, pctOfSession: 0.27 },
            { zone: 3, powerMin: 211, powerMax: 260, durationSec: 2060, pctOfSession: 0.46 }
          ],
          heartRateZones: [
            { zone: 1, heartRateMin: null, heartRateMax: 130, durationSec: 400, pctOfSession: 0.09 },
            { zone: 2, heartRateMin: 131, heartRateMax: 149, durationSec: 1800, pctOfSession: 0.41 },
            { zone: 3, heartRateMin: 150, heartRateMax: 165, durationSec: 1700, pctOfSession: 0.38 }
          ]
        }
      },
      {
        id: PREVIEW_ACTIVITY_TWO_ID,
        user_id: PREVIEW_USER_ID,
        upload_id: PREVIEW_UPLOAD_ID,
        sport_type: "run",
        start_time_utc: "2026-03-11T07:00:00.000Z",
        end_time_utc: "2026-03-11T07:44:00.000Z",
        duration_sec: 2640,
        moving_duration_sec: 2622,
        elapsed_duration_sec: 2640,
        distance_m: 8300,
        avg_hr: 139,
        avg_power: null,
        avg_cadence: 172,
        max_hr: 151,
        max_power: null,
        elevation_gain_m: 48,
        elevation_loss_m: 47,
        calories: 504,
        avg_pace_per_100m_sec: null,
        avg_stroke_rate_spm: null,
        avg_swolf: null,
        pool_length_m: null,
        laps_count: 4,
        activity_vendor: "garmin",
        activity_type_raw: "running",
        activity_subtype_raw: "easy_run",
        source: "upload",
        parse_summary: null,
        notes: null,
        schedule_status: "scheduled",
        is_unplanned: false,
        is_race: false,
        created_at: "2026-03-11T07:48:00.000Z",
        updated_at: "2026-03-11T07:48:00.000Z",
        metrics_v2: {
          cadence: {
            avgCadence: 172
          },
          elevation: {
            gainM: 48
          }
        }
      },
      {
        id: PREVIEW_ACTIVITY_THREE_ID,
        user_id: PREVIEW_USER_ID,
        upload_id: PREVIEW_UPLOAD_ID,
        sport_type: "bike",
        start_time_utc: "2026-03-13T18:20:00.000Z",
        end_time_utc: "2026-03-13T18:52:00.000Z",
        duration_sec: 1920,
        moving_duration_sec: 1902,
        elapsed_duration_sec: 1920,
        distance_m: 15100,
        avg_hr: 136,
        avg_power: 186,
        avg_cadence: 87,
        max_hr: 149,
        max_power: 298,
        elevation_gain_m: 98,
        elevation_loss_m: 97,
        calories: 328,
        avg_pace_per_100m_sec: null,
        avg_stroke_rate_spm: null,
        avg_swolf: null,
        pool_length_m: null,
        laps_count: 2,
        activity_vendor: "garmin",
        activity_type_raw: "cycling",
        activity_subtype_raw: "road",
        source: "upload",
        parse_summary: null,
        notes: "Extra spin after work.",
        schedule_status: "unscheduled",
        is_unplanned: true,
        is_race: false,
        created_at: "2026-03-13T18:55:00.000Z",
        updated_at: "2026-03-13T18:55:00.000Z",
        metrics_v2: {
          power: {
            normalizedPower: 191,
            intensityFactor: 0.74
          },
          load: {
            trainingStressScore: 32
          },
          cadence: {
            avgCadence: 87
          }
        }
      },
      {
        id: PREVIEW_ACTIVITY_EXTRA_RUN_ID,
        user_id: PREVIEW_USER_ID,
        upload_id: PREVIEW_UPLOAD_ID,
        sport_type: "run",
        start_time_utc: "2026-03-17T06:30:00.000Z",
        end_time_utc: "2026-03-17T07:05:00.000Z",
        duration_sec: 2100,
        moving_duration_sec: 2080,
        elapsed_duration_sec: 2100,
        distance_m: 6200,
        avg_hr: 142,
        avg_power: null,
        avg_cadence: 174,
        max_hr: 156,
        max_power: null,
        elevation_gain_m: 35,
        elevation_loss_m: 34,
        calories: 390,
        avg_pace_per_100m_sec: null,
        avg_stroke_rate_spm: null,
        avg_swolf: null,
        pool_length_m: null,
        laps_count: 3,
        activity_vendor: "garmin",
        activity_type_raw: "running",
        activity_subtype_raw: "easy_run",
        source: "upload",
        parse_summary: null,
        notes: "Squeezed in an extra morning jog.",
        schedule_status: "unscheduled",
        is_unplanned: true,
        is_race: false,
        created_at: "2026-03-17T07:10:00.000Z",
        updated_at: "2026-03-17T07:10:00.000Z",
        metrics_v2: {
          cadence: { avgCadence: 174 },
          elevation: { gainM: 35 }
        }
      },
      {
        id: PREVIEW_ACTIVITY_UNREVIEWED_ID,
        user_id: PREVIEW_USER_ID,
        upload_id: PREVIEW_UPLOAD_ID,
        sport_type: "strength",
        start_time_utc: "2026-03-18T12:00:00.000Z",
        end_time_utc: "2026-03-18T12:40:00.000Z",
        duration_sec: 2400,
        moving_duration_sec: 2400,
        elapsed_duration_sec: 2400,
        distance_m: null,
        avg_hr: 118,
        avg_power: null,
        avg_cadence: null,
        max_hr: 138,
        max_power: null,
        elevation_gain_m: null,
        elevation_loss_m: null,
        calories: 220,
        avg_pace_per_100m_sec: null,
        avg_stroke_rate_spm: null,
        avg_swolf: null,
        pool_length_m: null,
        laps_count: null,
        activity_vendor: "garmin",
        activity_type_raw: "strength_training",
        activity_subtype_raw: null,
        source: "upload",
        parse_summary: null,
        notes: null,
        schedule_status: "unscheduled",
        is_unplanned: false,
        is_race: false,
        created_at: "2026-03-18T12:45:00.000Z",
        updated_at: "2026-03-18T12:45:00.000Z",
        metrics_v2: null
      },
      {
        id: PREVIEW_ACTIVITY_LONG_RUN_ID,
        user_id: PREVIEW_USER_ID,
        upload_id: PREVIEW_UPLOAD_ID,
        sport_type: "run",
        start_time_utc: "2026-03-15T07:00:00.000Z",
        end_time_utc: "2026-03-15T08:38:00.000Z",
        duration_sec: 5880,
        moving_duration_sec: 5840,
        elapsed_duration_sec: 5880,
        distance_m: 21000,
        avg_hr: 144,
        avg_power: null,
        avg_cadence: 170,
        max_hr: 162,
        max_power: null,
        elevation_gain_m: 186,
        elevation_loss_m: 184,
        calories: 1260,
        avg_pace_per_100m_sec: null,
        avg_stroke_rate_spm: null,
        avg_swolf: null,
        pool_length_m: null,
        laps_count: 7,
        activity_vendor: "garmin",
        activity_type_raw: "running",
        activity_subtype_raw: "long_run",
        source: "upload",
        parse_summary: null,
        notes: "Solid. Kept it honest for 18km then let the last 3km drift to steady.",
        schedule_status: "scheduled",
        is_unplanned: false,
        is_race: false,
        created_at: "2026-03-15T08:45:00.000Z",
        updated_at: "2026-03-15T09:00:00.000Z",
        metrics_v2: {
          cadence: { avgCadence: 170, maxCadence: 184 },
          elevation: { gainM: 186 },
          heartRateZones: [
            { zone: 1, heartRateMin: null, heartRateMax: 130, durationSec: 480, pctOfSession: 0.08 },
            { zone: 2, heartRateMin: 131, heartRateMax: 149, durationSec: 3720, pctOfSession: 0.64 },
            { zone: 3, heartRateMin: 150, heartRateMax: 165, durationSec: 1560, pctOfSession: 0.27 }
          ],
          laps: [
            { index: 1, durationSec: 840, distanceM: 3000, avgHr: 138, avgPaceSecPerKm: 280 },
            { index: 2, durationSec: 840, distanceM: 3000, avgHr: 141, avgPaceSecPerKm: 280 },
            { index: 3, durationSec: 845, distanceM: 3000, avgHr: 144, avgPaceSecPerKm: 282 },
            { index: 4, durationSec: 848, distanceM: 3000, avgHr: 146, avgPaceSecPerKm: 283 },
            { index: 5, durationSec: 852, distanceM: 3000, avgHr: 148, avgPaceSecPerKm: 284 },
            { index: 6, durationSec: 848, distanceM: 3000, avgHr: 148, avgPaceSecPerKm: 283 },
            { index: 7, durationSec: 767, distanceM: 3000, avgHr: 155, avgPaceSecPerKm: 256 }
          ]
        }
      }
    ],
    session_activity_links: [
      {
        id: PREVIEW_LINK_ONE_ID,
        user_id: PREVIEW_USER_ID,
        planned_session_id: "77777777-7777-4777-8777-777777777772",
        completed_activity_id: PREVIEW_ACTIVITY_ONE_ID,
        confidence: 0.93,
        confirmation_status: "confirmed",
        matched_at: "2026-03-10T07:42:00.000Z",
        match_method: "preview"
      },
      {
        id: PREVIEW_LINK_TWO_ID,
        user_id: PREVIEW_USER_ID,
        planned_session_id: "77777777-7777-4777-8777-777777777773",
        completed_activity_id: PREVIEW_ACTIVITY_TWO_ID,
        confidence: 0.88,
        confirmation_status: "confirmed",
        matched_at: "2026-03-11T07:49:00.000Z",
        match_method: "preview"
      },
      {
        id: PREVIEW_LINK_EXTRA_RUN_ID,
        user_id: PREVIEW_USER_ID,
        planned_session_id: null,
        completed_activity_id: PREVIEW_ACTIVITY_EXTRA_RUN_ID,
        confidence: null,
        confirmation_status: "rejected",
        matched_at: "2026-03-17T07:12:00.000Z",
        match_method: "unmatched"
      },
      {
        id: PREVIEW_LINK_SWIM_ID,
        user_id: PREVIEW_USER_ID,
        planned_session_id: "77777777-7777-4777-8777-777777777771",
        completed_activity_id: PREVIEW_ACTIVITY_SWIM_ID,
        confidence: 0.97,
        confirmation_status: "confirmed",
        matched_at: "2026-03-09T07:22:00.000Z",
        match_method: "preview"
      },
      {
        id: PREVIEW_LINK_LONG_RUN_ID,
        user_id: PREVIEW_USER_ID,
        planned_session_id: "77777777-7777-4777-8777-777777777777",
        completed_activity_id: PREVIEW_ACTIVITY_LONG_RUN_ID,
        confidence: 0.94,
        confirmation_status: "confirmed",
        matched_at: "2026-03-15T09:02:00.000Z",
        match_method: "preview"
      }
    ],
    activity_uploads: [
      {
        id: PREVIEW_UPLOAD_ID,
        user_id: PREVIEW_USER_ID,
        filename: "garmin-week-1.fit",
        file_type: "fit",
        created_at: "2026-03-13T19:00:00.000Z",
        status: "matched",
        error_message: null
      }
    ],
    athlete_context: [
      {
        athlete_id: PREVIEW_USER_ID,
        experience_level: "intermediate",
        goal_type: "perform",
        priority_event_name: "Galway 70.3",
        priority_event_date: "2026-06-21",
        limiters: ["Late-run durability"],
        strongest_disciplines: ["Bike"],
        weakest_disciplines: ["Swim"],
        weekly_constraints: ["Tuesday and Thursday need <90 minute sessions"],
        injury_notes: "Monitor calf tightness after long runs.",
        coaching_preference: "balanced",
        updated_at: "2026-03-14T18:00:00.000Z"
      }
    ],
    athlete_checkins: [
      {
        athlete_id: PREVIEW_USER_ID,
        week_start: "2026-03-09",
        fatigue: 3,
        sleep_quality: 4,
        soreness: 2,
        stress: 3,
        confidence: 4,
        note: "Travel made Thursday messy, but overall I feel good.",
        updated_at: "2026-03-14T20:00:00.000Z"
      }
    ],
    athlete_observed_patterns: [
      {
        athlete_id: PREVIEW_USER_ID,
        pattern_key: "late_threshold_fade",
        label: "Threshold fade late in sessions",
        detail: "Bike threshold quality drops in the last third when the opening rep is too ambitious.",
        confidence: "medium",
        source_session_ids: ["77777777-7777-4777-8777-777777777772"],
        support_count: 2
      },
      {
        athlete_id: PREVIEW_USER_ID,
        pattern_key: "easy_runs_controlled",
        label: "Easy run control is strong",
        detail: "Easy runs are consistently staying aerobic and protecting recovery.",
        confidence: "high",
        source_session_ids: ["77777777-7777-4777-8777-777777777773"],
        support_count: 3
      }
    ],
    weekly_debriefs: [
      {
        athlete_id: PREVIEW_USER_ID,
        week_start: "2026-03-09",
        week_end: "2026-03-15",
        status: "ready",
        source_updated_at: "2026-03-15T09:00:00.000Z",
        generated_at: "2026-03-15T10:00:00.000Z",
        generation_version: 6,
        helpful: null,
        accurate: null,
        feedback_note: null,
        feedback_updated_at: null,
        narrative: {
          executiveSummary: "A disrupted build week where the bookends held. The CSS swim and long run both delivered what was needed — mid-week brick work fell through but did not undo the quality work either side of it. Bike power showed the familiar late-rep fade pattern again, worth watching as load increases.",
          highlights: [
            "CSS intervals executed cleanly — pace control held through all 12 reps with no fade in the final set.",
            "Long run on Sunday landed well: 21km aerobic with the last 3km drifting to steady as planned.",
            "FTP Build bike: first two reps matched target power — the quality stimulus arrived even without the third."
          ],
          observations: [
            "Brick run and race prep brick lost to mid-week schedule compression — cumulative bike-run transition work is now behind for the block.",
            "Bike power fades in the final rep of threshold work; this is the second consecutive week with this pattern."
          ],
          carryForward: [
            "Protect the brick slot next week — even a shortened 20-minute transition run off the bike will rebuild the missing stimulus without requiring a full make-up session.",
            "In the next FTP Build, start 5 watts lower to hold form through all three reps rather than letting the last one fade."
          ]
        },
        coach_share: {
          headline: "Bookend quality held despite mid-week disruption",
          summary: "CSS swim and long run both delivered. Brick stack lost mid-week but core quality arrived either side of the gap.",
          wins: [
            "CSS swim held pace through all 12 reps",
            "Long run 21km steady and on target",
            "FTP bike quality in first two reps"
          ],
          concerns: [
            "Brick stack missed — bike-run transitions behind for the block",
            "Bike threshold fade becoming a recurring pattern"
          ],
          carryForward: [
            "Protect the brick slot next week — even a shortened 20-minute transition run off the bike will rebuild the missing stimulus.",
            "Start FTP Build 5 watts lower to hold form through all three reps rather than fading the last one."
          ]
        },
        facts: {
          weekLabel: "Week of Mar 9",
          weekRange: "Mar 9 – Mar 15",
          title: "Key sessions held, mid-week brick stack lost",
          statusLine: "CSS swim and long run delivered — brick work fell through. Net effect: run and swim quality intact, transition work behind.",
          primaryTakeawayTitle: "Quality at the bookends, gap in the middle",
          primaryTakeawayDetail: "The two highest-value sessions landed cleanly. The lost brick stack is the main thing to carry forward — one week behind on bike-run transitions is recoverable if protected next week.",
          plannedSessions: 7,
          completedPlannedSessions: 4,
          completedSessions: 5,
          addedSessions: 1,
          skippedSessions: 3,
          remainingSessions: 0,
          keySessionsCompleted: 3,
          keySessionsMissed: 2,
          keySessionsTotal: 5,
          plannedMinutes: 500,
          completedPlannedMinutes: 265,
          completedMinutes: 297,
          skippedMinutes: 235,
          extraMinutes: 32,
          completionPct: 59,
          dominantSport: "run",
          keySessionStatus: "3 of 5 key sessions completed",
          weekShape: "disrupted",
          reflectionsSparse: false,
          narrativeSource: "ai",
          artifactStateLabel: "final",
          artifactStateNote: null,
          provisionalReviewCount: 0,
          confidenceNote: null,
          metrics: [
            { label: "Sessions completed", value: "5 / 7", detail: "3 key sessions on target", tone: "neutral" },
            { label: "Key sessions", value: "3 / 5", detail: "Brick stack lost mid-week", tone: "caution" },
            { label: "Training time", value: "4h 57m", detail: "vs 8h 20m planned", tone: "muted" }
          ],
          factualBullets: [
            "CSS swim: 12 x 100m executed with strong pace control — no fade through the final set.",
            "FTP Build bike: first two reps on target, third rep faded in the final minutes.",
            "Long run: 21km with last 3km drifting to steady — matched intent cleanly.",
            "Race Prep Brick and Brick Run skipped due to mid-week schedule compression."
          ],
          evidenceGroups: [
            {
              claim: "CSS swim and long run delivered the week's quality",
              detail: "Both bookend sessions matched intent — swim pace held through the final reps, long run stayed aerobic with a controlled finish.",
              supports: [
                {
                  id: "77777777-7777-4777-8777-777777777771",
                  label: "CSS Intervals — Sun Mar 9",
                  href: "/sessions/77777777-7777-4777-8777-777777777771",
                  kind: "session",
                  reason: "Execution score 91 — pace control held cleanly through all 12 reps."
                },
                {
                  id: "77777777-7777-4777-8777-777777777777",
                  label: "Long Run — Sun Mar 15",
                  href: "/sessions/77777777-7777-4777-8777-777777777777",
                  kind: "session",
                  reason: "21km aerobic with last 3km steady as planned — execution score 86."
                }
              ]
            },
            {
              claim: "Bike threshold quality shows a recurring late-rep fade",
              detail: "FTP Build had the same fade pattern as last week — first two reps on target, third fades.",
              supports: [
                {
                  id: "77777777-7777-4777-8777-777777777772",
                  label: "FTP Build — Mon Mar 10",
                  href: "/sessions/77777777-7777-4777-8777-777777777772",
                  kind: "session",
                  reason: "Execution score 74 — power held for 2 of 3 reps, third faded in the final minutes."
                }
              ]
            }
          ]
        }
      }
      ,{
        athlete_id: PREVIEW_USER_ID,
        week_start: "2026-03-16",
        week_end: "2026-03-22",
        status: "ready",
        source_updated_at: "2026-03-22T09:00:00.000Z",
        generated_at: "2026-03-22T10:00:00.000Z",
        generation_version: 6,
        helpful: null,
        accurate: null,
        feedback_note: null,
        feedback_updated_at: null,
        narrative: {
          executiveSummary: "A shortened week with one solid swim session and a useful extra run. The strength upload still needs assigning — once placed, the week reads as a light but intentional recovery-style block. Not enough volume to call it a proper build week, but the sessions that landed were clean.",
          highlights: [
            "Pull Endurance swim: 55 minutes of steady work with good stroke consistency throughout.",
            "Extra run added useful aerobic volume without disrupting recovery.",
            "Strength session logged — once assigned it will round out the week's cross-training picture."
          ],
          observations: [
            "Only 2 of 3 planned sessions completed — the unassigned strength upload may close that gap once reviewed.",
            "Low overall volume for a build phase — worth watching if this becomes a pattern."
          ],
          carryForward: [
            "Assign the strength upload so the week's picture is complete before moving on.",
            "Next week should aim for full session count to keep the build block on track."
          ]
        },
        coach_share: {
          headline: "Light week — swim held, strength pending review",
          summary: "Pull Endurance swim was solid. Strength upload needs assigning. Extra run added useful volume.",
          wins: [
            "Pull Endurance swim: 55 min steady",
            "Extra run added aerobic volume"
          ],
          concerns: [
            "Only 2 of 3 planned sessions done",
            "Low volume for a build week"
          ],
          carryForward: [
            "Assign the pending strength upload.",
            "Aim for full session count next week."
          ]
        },
        facts: {
          weekLabel: "Week of Mar 16",
          weekRange: "Mar 16 – Mar 22",
          title: "Light week with clean swim, strength pending",
          statusLine: "Pull Endurance swim landed well. Extra run added volume. Strength upload still needs review.",
          primaryTakeawayTitle: "Swim quality held in a light week",
          primaryTakeawayDetail: "The swim session was the anchor — clean and on target. The missing volume is the main thing to address next week.",
          plannedSessions: 3,
          completedPlannedSessions: 1,
          completedSessions: 2,
          addedSessions: 1,
          skippedSessions: 0,
          remainingSessions: 2,
          keySessionsCompleted: 1,
          keySessionsMissed: 0,
          keySessionsTotal: 1,
          plannedMinutes: 170,
          completedPlannedMinutes: 55,
          completedMinutes: 90,
          skippedMinutes: 0,
          extraMinutes: 35,
          completionPct: 53,
          dominantSport: "swim",
          keySessionStatus: "1 of 1 key sessions completed",
          weekShape: "partial_reflection",
          reflectionsSparse: false,
          narrativeSource: "ai",
          artifactStateLabel: "final",
          artifactStateNote: null,
          provisionalReviewCount: 0,
          confidenceNote: null,
          metrics: [
            { label: "Sessions completed", value: "2 / 3", detail: "1 extra run added", tone: "neutral" },
            { label: "Key sessions", value: "1 / 1", detail: "Pull Endurance swim on target", tone: "positive" },
            { label: "Training time", value: "1h 30m", detail: "vs 2h 50m planned", tone: "muted" }
          ],
          factualBullets: [
            "Pull Endurance swim: 55 minutes of steady-state work with consistent stroke rate.",
            "Extra run: 35 minutes easy aerobic — added useful volume without disrupting recovery.",
            "Strength upload (40 min) logged but not yet assigned to a planned session."
          ],
          evidenceGroups: [
            {
              claim: "Swim session anchored the week",
              detail: "Pull Endurance was the only planned session completed — it landed cleanly and gave the week its quality signal.",
              supports: [
                {
                  id: "77777777-7777-4777-8777-777777777781",
                  label: "Pull Endurance — Mon Mar 16",
                  href: "/sessions/77777777-7777-4777-8777-777777777781",
                  kind: "session",
                  reason: "55 minutes steady with good stroke consistency."
                }
              ]
            },
            {
              claim: "Extra run kept volume from being too light",
              detail: "The unplanned run added 35 minutes of aerobic work that rounded out an otherwise sparse week.",
              supports: [
                {
                  id: PREVIEW_ACTIVITY_EXTRA_RUN_ID,
                  label: "Extra Run — Tue Mar 17",
                  href: `/sessions/activity/${PREVIEW_ACTIVITY_EXTRA_RUN_ID}`,
                  kind: "activity",
                  reason: "35 minutes easy — added volume without replacing planned work."
                }
              ]
            }
          ]
        }
      }
    ],
    ingestion_events: [],
    session_feels: [
      {
        id: "88888888-8888-4888-8888-888888888881",
        user_id: PREVIEW_USER_ID,
        session_id: "77777777-7777-4777-8777-777777777772",
        rpe: null,
        overall_feel: 4,
        energy_level: "normal",
        legs_feel: "normal",
        motivation: "fired_up",
        sleep_quality: "great",
        life_stress: "normal",
        note: "Felt strong on the bike. Power numbers were solid throughout.",
        was_prompted: true,
        prompt_shown_at: "2026-03-10T08:00:00.000Z",
        completed_at: "2026-03-10T08:00:12.000Z",
        completion_time_ms: 12000,
        dismissed: false,
        created_at: "2026-03-10T08:00:12.000Z"
      },
      {
        id: "88888888-8888-4888-8888-888888888882",
        user_id: PREVIEW_USER_ID,
        session_id: "77777777-7777-4777-8777-777777777777",
        rpe: null,
        overall_feel: 2,
        energy_level: "low",
        legs_feel: "heavy",
        motivation: "struggled",
        sleep_quality: "poor",
        life_stress: "high",
        note: "Legs felt dead from the start. Had to cut the last 3km short.",
        was_prompted: true,
        prompt_shown_at: "2026-03-15T10:00:00.000Z",
        completed_at: "2026-03-15T10:00:08.000Z",
        completion_time_ms: 8000,
        dismissed: false,
        created_at: "2026-03-15T10:00:08.000Z"
      }
    ],
    session_verdicts: [
      {
        id: "99999999-9999-4999-8999-999999999991",
        user_id: PREVIEW_USER_ID,
        session_id: "77777777-7777-4777-8777-777777777772",
        activity_id: PREVIEW_ACTIVITY_ONE_ID,
        purpose_statement: "FTP Build: 3 x 12 min @ 92-95% FTP — targeting sustained power at threshold to develop lactate clearance and muscular endurance for the bike leg.",
        training_block_context: "Week 1 of 3-week build block",
        intended_zones: { power: { min: 230, max: 245 } },
        intended_metrics: { duration_minutes: 75, intervals: 3 },
        execution_summary: "Power held steady at 237W average across all three intervals (target: 230-245W). Heart rate response was proportional, averaging 158bpm with no late drift. Cadence was consistent at 88rpm. The session delivered its intended FTP stimulus cleanly.",
        verdict_status: "achieved",
        metric_comparisons: [
          { metric: "Avg Power", target: "230-245W", actual: "237W", assessment: "on_target" },
          { metric: "Avg HR", target: "155-165 bpm", actual: "158 bpm", assessment: "on_target" },
          { metric: "Duration", target: "75m", actual: "73m (97%)", assessment: "on_target" },
          { metric: "Cadence", target: "85-95 rpm", actual: "88 rpm", assessment: "on_target" }
        ],
        key_deviations: null,
        adaptation_signal: "This confirms your FTP capacity is tracking well. Thursday's tempo ride will proceed as planned at the same intensity targets.",
        adaptation_type: "proceed",
        affected_session_ids: null,
        discipline: "bike",
        feel_data: { overall_feel: 4, energy_level: "normal", motivation: "fired_up" },
        raw_ai_response: null,
        ai_model_used: "preview",
        ai_prompt_version: "v1",
        created_at: "2026-03-10T08:05:00.000Z",
        updated_at: "2026-03-10T08:05:00.000Z"
      },
      {
        id: "99999999-9999-4999-8999-999999999992",
        user_id: PREVIEW_USER_ID,
        session_id: "77777777-7777-4777-8777-777777777777",
        activity_id: PREVIEW_ACTIVITY_LONG_RUN_ID,
        purpose_statement: "Sunday Long Run: 95 min easy with last 20 min at steady — building aerobic durability and progressive fatigue resistance for the run leg.",
        training_block_context: "Week 2 of 3-week build block",
        intended_zones: { hr: { min: 130, max: 148 } },
        intended_metrics: { duration_minutes: 95 },
        execution_summary: "HR averaged 8bpm above expected for the easy portion (146 vs target 130-140), suggesting incomplete recovery from midweek sessions. Pace drift was significant: +12 sec/km over the final 5km. The session partially delivered its aerobic stimulus but at a higher physiological cost than intended.",
        verdict_status: "partial",
        metric_comparisons: [
          { metric: "Avg HR", target: "130-140 bpm", actual: "146 bpm", assessment: "above" },
          { metric: "Duration", target: "95m", actual: "88m (93%)", assessment: "below" },
          { metric: "Pace Drift", target: "< 5 sec/km", actual: "+12 sec/km", assessment: "above" }
        ],
        key_deviations: [
          { metric: "Heart Rate", description: "HR averaged 8bpm above the easy ceiling, indicating higher-than-expected cardiovascular cost.", severity: "moderate" },
          { metric: "Late Fade", description: "Significant pace drift in the final third suggests residual fatigue from the week.", severity: "significant" }
        ],
        adaptation_signal: "Your HR was elevated and pace faded late, suggesting incomplete recovery. I've flagged Tuesday's threshold session for potential intensity reduction to protect the rest of this build block.",
        adaptation_type: "modify",
        affected_session_ids: ["77777777-7777-4777-8777-777777777774"],
        discipline: "run",
        feel_data: { overall_feel: 2, energy_level: "low", legs_feel: "heavy" },
        raw_ai_response: null,
        ai_model_used: "preview",
        ai_prompt_version: "v1",
        created_at: "2026-03-15T10:05:00.000Z",
        updated_at: "2026-03-15T10:05:00.000Z"
      }
    ],
    adaptation_rationales: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        user_id: PREVIEW_USER_ID,
        trigger_type: "recovery_signal",
        trigger_data: {
          sourceSessionId: "77777777-7777-4777-8777-777777777777",
          sourceSessionName: "Sunday Long Run",
          verdictStatus: "partial",
          verdictSummary: "HR elevated 8bpm above expected, significant pace drift in final third."
        },
        rationale_text: "I'm reducing Tuesday's threshold intensity from Z4 to high Z3 because your long run showed elevated HR and late-stage fade — signs of incomplete recovery. This protects the quality of Thursday's key bike session, which is the priority for this build week.",
        changes_summary: [
          { session_id: "77777777-7777-4777-8777-777777777774", session_label: "Tuesday Threshold Run", change_type: "intensity_reduced", before: "5 x 6 min @ threshold (Z4)", after: "5 x 6 min @ high tempo (Z3)" }
        ],
        preserved_elements: ["Thursday's FTP intervals unchanged — this is the week's key session", "Weekend long ride volume preserved"],
        week_number: 2,
        training_block: "Build",
        affected_sessions: ["77777777-7777-4777-8777-777777777774"],
        source_verdict_id: "99999999-9999-4999-8999-999999999992",
        status: "pending",
        athlete_response: null,
        created_at: "2026-03-15T10:06:00.000Z",
        acknowledged_at: null
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
        user_id: PREVIEW_USER_ID,
        trigger_type: "load_rebalance",
        trigger_data: {
          sourceSessionId: "77777777-7777-4777-8777-777777777775",
          sourceSessionName: "Wednesday Swim",
          verdictStatus: "achieved",
          verdictSummary: "Session executed well but weekly swim volume trending low."
        },
        rationale_text: "I've added 10 minutes to Saturday's swim to rebalance weekly volume. Your Wednesday swim was solid but total swim minutes are 20% below target for this build block. The extra time is easy aerobic pull sets — no intensity change.",
        changes_summary: [
          { session_id: "77777777-7777-4777-8777-777777777776", session_label: "Saturday Endurance Swim", change_type: "duration_increased", before: "45 min", after: "55 min" }
        ],
        preserved_elements: ["Saturday's main set unchanged", "Sunday long ride unaffected"],
        week_number: 2,
        training_block: "Build",
        affected_sessions: ["77777777-7777-4777-8777-777777777776"],
        source_verdict_id: "99999999-9999-4999-8999-999999999993",
        status: "pending",
        athlete_response: null,
        created_at: "2026-03-15T09:30:00.000Z",
        acknowledged_at: null
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac",
        user_id: PREVIEW_USER_ID,
        trigger_type: "feel_based",
        trigger_data: {
          sourceSessionId: "77777777-7777-4777-8777-777777777773",
          sourceSessionName: "Thursday Bike Intervals",
          verdictStatus: "partial",
          verdictSummary: "RPE reported as 9/10 when target was 7/10."
        },
        rationale_text: "Thursday's bike intervals felt harder than planned (RPE 9 vs target 7). I'm swapping Friday's tempo run for an easy recovery jog to give your legs a chance to absorb the bike load before the weekend.",
        changes_summary: [
          { session_id: "77777777-7777-4777-8777-777777777778", session_label: "Friday Tempo Run", change_type: "intensity_reduced", before: "40 min with 20 min @ tempo", after: "30 min easy recovery jog" }
        ],
        preserved_elements: ["Saturday's long ride preserved — key weekend session"],
        week_number: 2,
        training_block: "Build",
        affected_sessions: ["77777777-7777-4777-8777-777777777778"],
        source_verdict_id: "99999999-9999-4999-8999-999999999994",
        status: "pending",
        athlete_response: null,
        created_at: "2026-03-15T08:15:00.000Z",
        acknowledged_at: null
      }
    ],
    morning_briefs: [
      {
        id: "bb000001-0000-4000-8000-000000000001",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        brief_date: "2026-04-04",
        session_preview: "Tempo Run — 45 min with 3 x 8 min at threshold. Key session. Focus on cadence and relaxed shoulders through the final rep.",
        readiness_context: "You completed Tuesday's FTP intervals cleanly (85/100) and Wednesday's easy run stayed controlled. Legs should be fresh enough for quality threshold work today.",
        week_context: "3 of 6 sessions done this week. On track for 5h 30m total volume. Two key sessions remaining (today's tempo run and Sunday's long ride).",
        pending_actions: ["Review Tuesday's adaptation rationale"],
        brief_text: "Good morning. You're midway through Build Week 4 and the quality sessions are landing well. Today's tempo run is the week's second key session — the threshold reps should feel controlled after two days of lighter work. Keep cadence above 170 and stay relaxed through the shoulders in the final rep block. Sunday's long ride closes the week.",
        input_data: null,
        viewed_at: null,
        created_at: "2026-04-04T06:00:00.000Z",
        ai_model_used: "preview",
        ai_prompt_version: "v1"
      }
    ],
    training_scores: [
      {
        id: "cc000001-0000-4000-8000-000000000001",
        user_id: PREVIEW_USER_ID,
        score_date: "2026-04-04",
        composite_score: 72,
        execution_quality: 78,
        execution_inputs: { verdictCount: 4, keyVerdictCount: 2 },
        progression_signal: 65,
        progression_inputs: { comparisonCount: 3, improvingCount: 2 },
        progression_active: true,
        balance_score: 70,
        balance_inputs: {
          actualDistribution: { swim: 0.18, bike: 0.42, run: 0.30, strength: 0.10 },
          idealDistribution: { swim: 0.20, bike: 0.40, run: 0.30, strength: 0.10 }
        },
        goal_race_type: "half_ironman",
        training_block: "Build",
        score_delta_7d: 4,
        score_delta_28d: 8,
        created_at: "2026-04-04T06:00:00.000Z"
      }
    ],
    week_transition_briefings: [
      {
        id: "dd000001-0000-4000-8000-000000000001",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        current_week_start: "2026-03-30",
        last_week_takeaway: "Recovery week absorbed well — fatigue markers dropped and the light sessions felt controlled. You're coming into this build week with solid freshness.",
        this_week_focus: "Build Week 4 ramps back up with two key sessions: Tuesday's FTP intervals and Saturday's tempo run. The priority is executing the bike intervals cleanly after the recovery week reset.",
        adaptation_context: "No adaptations carried forward from last week. The pending rationale from the long run fade has been addressed by the recovery block.",
        pending_rationale_ids: [],
        coaching_prompt: "Focus on nailing Tuesday's FTP intervals — you should feel fresh coming off recovery. If legs are heavy by Thursday, we can lighten the tempo run to protect Sunday's long ride.",
        viewed_at: null,
        dismissed_at: null,
        created_at: "2026-03-30T06:00:00.000Z",
        ai_model_used: "preview",
        ai_prompt_version: "v1"
      }
    ],
    session_comparisons: [
      {
        id: "ee000001-0000-4000-8000-000000000001",
        user_id: PREVIEW_USER_ID,
        current_session_id: "77777777-7777-4777-8777-77777777778b",
        comparison_session_id: "77777777-7777-4777-8777-777777777772",
        match_score: 0.92,
        match_factors: { discipline: 1.0, type: 1.0, duration: 0.95, intent: 1.0 },
        comparison_summary: "Your FTP intervals show clear improvement compared to 3 weeks ago. Power held steady across all three reps this time (vs late fade previously), and heart rate response was more proportionate. The threshold stimulus landed cleanly — a meaningful step forward in sustained power capacity.",
        metric_deltas: [
          { metric: "Avg Power", currentValue: "237W", previousValue: "228W", direction: "up", magnitude: "moderate" },
          { metric: "Execution Score", currentValue: "85", previousValue: "74", direction: "up", magnitude: "significant" },
          { metric: "Cadence", currentValue: "88 rpm", previousValue: "85 rpm", direction: "up", magnitude: "minor" }
        ],
        trend_direction: "improving",
        trend_confidence: "moderate",
        weeks_apart: 3,
        discipline: "bike",
        session_type: "FTP Build",
        comparison_range: "recent",
        created_at: "2026-03-31T10:00:00.000Z"
      },
      {
        id: "ee000002-0000-4000-8000-000000000002",
        user_id: PREVIEW_USER_ID,
        current_session_id: "77777777-7777-4777-8777-77777777778a",
        comparison_session_id: "77777777-7777-4777-8777-777777777771",
        match_score: 0.88,
        match_factors: { discipline: 1.0, type: 1.0, duration: 0.90, intent: 1.0 },
        comparison_summary: "CSS intervals remain stable. Pacing control improved slightly in the second half, suggesting better fatigue management. Stroke rate consistency is a strength.",
        metric_deltas: [
          { metric: "Avg Pace", currentValue: "1:32/100m", previousValue: "1:33/100m", direction: "up", magnitude: "minor" },
          { metric: "Execution Score", currentValue: "89", previousValue: "91", direction: "down", magnitude: "minor" }
        ],
        trend_direction: "stable",
        trend_confidence: "moderate",
        weeks_apart: 3,
        discipline: "swim",
        session_type: "CSS Intervals",
        comparison_range: "recent",
        created_at: "2026-03-30T10:00:00.000Z"
      }
    ],
    session_intensity_profiles: [],
    weekly_intensity_summaries: [],
    session_load: (() => {
      const mon = previewMonday();
      return [
        {
          id: "ff000001-0000-4000-8000-000000000001",
          user_id: PREVIEW_USER_ID,
          activity_id: PREVIEW_ACTIVITY_SWIM_ID,
          session_id: "77777777-7777-4777-8777-777777777790",
          sport: "swim",
          date: previewDateOffset(mon, 0),
          tss: 48,
          tss_source: "hr",
          duration_sec: 2700,
          intensity_factor: null
        },
        {
          id: "ff000002-0000-4000-8000-000000000002",
          user_id: PREVIEW_USER_ID,
          activity_id: PREVIEW_ACTIVITY_ONE_ID,
          session_id: "77777777-7777-4777-8777-777777777791",
          sport: "bike",
          date: previewDateOffset(mon, 1),
          tss: 82,
          tss_source: "power",
          duration_sec: 4500,
          intensity_factor: 0.88
        },
        {
          id: "ff000003-0000-4000-8000-000000000003",
          user_id: PREVIEW_USER_ID,
          activity_id: PREVIEW_ACTIVITY_TWO_ID,
          session_id: "77777777-7777-4777-8777-777777777792",
          sport: "run",
          date: previewDateOffset(mon, 2),
          tss: 32,
          tss_source: "hr",
          duration_sec: 2100,
          intensity_factor: null
        }
      ];
    })()
  };
}

const globalKey = "__tri_preview_database__" as const;
const globalVersionKey = "__tri_preview_database_version__" as const;
// Bump this when the seed schema changes (new tables, new columns, etc.)
const PREVIEW_DATABASE_VERSION = 6;

function getOrCreateDatabase(): PreviewDatabase {
  const existing = (globalThis as Record<string, unknown>)[globalKey] as PreviewDatabase | undefined;
  const version = (globalThis as Record<string, unknown>)[globalVersionKey] as number | undefined;
  if (existing && version === PREVIEW_DATABASE_VERSION) return existing;
  const db = createPreviewDatabase();
  (globalThis as Record<string, unknown>)[globalKey] = db;
  (globalThis as Record<string, unknown>)[globalVersionKey] = PREVIEW_DATABASE_VERSION;
  return db;
}

export function getPreviewDatabase() {
  return getOrCreateDatabase();
}

export function resetPreviewDatabase() {
  (globalThis as Record<string, unknown>)[globalKey] = createPreviewDatabase();
}

