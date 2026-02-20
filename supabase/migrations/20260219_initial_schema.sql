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
