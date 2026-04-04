-- Feature 3: Ambient Check-In Intelligence (Morning Briefs)

CREATE TABLE IF NOT EXISTS morning_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brief_date date NOT NULL,

  -- Content sections
  session_preview text,                   -- null on rest days with nothing to say
  readiness_context text,                 -- null if insufficient feel/recovery data
  week_context text NOT NULL,
  pending_actions text[],                 -- list of actionable items

  -- Full brief (assembled from sections)
  brief_text text NOT NULL,

  -- Data inputs used for generation
  input_data jsonb,

  -- Status
  viewed_at timestamptz,

  created_at timestamptz DEFAULT now(),
  ai_model_used text,
  ai_prompt_version text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_morning_briefs_unique
  ON morning_briefs(user_id, brief_date);

ALTER TABLE morning_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "morning_briefs_select_own" ON morning_briefs;
CREATE POLICY "morning_briefs_select_own"
  ON morning_briefs FOR SELECT
  USING (athlete_id = auth.uid());

DROP POLICY IF EXISTS "morning_briefs_insert_own" ON morning_briefs;
CREATE POLICY "morning_briefs_insert_own"
  ON morning_briefs FOR INSERT
  WITH CHECK (athlete_id = auth.uid() AND user_id = auth.uid());

DROP POLICY IF EXISTS "morning_briefs_update_own" ON morning_briefs;
CREATE POLICY "morning_briefs_update_own"
  ON morning_briefs FOR UPDATE
  USING (athlete_id = auth.uid())
  WITH CHECK (athlete_id = auth.uid() AND user_id = auth.uid());
