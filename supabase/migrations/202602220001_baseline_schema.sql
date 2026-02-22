-- Baseline migration squashed on 2026-02-22.
-- This replaces historical migration chain and is intended for fresh environments.

-- ===== BEGIN 202602190001_create_training_plan_tables.sql =====
create extension if not exists pgcrypto;

create table if not exists public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  start_date date not null,
  duration_weeks integer not null check (duration_weeks > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other')),
  type text not null,
  duration integer not null check (duration > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists training_plans_user_id_idx on public.training_plans(user_id);
create index if not exists planned_sessions_plan_id_idx on public.planned_sessions(plan_id);
create index if not exists planned_sessions_user_id_idx on public.planned_sessions(user_id);
create index if not exists planned_sessions_date_idx on public.planned_sessions(date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_training_plans_updated_at on public.training_plans;
create trigger set_training_plans_updated_at
before update on public.training_plans
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_planned_sessions_updated_at on public.planned_sessions;
create trigger set_planned_sessions_updated_at
before update on public.planned_sessions
for each row
execute procedure public.set_updated_at();

alter table public.training_plans enable row level security;
alter table public.planned_sessions enable row level security;

create policy "training_plans_select_own"
on public.training_plans
for select
using (auth.uid() = user_id);

create policy "training_plans_insert_own"
on public.training_plans
for insert
with check (auth.uid() = user_id);

create policy "training_plans_update_own"
on public.training_plans
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "training_plans_delete_own"
on public.training_plans
for delete
using (auth.uid() = user_id);

create policy "planned_sessions_select_own"
on public.planned_sessions
for select
using (auth.uid() = user_id);

create policy "planned_sessions_insert_own"
on public.planned_sessions
for insert
with check (auth.uid() = user_id);

create policy "planned_sessions_update_own"
on public.planned_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "planned_sessions_delete_own"
on public.planned_sessions
for delete
using (auth.uid() = user_id);
-- ===== END 202602190001_create_training_plan_tables.sql =====

-- ===== BEGIN 20260219_initial_schema.sql =====
create extension if not exists "pgcrypto";

create table if not exists public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  start_date date not null,
  duration_weeks int not null check (duration_weeks > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  date date not null,
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other')),
  session_type text not null,
  duration_minutes int not null check (duration_minutes > 0),
  intensity text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.completed_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  garmin_id text,
  date date not null,
  sport text not null,
  metrics jsonb not null default '{}'::jsonb,
  completion_status text not null default 'completed' check (completion_status in ('completed', 'missed', 'partial')),
  created_at timestamptz not null default now()
);

create unique index if not exists completed_sessions_user_garmin_key
  on public.completed_sessions (user_id, garmin_id)
  where garmin_id is not null;

create table if not exists public.recovery_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  sleep_hours numeric(4,2),
  fatigue_level int check (fatigue_level between 1 and 5),
  soreness_areas text[],
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.training_plans enable row level security;
alter table public.planned_sessions enable row level security;
alter table public.completed_sessions enable row level security;
alter table public.recovery_logs enable row level security;

drop policy if exists "users manage own training_plans" on public.training_plans;
create policy "users manage own training_plans"
  on public.training_plans
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users manage own planned_sessions" on public.planned_sessions;
create policy "users manage own planned_sessions"
  on public.planned_sessions
  using (
    exists (
      select 1
      from public.training_plans tp
      where tp.id = planned_sessions.plan_id and tp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.training_plans tp
      where tp.id = planned_sessions.plan_id and tp.user_id = auth.uid()
    )
  );

drop policy if exists "users manage own completed_sessions" on public.completed_sessions;
create policy "users manage own completed_sessions"
  on public.completed_sessions
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users manage own recovery_logs" on public.recovery_logs;
create policy "users manage own recovery_logs"
  on public.recovery_logs
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- ===== END 20260219_initial_schema.sql =====

-- ===== BEGIN 202602200001_create_completed_sessions_ingestion_tables.sql =====
create table if not exists public.completed_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  garmin_id text not null,
  date date not null,
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other')),
  metrics jsonb not null default '{}'::jsonb,
  source text not null default 'tcx_import' check (source in ('tcx_import', 'garmin_api')),
  source_file_name text,
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, garmin_id)
);

create table if not exists public.ingestion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('tcx_import', 'garmin_api')),
  file_name text,
  source_hash text,
  status text not null check (status in ('success', 'partial', 'failed')),
  imported_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists completed_sessions_user_id_idx on public.completed_sessions(user_id);
create index if not exists completed_sessions_date_idx on public.completed_sessions(date);
create index if not exists completed_sessions_sport_idx on public.completed_sessions(sport);
create index if not exists ingestion_events_user_id_idx on public.ingestion_events(user_id);
create index if not exists ingestion_events_created_at_idx on public.ingestion_events(created_at desc);

alter table public.completed_sessions enable row level security;
alter table public.ingestion_events enable row level security;

create policy "completed_sessions_select_own"
on public.completed_sessions
for select
using (auth.uid() = user_id);

create policy "completed_sessions_insert_own"
on public.completed_sessions
for insert
with check (auth.uid() = user_id);

create policy "completed_sessions_update_own"
on public.completed_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "completed_sessions_delete_own"
on public.completed_sessions
for delete
using (auth.uid() = user_id);

create policy "ingestion_events_select_own"
on public.ingestion_events
for select
using (auth.uid() = user_id);

create policy "ingestion_events_insert_own"
on public.ingestion_events
for insert
with check (auth.uid() = user_id);

create policy "ingestion_events_update_own"
on public.ingestion_events
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "ingestion_events_delete_own"
on public.ingestion_events
for delete
using (auth.uid() = user_id);

create trigger set_completed_sessions_updated_at
before update on public.completed_sessions
for each row
execute procedure public.set_updated_at();
-- ===== END 202602200001_create_completed_sessions_ingestion_tables.sql =====

-- ===== BEGIN 202602200002_create_ai_coach_tables.sql =====
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_conversations_user_id_updated_at_idx
  on public.ai_conversations(user_id, updated_at desc);

create index if not exists ai_messages_conversation_id_created_at_idx
  on public.ai_messages(conversation_id, created_at);

create index if not exists ai_messages_user_id_created_at_idx
  on public.ai_messages(user_id, created_at desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy "ai_conversations_select_own"
on public.ai_conversations
for select
using (auth.uid() = user_id);

create policy "ai_conversations_insert_own"
on public.ai_conversations
for insert
with check (auth.uid() = user_id);

create policy "ai_conversations_update_own"
on public.ai_conversations
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "ai_conversations_delete_own"
on public.ai_conversations
for delete
using (auth.uid() = user_id);

create policy "ai_messages_select_own"
on public.ai_messages
for select
using (auth.uid() = user_id);

create policy "ai_messages_insert_own"
on public.ai_messages
for insert
with check (auth.uid() = user_id);

create policy "ai_messages_update_own"
on public.ai_messages
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "ai_messages_delete_own"
on public.ai_messages
for delete
using (auth.uid() = user_id);

drop trigger if exists set_ai_conversations_updated_at on public.ai_conversations;
create trigger set_ai_conversations_updated_at
before update on public.ai_conversations
for each row
execute procedure public.set_updated_at();
-- ===== END 202602200002_create_ai_coach_tables.sql =====

-- ===== BEGIN 202602200003_reconcile_schema_shapes.sql =====
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

alter table public.training_plans
  add column if not exists updated_at timestamptz not null default now();

alter table public.planned_sessions
  add column if not exists user_id uuid,
  add column if not exists type text,
  add column if not exists duration integer,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'planned_sessions'
      and column_name = 'session_type'
  ) then
    execute 'update public.planned_sessions set type = coalesce(type, session_type)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'planned_sessions'
      and column_name = 'duration_minutes'
  ) then
    execute 'update public.planned_sessions set duration = coalesce(duration, duration_minutes)';
  end if;
end;
$$;

update public.planned_sessions ps
set user_id = tp.user_id
from public.training_plans tp
where ps.plan_id = tp.id
  and ps.user_id is null;

alter table public.planned_sessions
  alter column user_id set not null,
  alter column type set not null,
  alter column duration set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'planned_sessions_user_id_fkey'
  ) then
    alter table public.planned_sessions
      add constraint planned_sessions_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

create index if not exists planned_sessions_user_id_idx on public.planned_sessions(user_id);
create index if not exists planned_sessions_date_idx on public.planned_sessions(date);

alter table public.completed_sessions
  add column if not exists source text not null default 'tcx_import',
  add column if not exists source_file_name text,
  add column if not exists source_hash text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.completed_sessions
  drop constraint if exists completed_sessions_source_check;

alter table public.completed_sessions
  add constraint completed_sessions_source_check
  check (source in ('tcx_import', 'garmin_api'));

create unique index if not exists completed_sessions_user_garmin_key
  on public.completed_sessions (user_id, garmin_id)
  where garmin_id is not null;

create index if not exists completed_sessions_user_id_idx on public.completed_sessions(user_id);
create index if not exists completed_sessions_date_idx on public.completed_sessions(date);
create index if not exists completed_sessions_sport_idx on public.completed_sessions(sport);

drop trigger if exists set_training_plans_updated_at on public.training_plans;
create trigger set_training_plans_updated_at
before update on public.training_plans
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_planned_sessions_updated_at on public.planned_sessions;
create trigger set_planned_sessions_updated_at
before update on public.planned_sessions
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_completed_sessions_updated_at on public.completed_sessions;
create trigger set_completed_sessions_updated_at
before update on public.completed_sessions
for each row
execute procedure public.set_updated_at();
-- ===== END 202602200003_reconcile_schema_shapes.sql =====

-- ===== BEGIN 202602200004_create_profiles_and_race_settings.sql =====
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  race_name text,
  race_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
on public.profiles
for delete
using (auth.uid() = id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute procedure public.set_updated_at();
-- ===== END 202602200004_create_profiles_and_race_settings.sql =====

-- ===== BEGIN 202602200005_reconcile_planned_sessions_legacy_columns.sql =====
create extension if not exists pgcrypto;

alter table if exists public.planned_sessions
  add column if not exists user_id uuid,
  add column if not exists type text,
  add column if not exists duration integer,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'planned_sessions'
      and column_name = 'session_type'
  ) then
    execute 'update public.planned_sessions set type = coalesce(type, session_type)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'planned_sessions'
      and column_name = 'duration_minutes'
  ) then
    execute 'update public.planned_sessions set duration = coalesce(duration, duration_minutes)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'planned_sessions'
      and column_name = 'intensity'
  ) then
    execute 'update public.planned_sessions set notes = coalesce(notes, intensity)';
  end if;
end;
$$;

update public.planned_sessions ps
set user_id = tp.user_id
from public.training_plans tp
where ps.plan_id = tp.id
  and ps.user_id is null;

update public.planned_sessions
set type = 'Session'
where type is null;

update public.planned_sessions
set duration = 30
where duration is null;

alter table if exists public.planned_sessions
  alter column user_id set not null,
  alter column type set not null,
  alter column duration set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'planned_sessions_user_id_fkey'
  ) then
    alter table public.planned_sessions
      add constraint planned_sessions_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

create index if not exists planned_sessions_plan_id_idx on public.planned_sessions(plan_id);
create index if not exists planned_sessions_user_id_idx on public.planned_sessions(user_id);
create index if not exists planned_sessions_date_idx on public.planned_sessions(date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_planned_sessions_updated_at on public.planned_sessions;
create trigger set_planned_sessions_updated_at
before update on public.planned_sessions
for each row
execute procedure public.set_updated_at();
-- ===== END 202602200005_reconcile_planned_sessions_legacy_columns.sql =====

-- ===== BEGIN 202602210001_create_training_weeks_and_sessions.sql =====
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
-- ===== END 202602210001_create_training_weeks_and_sessions.sql =====

-- ===== BEGIN 202602210002_grant_training_planner_table_privileges.sql =====
grant select, insert, update, delete on table public.training_weeks to authenticated;
grant select, insert, update, delete on table public.sessions to authenticated;

grant select, insert, update, delete on table public.training_weeks to service_role;
grant select, insert, update, delete on table public.sessions to service_role;
-- ===== END 202602210002_grant_training_planner_table_privileges.sql =====

-- ===== BEGIN 202602210003_add_session_target_and_day_order.sql =====
alter table if exists public.sessions
  add column if not exists target text,
  add column if not exists day_order integer not null default 0;

create index if not exists sessions_week_day_order_idx on public.sessions(week_id, date, day_order);

update public.sessions
set day_order = ranked.day_order
from (
  select id, row_number() over (partition by week_id, date order by created_at, id) - 1 as day_order
  from public.sessions
) as ranked
where ranked.id = sessions.id;
-- ===== END 202602210003_add_session_target_and_day_order.sql =====
