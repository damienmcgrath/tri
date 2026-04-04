-- Feature 4: Intensity-Reflective Plan View

-- Session-level intensity profile (computed from plan data)
CREATE TABLE IF NOT EXISTS session_intensity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Intensity classification
  primary_zone text NOT NULL,             -- 'z1', 'z2', 'z3', 'z4', 'z5', 'strength'
  zone_distribution jsonb NOT NULL,
  -- e.g. {"z1": 0.10, "z2": 0.60, "z3": 0.20, "z4": 0.10, "z5": 0.00}

  -- Training stress
  planned_stress_score float,             -- normalised 0-100 relative to athlete range
  planned_duration_minutes int NOT NULL,
  stress_per_minute float,                -- intensity density metric

  -- Visual encoding helpers
  intensity_colour text NOT NULL,         -- CSS colour for the primary zone
  visual_weight float NOT NULL CHECK (visual_weight BETWEEN 0 AND 1),
  -- normalised block height

  discipline text NOT NULL,
  created_at timestamptz DEFAULT now(),

  UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_intensity_profiles_session
  ON session_intensity_profiles(session_id);

ALTER TABLE session_intensity_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_intensity_profiles_select_own" ON session_intensity_profiles;
CREATE POLICY "session_intensity_profiles_select_own"
  ON session_intensity_profiles FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "session_intensity_profiles_insert_own" ON session_intensity_profiles;
CREATE POLICY "session_intensity_profiles_insert_own"
  ON session_intensity_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "session_intensity_profiles_update_own" ON session_intensity_profiles;
CREATE POLICY "session_intensity_profiles_update_own"
  ON session_intensity_profiles FOR UPDATE
  USING (user_id = auth.uid());

-- Weekly intensity summary (aggregated from session profiles)
CREATE TABLE IF NOT EXISTS weekly_intensity_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,

  -- Aggregated zone distribution
  zone_distribution jsonb NOT NULL,

  -- Totals
  total_planned_hours float NOT NULL,
  total_stress_score float,
  session_count int NOT NULL,

  -- Week-over-week deltas
  hours_delta_pct float,                  -- vs previous week, null for first week
  stress_delta_pct float,

  -- Per-discipline breakdown
  discipline_hours jsonb NOT NULL,        -- {"swim": 2.5, "bike": 4.0, "run": 3.0}
  discipline_stress jsonb,

  -- Training block context
  training_block text,
  week_in_block int,
  block_type text,                        -- 'build', 'recovery', 'peak', 'taper', 'base'

  created_at timestamptz DEFAULT now(),

  UNIQUE(user_id, week_start_date)
);

ALTER TABLE weekly_intensity_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_intensity_summaries_select_own" ON weekly_intensity_summaries;
CREATE POLICY "weekly_intensity_summaries_select_own"
  ON weekly_intensity_summaries FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "weekly_intensity_summaries_insert_own" ON weekly_intensity_summaries;
CREATE POLICY "weekly_intensity_summaries_insert_own"
  ON weekly_intensity_summaries FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "weekly_intensity_summaries_update_own" ON weekly_intensity_summaries;
CREATE POLICY "weekly_intensity_summaries_update_own"
  ON weekly_intensity_summaries FOR UPDATE
  USING (user_id = auth.uid());
