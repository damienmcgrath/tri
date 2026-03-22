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
const PREVIEW_LINK_ONE_ID = "66666666-6666-4666-8666-666666666661";
const PREVIEW_LINK_TWO_ID = "66666666-6666-4666-8666-666666666662";
const PREVIEW_LINK_EXTRA_RUN_ID = "66666666-6666-4666-8666-666666666663";

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
  | "ingestion_events";

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
          recommendedNextAction: "Shorten the final rep slightly or start 5 watts lower to hold form deeper."
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
        status: "planned",
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
        status: "planned",
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
        status: "planned",
        day_order: 1,
        notes: null,
        created_at: "2026-03-08T18:06:00.000Z",
        is_key: true,
        execution_result: null
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
      }
    ],
    planned_sessions: [],
    completed_sessions: [
      { id: "88888888-8888-4888-8888-888888888881", user_id: PREVIEW_USER_ID, date: "2026-03-09", sport: "swim" },
      { id: "88888888-8888-4888-8888-888888888882", user_id: PREVIEW_USER_ID, date: "2026-03-10", sport: "bike" },
      { id: "88888888-8888-4888-8888-888888888883", user_id: PREVIEW_USER_ID, date: "2026-03-11", sport: "run" }
    ],
    completed_activities: [
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
    weekly_debriefs: [],
    ingestion_events: []
  };
}

const globalKey = "__tri_preview_database__" as const;

function getOrCreateDatabase(): PreviewDatabase {
  const existing = (globalThis as Record<string, unknown>)[globalKey] as PreviewDatabase | undefined;
  if (existing) return existing;
  const db = createPreviewDatabase();
  (globalThis as Record<string, unknown>)[globalKey] = db;
  return db;
}

export function getPreviewDatabase() {
  return getOrCreateDatabase();
}

export function resetPreviewDatabase() {
  (globalThis as Record<string, unknown>)[globalKey] = createPreviewDatabase();
}

