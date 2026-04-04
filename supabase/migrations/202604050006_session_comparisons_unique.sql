-- Prevent duplicate comparison rows for the same session + range pair.
-- This allows upsert to work correctly when verdict regeneration re-triggers comparisons.

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_comparisons_unique_pair
  ON session_comparisons(current_session_id, comparison_range);
