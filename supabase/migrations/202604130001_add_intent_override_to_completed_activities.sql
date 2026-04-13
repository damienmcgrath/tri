-- Add intent_override column to completed_activities so users can correct
-- the auto-inferred intent category for extra (unplanned) workouts.
-- Stored as a dedicated column (not inside execution_result JSONB) because
-- execution_result gets fully replaced on regeneration.
ALTER TABLE public.completed_activities
  ADD COLUMN IF NOT EXISTS intent_override text;

COMMENT ON COLUMN public.completed_activities.intent_override IS
  'User-supplied intent override for extra sessions. When set, downstream code uses this instead of calling inferExtraIntent.';
