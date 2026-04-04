-- Feature 2: Multi-Week Session Comparisons with AI narratives

CREATE TABLE IF NOT EXISTS session_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The sessions being compared
  current_session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  comparison_session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- Match quality
  match_score float NOT NULL CHECK (match_score BETWEEN 0 AND 1),
  match_factors jsonb NOT NULL,
  -- e.g. {"discipline": 1.0, "session_type": 0.95, "duration": 0.9, "intensity": 0.85}

  -- Comparison results
  comparison_summary text NOT NULL,       -- AI-generated coach narrative
  metric_deltas jsonb NOT NULL,           -- structured per-metric comparison

  -- Trend classification
  trend_direction text CHECK (trend_direction IN ('improving', 'stable', 'declining', 'insufficient_data')),
  trend_confidence text CHECK (trend_confidence IN ('high', 'moderate', 'low')),

  -- Context
  weeks_apart int NOT NULL,
  discipline text NOT NULL,
  session_type text NOT NULL,
  comparison_range text NOT NULL CHECK (comparison_range IN ('recent', 'extended')),

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_comparisons_current
  ON session_comparisons(current_session_id);
CREATE INDEX IF NOT EXISTS idx_session_comparisons_user
  ON session_comparisons(user_id, discipline, created_at DESC);

ALTER TABLE session_comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_comparisons_select_own" ON session_comparisons;
CREATE POLICY "session_comparisons_select_own"
  ON session_comparisons FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "session_comparisons_insert_own" ON session_comparisons;
CREATE POLICY "session_comparisons_insert_own"
  ON session_comparisons FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "session_comparisons_update_own" ON session_comparisons;
CREATE POLICY "session_comparisons_update_own"
  ON session_comparisons FOR UPDATE
  USING (user_id = auth.uid());
