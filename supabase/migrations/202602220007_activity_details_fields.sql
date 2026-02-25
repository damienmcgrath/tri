alter table public.completed_activities
  add column if not exists notes text,
  add column if not exists is_unplanned boolean not null default false,
  add column if not exists is_race boolean not null default false;

alter table public.completed_activities
  drop constraint if exists completed_activities_source_check;

alter table public.completed_activities
  add constraint completed_activities_source_check
  check (source in ('upload', 'garmin', 'synced'));
