create extension if not exists pgcrypto;

create table if not exists public.training_weeks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  week_index int not null check (week_index > 0),
  week_start_date date not null,
  focus text not null default 'Build',
  notes text,
  target_minutes int,
  target_tss int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, week_index),
  unique (plan_id, week_start_date)
);

alter table public.training_weeks enable row level security;

drop policy if exists "users manage own training_weeks" on public.training_weeks;
create policy "users manage own training_weeks"
  on public.training_weeks
  using (
    exists (
      select 1
      from public.training_plans tp
      where tp.id = training_weeks.plan_id and tp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.training_plans tp
      where tp.id = training_weeks.plan_id and tp.user_id = auth.uid()
    )
  );

create index if not exists training_weeks_plan_id_idx on public.training_weeks(plan_id);
create index if not exists training_weeks_week_start_date_idx on public.training_weeks(week_start_date);

-- rename planned_sessions -> sessions as the canonical table name.
do $$
begin
  if exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'planned_sessions'
  ) and not exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sessions'
  ) then
    alter table public.planned_sessions rename to sessions;
  end if;
end;
$$;

alter table if exists public.sessions
  add column if not exists week_id uuid,
  add column if not exists duration_minutes int,
  add column if not exists distance_value numeric(8,2),
  add column if not exists distance_unit text,
  add column if not exists status text not null default 'planned',
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'duration'
  ) then
    execute 'update public.sessions set duration_minutes = coalesce(duration_minutes, duration)';
  end if;

  if exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'session_type'
  ) then
    execute 'update public.sessions set type = coalesce(type, session_type)';
  end if;

  if exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'duration_minutes'
  ) then
    execute 'update public.sessions set duration_minutes = greatest(1, duration_minutes) where duration_minutes is not null';
  end if;
end;
$$;

alter table if exists public.sessions
  alter column duration_minutes set not null;

alter table if exists public.sessions
  drop constraint if exists sessions_status_check;

alter table if exists public.sessions
  add constraint sessions_status_check check (status in ('planned', 'completed', 'skipped'));

alter table if exists public.sessions
  add constraint sessions_distance_unit_check check (distance_unit is null or distance_unit in ('m', 'km', 'mi', 'yd'));

create index if not exists sessions_plan_id_idx on public.sessions(plan_id);
create index if not exists sessions_week_id_idx on public.sessions(week_id);
create index if not exists sessions_date_idx on public.sessions(date);
create index if not exists sessions_user_id_idx on public.sessions(user_id);

-- Data migration: build weeks from plan duration and real session weeks.
with generated_weeks as (
  select
    tp.id as plan_id,
    gs.idx as generated_index,
    (tp.start_date + ((gs.idx - 1) * interval '7 day'))::date as week_start_date
  from public.training_plans tp
  join lateral generate_series(1, greatest(tp.duration_weeks, 1)) as gs(idx) on true
),
existing_session_weeks as (
  select
    s.plan_id,
    (date_trunc('week', s.date::timestamp)::date) as week_start_date
  from public.sessions s
  group by s.plan_id, date_trunc('week', s.date::timestamp)::date
),
all_week_rows as (
  select plan_id, week_start_date from generated_weeks
  union
  select plan_id, week_start_date from existing_session_weeks
),
indexed as (
  select
    plan_id,
    week_start_date,
    row_number() over (partition by plan_id order by week_start_date) as week_index
  from all_week_rows
)
insert into public.training_weeks (plan_id, week_index, week_start_date, focus)
select plan_id, week_index, week_start_date, 'Build'
from indexed
on conflict (plan_id, week_start_date) do nothing;

-- ensure week index sequence is contiguous per plan
with ranked as (
  select
    id,
    row_number() over (partition by plan_id order by week_start_date) as normalized_index
  from public.training_weeks
)
update public.training_weeks tw
set week_index = ranked.normalized_index
from ranked
where tw.id = ranked.id
  and tw.week_index <> ranked.normalized_index;

update public.sessions s
set week_id = tw.id
from public.training_weeks tw
where s.plan_id = tw.plan_id
  and s.date >= tw.week_start_date
  and s.date < tw.week_start_date + 7
  and s.week_id is null;

alter table if exists public.sessions
  alter column week_id set not null;

alter table if exists public.sessions
  drop constraint if exists sessions_week_id_fkey;

alter table if exists public.sessions
  add constraint sessions_week_id_fkey
  foreign key (week_id) references public.training_weeks(id) on delete cascade;

create or replace function public.enforce_session_within_week()
returns trigger
language plpgsql
as $$
declare
  week_start date;
begin
  select tw.week_start_date into week_start
  from public.training_weeks tw
  where tw.id = new.week_id
    and tw.plan_id = new.plan_id;

  if week_start is null then
    raise exception 'Session week does not belong to selected plan';
  end if;

  if new.date < week_start or new.date >= week_start + 7 then
    raise exception 'Session date must be within the selected training week (Mon-Sun)';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_sessions_week_date on public.sessions;
create trigger enforce_sessions_week_date
before insert or update on public.sessions
for each row
execute procedure public.enforce_session_within_week();

-- Replace planned_sessions policy/trigger names after rename.
drop policy if exists "users manage own planned_sessions" on public.sessions;
drop policy if exists "users manage own sessions" on public.sessions;

create policy "users manage own sessions"
  on public.sessions
  using (
    exists (
      select 1
      from public.training_plans tp
      where tp.id = sessions.plan_id and tp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.training_plans tp
      where tp.id = sessions.plan_id and tp.user_id = auth.uid()
    )
  );

drop trigger if exists set_planned_sessions_updated_at on public.sessions;
drop trigger if exists set_sessions_updated_at on public.sessions;
create trigger set_sessions_updated_at
before update on public.sessions
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_training_weeks_updated_at on public.training_weeks;
create trigger set_training_weeks_updated_at
before update on public.training_weeks
for each row
execute procedure public.set_updated_at();
