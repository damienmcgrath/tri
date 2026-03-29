-- External OAuth connections (provider-agnostic: supports strava, garmin, etc.)
CREATE TABLE public.external_account_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider              text NOT NULL CHECK (provider IN ('strava')),
  provider_athlete_id   text NOT NULL,
  access_token          text NOT NULL,
  refresh_token         text NOT NULL,
  token_expires_at      timestamptz NOT NULL,
  scope                 text,
  provider_display_name text,
  provider_profile      jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_at          timestamptz NOT NULL DEFAULT now(),
  disconnected_at       timestamptz,
  last_synced_at        timestamptz,
  last_sync_status      text CHECK (last_sync_status IN ('ok', 'error', 'running')),
  last_sync_error       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_account_connections_user_provider_unique UNIQUE (user_id, provider)
);

CREATE INDEX external_account_connections_user_id_idx
  ON public.external_account_connections (user_id);

-- Required for webhook lookup: Strava sends athlete ID, not our user ID
CREATE INDEX external_account_connections_provider_athlete_id_idx
  ON public.external_account_connections (provider, provider_athlete_id);

ALTER TABLE public.external_account_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eac_select_own" ON public.external_account_connections
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "eac_update_own" ON public.external_account_connections
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "eac_delete_own" ON public.external_account_connections
  FOR DELETE USING (auth.uid() = user_id);

-- No client INSERT policy — inserts happen server-side only via service role

CREATE OR REPLACE FUNCTION public.set_updated_at_eac()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at_eac
  BEFORE UPDATE ON public.external_account_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_eac();
