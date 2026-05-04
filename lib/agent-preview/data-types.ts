// Stable IDs and the PreviewDatabase row shape used across the preview seed.
// Imported by data-factories.ts (helpers) and data-scenarios.ts (the seed
// itself). Kept in a single place so cross-row foreign keys stay in sync.

export const PREVIEW_USER_ID = "11111111-1111-4111-8111-111111111111";
export const PREVIEW_PLAN_ID = "22222222-2222-4222-8222-222222222222";
export const PREVIEW_WEEK_ONE_ID = "33333333-3333-4333-8333-333333333331";
export const PREVIEW_WEEK_TWO_ID = "33333333-3333-4333-8333-333333333332";
export const PREVIEW_WEEK_THREE_ID = "33333333-3333-4333-8333-333333333333";
export const PREVIEW_UPLOAD_ID = "44444444-4444-4444-8444-444444444444";
export const PREVIEW_ACTIVITY_ONE_ID = "55555555-5555-4555-8555-555555555551";
export const PREVIEW_ACTIVITY_TWO_ID = "55555555-5555-4555-8555-555555555552";
export const PREVIEW_ACTIVITY_THREE_ID = "55555555-5555-4555-8555-555555555553";
export const PREVIEW_ACTIVITY_EXTRA_RUN_ID = "55555555-5555-4555-8555-555555555554";
export const PREVIEW_ACTIVITY_UNREVIEWED_ID = "55555555-5555-4555-8555-555555555555";
export const PREVIEW_ACTIVITY_SWIM_ID = "55555555-5555-4555-8555-555555555556";
export const PREVIEW_ACTIVITY_LONG_RUN_ID = "55555555-5555-4555-8555-555555555557";
export const PREVIEW_LINK_ONE_ID = "66666666-6666-4666-8666-666666666661";
export const PREVIEW_LINK_TWO_ID = "66666666-6666-4666-8666-666666666662";
export const PREVIEW_LINK_EXTRA_RUN_ID = "66666666-6666-4666-8666-666666666663";
export const PREVIEW_LINK_SWIM_ID = "66666666-6666-4666-8666-666666666664";
export const PREVIEW_LINK_LONG_RUN_ID = "66666666-6666-4666-8666-666666666665";
export const PREVIEW_WEEK_FOUR_ID = "33333333-3333-4333-8333-333333333334";
export const PREVIEW_WEEK_FIVE_ID = "33333333-3333-4333-8333-333333333335";
export const PREVIEW_BLOCK_BASE_ID = "88888888-8888-4888-8888-888888888881";
export const PREVIEW_BLOCK_BUILD_ID = "88888888-8888-4888-8888-888888888882";

// ── Race bundle preview entities ──
// Lets the race-review feature be exercised locally without seeding from prod.
// Sunday of the current week (previewMonday() + 6) is wired up as a completed
// Olympic-distance race with 5 segments, a matching race_profile, and a
// pre-populated race_reviews row so the populated card state is visible
// immediately on seed.
export const PREVIEW_RACE_SESSION_ID = "77777777-7777-4777-8777-777777777795";
export const PREVIEW_RACE_BUNDLE_ID = "99999999-9999-4999-8999-999999999991";
export const PREVIEW_RACE_PROFILE_ID = "99999999-9999-4999-8999-999999999992";
export const PREVIEW_FUTURE_RACE_PROFILE_ID = "99999999-9999-4999-8999-999999999995";
export const PREVIEW_RACE_REVIEW_ID = "99999999-9999-4999-8999-999999999993";
export const PREVIEW_RACE_LESSONS_ID = "99999999-9999-4999-8999-999999999994";
export const PREVIEW_RACE_ACT_SWIM_ID = "99999999-9999-4999-8999-99999999999a";
export const PREVIEW_RACE_ACT_T1_ID = "99999999-9999-4999-8999-99999999999b";
export const PREVIEW_RACE_ACT_BIKE_ID = "99999999-9999-4999-8999-99999999999c";
export const PREVIEW_RACE_ACT_T2_ID = "99999999-9999-4999-8999-99999999999d";
export const PREVIEW_RACE_ACT_RUN_ID = "99999999-9999-4999-8999-99999999999e";
export const PREVIEW_RACE_LINK_SWIM_ID = "99999999-9999-4999-8999-9999999999a1";
export const PREVIEW_RACE_LINK_T1_ID = "99999999-9999-4999-8999-9999999999a2";
export const PREVIEW_RACE_LINK_BIKE_ID = "99999999-9999-4999-8999-9999999999a3";
export const PREVIEW_RACE_LINK_T2_ID = "99999999-9999-4999-8999-9999999999a4";
export const PREVIEW_RACE_LINK_RUN_ID = "99999999-9999-4999-8999-9999999999a5";

export type PreviewTableName =
  | "profiles"
  | "training_plans"
  | "training_blocks"
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
  | "session_load"
  | "race_bundles"
  | "race_profiles"
  | "race_reviews"
  | "race_lessons";

export type PreviewDatabase = Record<PreviewTableName, Array<Record<string, unknown>>>;
