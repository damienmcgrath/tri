-- Phase 1A: Race review data foundation.
--
-- Extends race_profiles with goal_time_sec / goal_strategy_summary so race
-- bundles can snapshot the goal at ingestion time, and extends race_bundles
-- with the immutable pre-race fitness snapshot, taper compliance, structured
-- subjective inputs, lifecycle status, and Strava-stitched provenance.
--
-- All new columns are nullable (or have safe defaults) so existing rows remain
-- valid. New bundles default to pre_race_snapshot_status = 'pending' and
-- status = 'imported'; the snapshot capture path fills in the rest.

ALTER TABLE public.race_profiles
  ADD COLUMN IF NOT EXISTS goal_time_sec integer,
  ADD COLUMN IF NOT EXISTS goal_strategy_summary text;

ALTER TABLE public.race_bundles
  -- Goal anchor (snapshotted from race_profiles at first ingestion; immutable thereafter)
  ADD COLUMN IF NOT EXISTS race_profile_id uuid REFERENCES public.race_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS goal_time_sec integer,
  ADD COLUMN IF NOT EXISTS goal_strategy_summary text,
  ADD COLUMN IF NOT EXISTS course_profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conditions_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Pre-race state snapshot (athlete_fitness on race date, plus taper compliance)
  ADD COLUMN IF NOT EXISTS pre_race_ctl numeric(6,2),
  ADD COLUMN IF NOT EXISTS pre_race_atl numeric(6,2),
  ADD COLUMN IF NOT EXISTS pre_race_tsb numeric(6,2),
  ADD COLUMN IF NOT EXISTS pre_race_tsb_state text,
  ADD COLUMN IF NOT EXISTS pre_race_ramp_rate numeric(6,2),
  ADD COLUMN IF NOT EXISTS pre_race_snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_race_snapshot_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS taper_compliance_score numeric(4,3),
  ADD COLUMN IF NOT EXISTS taper_compliance_summary text,

  -- Subjective inputs (post-import guided form)
  ADD COLUMN IF NOT EXISTS athlete_rating smallint,
  ADD COLUMN IF NOT EXISTS athlete_notes text,
  ADD COLUMN IF NOT EXISTS issues_flagged text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS finish_position integer,
  ADD COLUMN IF NOT EXISTS age_group_position integer,
  ADD COLUMN IF NOT EXISTS subjective_captured_at timestamptz,

  -- Lifecycle + Strava-stitched provenance
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS inferred_transitions boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'race_bundles_pre_race_tsb_state_valid'
  ) THEN
    ALTER TABLE public.race_bundles
      ADD CONSTRAINT race_bundles_pre_race_tsb_state_valid
      CHECK (pre_race_tsb_state IS NULL OR pre_race_tsb_state IN ('fresh','absorbing','fatigued','overreaching'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'race_bundles_pre_race_snapshot_status_valid'
  ) THEN
    ALTER TABLE public.race_bundles
      ADD CONSTRAINT race_bundles_pre_race_snapshot_status_valid
      CHECK (pre_race_snapshot_status IN ('pending','captured','partial','unavailable'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'race_bundles_athlete_rating_range'
  ) THEN
    ALTER TABLE public.race_bundles
      ADD CONSTRAINT race_bundles_athlete_rating_range
      CHECK (athlete_rating IS NULL OR (athlete_rating BETWEEN 1 AND 5));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'race_bundles_status_valid'
  ) THEN
    ALTER TABLE public.race_bundles
      ADD CONSTRAINT race_bundles_status_valid
      CHECK (status IN ('imported','reviewed','archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'race_bundles_issues_flagged_valid'
  ) THEN
    ALTER TABLE public.race_bundles
      ADD CONSTRAINT race_bundles_issues_flagged_valid
      CHECK (issues_flagged <@ ARRAY['nutrition','mechanical','illness','navigation','pacing','mental','weather']::text[]);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS race_bundles_user_status_idx
  ON public.race_bundles (user_id, status);

CREATE INDEX IF NOT EXISTS race_bundles_race_profile_idx
  ON public.race_bundles (race_profile_id)
  WHERE race_profile_id IS NOT NULL;
