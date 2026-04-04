-- Adaptation Rationales: human-readable explanations for every plan modification
-- Presented as "Coach Note" cards on Calendar and Plan surfaces

CREATE TABLE IF NOT EXISTS public.adaptation_rationales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What triggered the adaptation
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'recovery_signal', 'missed_session', 'load_rebalance',
    'cross_discipline', 'feel_based', 'block_transition',
    'athlete_request', 'schedule_change'
  )),
  trigger_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- What changed
  rationale_text TEXT NOT NULL,
  changes_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  preserved_elements TEXT[],

  -- Context
  week_number INT,
  training_block TEXT,
  affected_sessions UUID[],
  source_verdict_id UUID,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'discussed', 'overridden')),
  athlete_response TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_adaptation_rationales_user ON public.adaptation_rationales(user_id);
CREATE INDEX IF NOT EXISTS idx_adaptation_rationales_status ON public.adaptation_rationales(user_id, status);

ALTER TABLE public.adaptation_rationales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "adaptation_rationales_select_own"
  ON public.adaptation_rationales FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "adaptation_rationales_insert_own"
  ON public.adaptation_rationales FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "adaptation_rationales_update_own"
  ON public.adaptation_rationales FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "adaptation_rationales_delete_own"
  ON public.adaptation_rationales FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.adaptation_rationales TO authenticated;
