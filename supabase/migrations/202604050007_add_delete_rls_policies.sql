-- Security hardening: add missing DELETE RLS policies to tables created in April 2026 migrations.
-- Without these policies, RLS silently blocks all DELETEs (safe default), but explicit
-- policies are required for application delete operations and consistency.

-- week_transition_briefings (from 202604050001)
DROP POLICY IF EXISTS "week_transition_briefings_delete_own" ON week_transition_briefings;
CREATE POLICY "week_transition_briefings_delete_own"
  ON week_transition_briefings FOR DELETE
  USING (athlete_id = auth.uid());

-- session_comparisons (from 202604050002)
DROP POLICY IF EXISTS "session_comparisons_delete_own" ON session_comparisons;
CREATE POLICY "session_comparisons_delete_own"
  ON session_comparisons FOR DELETE
  USING (user_id = auth.uid());

-- morning_briefs (from 202604050003)
DROP POLICY IF EXISTS "morning_briefs_delete_own" ON morning_briefs;
CREATE POLICY "morning_briefs_delete_own"
  ON morning_briefs FOR DELETE
  USING (athlete_id = auth.uid());

-- session_intensity_profiles (from 202604050004)
DROP POLICY IF EXISTS "session_intensity_profiles_delete_own" ON session_intensity_profiles;
CREATE POLICY "session_intensity_profiles_delete_own"
  ON session_intensity_profiles FOR DELETE
  USING (user_id = auth.uid());

-- weekly_intensity_summaries (from 202604050004)
DROP POLICY IF EXISTS "weekly_intensity_summaries_delete_own" ON weekly_intensity_summaries;
CREATE POLICY "weekly_intensity_summaries_delete_own"
  ON weekly_intensity_summaries FOR DELETE
  USING (user_id = auth.uid());

-- training_scores (from 202604050005)
DROP POLICY IF EXISTS "training_scores_delete_own" ON training_scores;
CREATE POLICY "training_scores_delete_own"
  ON training_scores FOR DELETE
  USING (user_id = auth.uid());
