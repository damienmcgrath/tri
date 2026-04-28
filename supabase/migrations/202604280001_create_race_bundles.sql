-- Race bundles: groups multiple completed_activities (swim/T1/bike/T2/run) into a single race entity.
-- Created either at parse time from a Garmin auto_multi_sport FIT file, or reconstructed from
-- multiple Strava activities arriving on the same day in race shape.

create table if not exists public.race_bundles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  total_duration_sec integer not null default 0 check (total_duration_sec >= 0),
  total_distance_m numeric(12, 2),
  source text not null check (source in ('garmin_multisport', 'strava_reconstructed', 'manual')),
  upload_id uuid references public.activity_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists race_bundles_user_started_idx
  on public.race_bundles(user_id, started_at desc);

alter table public.race_bundles enable row level security;

create policy "race_bundles_select_own" on public.race_bundles
  for select using (auth.uid() = user_id);
create policy "race_bundles_insert_own" on public.race_bundles
  for insert with check (auth.uid() = user_id);
create policy "race_bundles_update_own" on public.race_bundles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "race_bundles_delete_own" on public.race_bundles
  for delete using (auth.uid() = user_id);

create or replace function public.set_race_bundles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists race_bundles_updated_at on public.race_bundles;
create trigger race_bundles_updated_at
  before update on public.race_bundles
  for each row execute function public.set_race_bundles_updated_at();

-- Per-segment columns on completed_activities. race_bundle_id binds a child to its bundle;
-- race_segment_role tags it as swim/T1/bike/T2/run; race_segment_index orders chronologically.

alter table public.completed_activities
  add column if not exists race_bundle_id uuid references public.race_bundles(id) on delete set null;

alter table public.completed_activities
  add column if not exists race_segment_role text
    check (race_segment_role in ('swim', 't1', 'bike', 't2', 'run'));

alter table public.completed_activities
  add column if not exists race_segment_index smallint;

create index if not exists completed_activities_race_bundle_idx
  on public.completed_activities(race_bundle_id, race_segment_index)
  where race_bundle_id is not null;
