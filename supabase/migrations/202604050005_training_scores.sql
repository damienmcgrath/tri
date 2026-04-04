-- Feature 5: Training Score (3-dimension composite scoring)

CREATE TABLE IF NOT EXISTS training_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score_date date NOT NULL,

  -- Composite
  composite_score float NOT NULL CHECK (composite_score BETWEEN 0 AND 100),

  -- Dimension 1: Execution Quality (from session verdicts)
  execution_quality float CHECK (execution_quality BETWEEN 0 AND 100),
  execution_inputs jsonb,                 -- which verdicts contributed, how weighted

  -- Dimension 2: Progression Signal (from session comparisons)
  progression_signal float CHECK (progression_signal BETWEEN 0 AND 100),
  progression_inputs jsonb,               -- which comparisons contributed
  progression_active boolean DEFAULT false, -- false until 2+ weeks of data

  -- Dimension 3: Balance Score (from discipline balance)
  balance_score float CHECK (balance_score BETWEEN 0 AND 100),
  balance_inputs jsonb,                   -- actual vs ideal distribution

  -- Context
  goal_race_type text,                    -- 'sprint', 'olympic', '70.3', 'ironman', 'custom'
  training_block text,

  -- Deltas
  score_delta_7d float,                   -- change vs 7 days ago
  score_delta_28d float,                  -- change vs 28 days ago

  created_at timestamptz DEFAULT now(),

  UNIQUE(user_id, score_date)
);

CREATE INDEX IF NOT EXISTS idx_training_scores_recent
  ON training_scores(user_id, score_date DESC);

ALTER TABLE training_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_scores_select_own" ON training_scores;
CREATE POLICY "training_scores_select_own"
  ON training_scores FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "training_scores_insert_own" ON training_scores;
CREATE POLICY "training_scores_insert_own"
  ON training_scores FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "training_scores_update_own" ON training_scores;
CREATE POLICY "training_scores_update_own"
  ON training_scores FOR UPDATE
  USING (user_id = auth.uid());
