-- Feature 1: Monday Morning Problem Fix — week transition briefings + weekly_debriefs enhancements

-- Extend weekly_debriefs with finalization tracking
ALTER TABLE weekly_debriefs
  ADD COLUMN IF NOT EXISTS is_finalized boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS carry_forward_note text;

-- Week transition briefings: auto-generated coaching bridge between weeks
CREATE TABLE IF NOT EXISTS week_transition_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Which weeks this bridges
  prior_week_debrief_id uuid REFERENCES weekly_debriefs(id) ON DELETE SET NULL,
  current_week_start date NOT NULL,

  -- Briefing content
  last_week_takeaway text NOT NULL,
  this_week_focus text NOT NULL,
  adaptation_context text,               -- null if no pending adaptations
  pending_rationale_ids uuid[],           -- references to adaptation_rationales
  coaching_prompt text,                   -- the open question

  -- Status
  viewed_at timestamptz,
  dismissed_at timestamptz,

  created_at timestamptz DEFAULT now(),
  ai_model_used text,
  ai_prompt_version text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_week_transition_unique
  ON week_transition_briefings(user_id, current_week_start);

ALTER TABLE week_transition_briefings ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "week_transition_briefings_select_own" ON week_transition_briefings;
CREATE POLICY "week_transition_briefings_select_own"
  ON week_transition_briefings FOR SELECT
  USING (athlete_id = auth.uid());

DROP POLICY IF EXISTS "week_transition_briefings_insert_own" ON week_transition_briefings;
CREATE POLICY "week_transition_briefings_insert_own"
  ON week_transition_briefings FOR INSERT
  WITH CHECK (athlete_id = auth.uid() AND user_id = auth.uid());

DROP POLICY IF EXISTS "week_transition_briefings_update_own" ON week_transition_briefings;
CREATE POLICY "week_transition_briefings_update_own"
  ON week_transition_briefings FOR UPDATE
  USING (athlete_id = auth.uid())
  WITH CHECK (athlete_id = auth.uid() AND user_id = auth.uid());
