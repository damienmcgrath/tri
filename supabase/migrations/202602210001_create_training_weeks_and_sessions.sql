create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.training_weeks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  week_index integer not null check (week_index > 0),
  week_start_date date not null,
  focus text not null default 'Build' check (focus in ('Build', 'Recovery', 'Taper', 'Race', 'Custom')),
  notes text,
  target_minutes integer,
  target_tss integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, week_index)
);

create index if not exists training_weeks_plan_id_idx on public.training_weeks(plan_id);
create index if not exists training_weeks_start_idx on public.training_weeks(week_start_date);

alter table public.training_weeks enable row level security;

drop policy if exists "training_weeks_select_own" on public.training_weeks;
create policy "training_weeks_select_own"
on public.training_weeks
for select
using (
  exists (
    select 1 from public.training_plans tp
    where tp.id = training_weeks.plan_id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists "training_weeks_insert_own" on public.training_weeks;
create policy "training_weeks_insert_own"
on public.training_weeks
for insert
with check (
  exists (
    select 1 from public.training_plans tp
    where tp.id = training_weeks.plan_id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists "training_weeks_update_own" on public.training_weeks;
create policy "training_weeks_update_own"
on public.training_weeks
for update
using (
  exists (
    select 1 from public.training_plans tp
    where tp.id = training_weeks.plan_id
      and tp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.training_plans tp
    where tp.id = training_weeks.plan_id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists "training_weeks_delete_own" on public.training_weeks;
create policy "training_weeks_delete_own"
on public.training_weeks
for delete
using (
  exists (
    select 1 from public.training_plans tp
    where tp.id = training_weeks.plan_id
      and tp.user_id = auth.uid()
  )
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  week_id uuid references public.training_weeks(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other')),
  type text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  notes text,
  distance_value numeric,
  distance_unit text,
  status text not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sessions
  alter column week_id drop not null;

create index if not exists sessions_plan_id_idx on public.sessions(plan_id);
create index if not exists sessions_week_id_idx on public.sessions(week_id);
create index if not exists sessions_user_id_idx on public.sessions(user_id);
create index if not exists sessions_date_idx on public.sessions(date);

alter table public.sessions enable row level security;

drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own"
on public.sessions
for select
using (auth.uid() = user_id);

drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own"
on public.sessions
for insert
with check (auth.uid() = user_id);

drop policy if exists "sessions_update_own" on public.sessions;
create policy "sessions_update_own"
on public.sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "sessions_delete_own" on public.sessions;
create policy "sessions_delete_own"
on public.sessions
for delete
using (auth.uid() = user_id);

insert into public.training_weeks (plan_id, week_index, week_start_date, focus)
select
  tp.id,
  gs.week_index,
  (tp.start_date + ((gs.week_index - 1) * interval '7 day'))::date,
  'Build'
from public.training_plans tp
cross join lateral generate_series(1, greatest(tp.duration_weeks, 1)) as gs(week_index)
on conflict (plan_id, week_index) do nothing;

insert into public.sessions (
  id,
  plan_id,
  week_id,
  user_id,
  date,
  sport,
  type,
  duration_minutes,
  notes,
  status,
  created_at,
  updated_at
)
select
  ps.id,
  ps.plan_id,
  tw.id,
  ps.user_id,
  ps.date,
  ps.sport,
  ps.type,
  ps.duration,
  ps.notes,
  'planned',
  ps.created_at,
  ps.updated_at
from public.planned_sessions ps
left join public.training_weeks tw
  on tw.plan_id = ps.plan_id
 and ps.date >= tw.week_start_date
 and ps.date < tw.week_start_date + interval '7 day'
on conflict (id) do nothing;

drop trigger if exists set_training_weeks_updated_at on public.training_weeks;
create trigger set_training_weeks_updated_at
before update on public.training_weeks
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_sessions_updated_at on public.sessions;
create trigger set_sessions_updated_at
before update on public.sessions
for each row
execute procedure public.set_updated_at();
