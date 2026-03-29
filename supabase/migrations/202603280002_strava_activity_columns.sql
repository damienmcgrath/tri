-- 1. Widen source constraint to include 'strava'
--    Current constraint (from 202602220007): ('upload', 'garmin', 'synced')
ALTER TABLE public.completed_activities
  DROP CONSTRAINT IF EXISTS completed_activities_source_check;

ALTER TABLE public.completed_activities
  ADD CONSTRAINT completed_activities_source_check
  CHECK (source IN ('upload', 'garmin', 'synced', 'strava'));

-- 2. External provider linkage columns
ALTER TABLE public.completed_activities
  ADD COLUMN IF NOT EXISTS external_provider     text,
  ADD COLUMN IF NOT EXISTS external_activity_id  text,
  ADD COLUMN IF NOT EXISTS external_title        text;

-- 3. Deduplication index (partial — only rows with external_provider set)
CREATE UNIQUE INDEX IF NOT EXISTS completed_activities_external_dedup_idx
  ON public.completed_activities (user_id, external_provider, external_activity_id)
  WHERE external_provider IS NOT NULL;

-- 4. Audit log for sync operations (import/skip/error events)
CREATE TABLE public.external_sync_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider             text NOT NULL,
  event_type           text NOT NULL,
  external_activity_id text,
  status               text NOT NULL CHECK (status IN ('ok', 'skipped', 'error')),
  error_message        text,
  raw_payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX external_sync_log_user_id_idx
  ON public.external_sync_log (user_id, created_at DESC);

ALTER TABLE public.external_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "esl_select_own" ON public.external_sync_log
  FOR SELECT USING (auth.uid() = user_id);
-- Server-only inserts; no client INSERT policy
