-- Session Verdicts: structured three-part AI-generated execution diagnosis
-- Part 1: Purpose Statement (physiological intent)
-- Part 2: Execution Assessment (data-grounded analysis)
-- Part 3: Adaptation Signal (forward-looking recommendation)

CREATE TABLE IF NOT EXISTS public.session_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  activity_id UUID,

  -- Purpose
  purpose_statement TEXT NOT NULL,
  training_block_context TEXT,
  intended_zones JSONB,
  intended_metrics JSONB,

  -- Execution Assessment
  execution_summary TEXT NOT NULL,
  verdict_status TEXT NOT NULL CHECK (verdict_status IN ('achieved', 'partial', 'missed', 'off_target')),
  metric_comparisons JSONB NOT NULL DEFAULT '[]'::jsonb,
  key_deviations JSONB,

  -- Adaptation Signal
  adaptation_signal TEXT NOT NULL,
  adaptation_type TEXT CHECK (adaptation_type IN ('proceed', 'flag_review', 'modify', 'redistribute')),
  affected_session_ids UUID[],

  -- Metadata
  discipline TEXT NOT NULL CHECK (discipline IN ('swim', 'bike', 'run', 'strength', 'other')),
  feel_data JSONB,
  raw_ai_response JSONB,
  ai_model_used TEXT,
  ai_prompt_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_verdicts_user ON public.session_verdicts(user_id);
CREATE INDEX IF NOT EXISTS idx_session_verdicts_session ON public.session_verdicts(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_verdicts_session_uniq ON public.session_verdicts(session_id);

ALTER TABLE public.session_verdicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "session_verdicts_select_own"
  ON public.session_verdicts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "session_verdicts_insert_own"
  ON public.session_verdicts FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "session_verdicts_update_own"
  ON public.session_verdicts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "session_verdicts_delete_own"
  ON public.session_verdicts FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_verdicts TO authenticated;

DROP TRIGGER IF EXISTS set_session_verdicts_updated_at ON public.session_verdicts;
CREATE TRIGGER set_session_verdicts_updated_at
BEFORE UPDATE ON public.session_verdicts
FOR EACH ROW
EXECUTE PROCEDURE public.set_updated_at();
