create table if not exists public.weekly_debriefs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  status text not null check (status in ('ready', 'stale', 'failed')),
  source_updated_at timestamptz not null,
  generated_at timestamptz not null default now(),
  generation_version integer not null default 1,
  facts jsonb not null default '{}'::jsonb,
  narrative jsonb not null default '{}'::jsonb,
  coach_share jsonb not null default '{}'::jsonb,
  helpful boolean,
  accurate boolean,
  feedback_note text,
  feedback_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, week_start)
);

create index if not exists weekly_debriefs_athlete_week_idx
  on public.weekly_debriefs(athlete_id, week_start desc);

alter table public.weekly_debriefs enable row level security;

drop policy if exists "weekly_debriefs_select_own" on public.weekly_debriefs;
create policy "weekly_debriefs_select_own"
on public.weekly_debriefs
for select
using (athlete_id = auth.uid());

drop policy if exists "weekly_debriefs_insert_own" on public.weekly_debriefs;
create policy "weekly_debriefs_insert_own"
on public.weekly_debriefs
for insert
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "weekly_debriefs_update_own" on public.weekly_debriefs;
create policy "weekly_debriefs_update_own"
on public.weekly_debriefs
for update
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop trigger if exists set_weekly_debriefs_updated_at on public.weekly_debriefs;
create trigger set_weekly_debriefs_updated_at
before update on public.weekly_debriefs
for each row
execute procedure public.set_updated_at();
