create extension if not exists pgcrypto;

create table if not exists public.athlete_context (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  experience_level text check (experience_level is null or experience_level in ('beginner', 'intermediate', 'advanced')),
  goal_type text check (goal_type is null or goal_type in ('finish', 'perform', 'qualify', 'build')),
  priority_event_name text,
  priority_event_date date,
  limiters jsonb not null default '[]'::jsonb,
  strongest_disciplines jsonb not null default '[]'::jsonb,
  weakest_disciplines jsonb not null default '[]'::jsonb,
  weekly_constraints jsonb not null default '[]'::jsonb,
  injury_notes text,
  coaching_preference text check (coaching_preference is null or coaching_preference in ('direct', 'balanced', 'supportive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.athlete_checkins (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  fatigue smallint check (fatigue is null or (fatigue >= 1 and fatigue <= 5)),
  sleep_quality smallint check (sleep_quality is null or (sleep_quality >= 1 and sleep_quality <= 5)),
  soreness smallint check (soreness is null or (soreness >= 1 and soreness <= 5)),
  stress smallint check (stress is null or (stress >= 1 and stress <= 5)),
  confidence smallint check (confidence is null or (confidence >= 1 and confidence <= 5)),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, week_start)
);

create table if not exists public.athlete_observed_patterns (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  pattern_key text not null,
  label text not null,
  detail text not null,
  support_count integer not null default 0,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  last_observed_at timestamptz not null,
  source_session_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, pattern_key)
);

create index if not exists athlete_checkins_athlete_week_idx
  on public.athlete_checkins(athlete_id, week_start desc);

create index if not exists athlete_observed_patterns_athlete_last_observed_idx
  on public.athlete_observed_patterns(athlete_id, last_observed_at desc);

alter table public.athlete_context enable row level security;
alter table public.athlete_checkins enable row level security;
alter table public.athlete_observed_patterns enable row level security;

drop policy if exists "athlete_context_select_own" on public.athlete_context;
create policy "athlete_context_select_own"
on public.athlete_context
for select
using (athlete_id = auth.uid());

drop policy if exists "athlete_context_insert_own" on public.athlete_context;
create policy "athlete_context_insert_own"
on public.athlete_context
for insert
with check (athlete_id = auth.uid());

drop policy if exists "athlete_context_update_own" on public.athlete_context;
create policy "athlete_context_update_own"
on public.athlete_context
for update
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

drop policy if exists "athlete_checkins_select_own" on public.athlete_checkins;
create policy "athlete_checkins_select_own"
on public.athlete_checkins
for select
using (athlete_id = auth.uid());

drop policy if exists "athlete_checkins_insert_own" on public.athlete_checkins;
create policy "athlete_checkins_insert_own"
on public.athlete_checkins
for insert
with check (athlete_id = auth.uid());

drop policy if exists "athlete_checkins_update_own" on public.athlete_checkins;
create policy "athlete_checkins_update_own"
on public.athlete_checkins
for update
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

drop policy if exists "athlete_observed_patterns_select_own" on public.athlete_observed_patterns;
create policy "athlete_observed_patterns_select_own"
on public.athlete_observed_patterns
for select
using (athlete_id = auth.uid());

drop policy if exists "athlete_observed_patterns_insert_own" on public.athlete_observed_patterns;
create policy "athlete_observed_patterns_insert_own"
on public.athlete_observed_patterns
for insert
with check (athlete_id = auth.uid());

drop policy if exists "athlete_observed_patterns_update_own" on public.athlete_observed_patterns;
create policy "athlete_observed_patterns_update_own"
on public.athlete_observed_patterns
for update
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

drop policy if exists "athlete_observed_patterns_delete_own" on public.athlete_observed_patterns;
create policy "athlete_observed_patterns_delete_own"
on public.athlete_observed_patterns
for delete
using (athlete_id = auth.uid());

drop trigger if exists set_athlete_context_updated_at on public.athlete_context;
create trigger set_athlete_context_updated_at
before update on public.athlete_context
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_athlete_checkins_updated_at on public.athlete_checkins;
create trigger set_athlete_checkins_updated_at
before update on public.athlete_checkins
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_athlete_observed_patterns_updated_at on public.athlete_observed_patterns;
create trigger set_athlete_observed_patterns_updated_at
before update on public.athlete_observed_patterns
for each row
execute procedure public.set_updated_at();
