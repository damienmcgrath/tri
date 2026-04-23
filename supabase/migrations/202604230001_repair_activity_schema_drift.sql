-- Repair migration: a prior project state has migrations 202602220006 and
-- 202602220007 marked as applied in `supabase_migrations.schema_migrations`,
-- but their DDL effects are missing from the live schema. This re-applies the
-- expected end state idempotently.
--
-- Drift observed (2026-04-23):
-- - session_activity_links.planned_session_id is still NOT NULL (should be
--   nullable per 202602220006).
-- - completed_activities.is_unplanned / is_race / notes columns are missing
--   (should exist per 202602220007).

alter table public.session_activity_links
  alter column planned_session_id drop not null;

alter table public.completed_activities
  add column if not exists notes text,
  add column if not exists is_unplanned boolean not null default false,
  add column if not exists is_race boolean not null default false;
