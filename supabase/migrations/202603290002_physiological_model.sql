-- Physiological model: session load tracking, daily aggregation, and rolling fitness (CTL/ATL/TSB)

-- Per-activity training load record
create table if not exists public.session_load (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  activity_id     uuid references public.completed_activities(id) on delete cascade,
  session_id      uuid references public.sessions(id) on delete set null,
  sport           text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other')),
  date            date not null,
  tss             numeric(6,1),
  tss_source      text not null default 'duration_estimate'
                  check (tss_source in ('device', 'power', 'hr', 'pace', 'duration_estimate')),
  duration_sec    integer,
  intensity_factor numeric(4,3),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One load record per activity per user
create unique index if not exists session_load_user_activity_uniq
  on public.session_load (user_id, activity_id)
  where activity_id is not null;

-- Lookups by user + date range (for daily aggregation and fitness rebuild)
create index if not exists session_load_user_date_idx
  on public.session_load (user_id, date);

-- Lookups by user + sport + date (for per-discipline aggregation)
create index if not exists session_load_user_sport_date_idx
  on public.session_load (user_id, sport, date);

alter table public.session_load enable row level security;

create policy "Users can view their own session loads"
  on public.session_load for select
  using (user_id = auth.uid());

create policy "Users can insert their own session loads"
  on public.session_load for insert
  with check (user_id = auth.uid());

create policy "Users can update their own session loads"
  on public.session_load for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own session loads"
  on public.session_load for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.session_load to authenticated;

-- Daily load aggregation per discipline + total
create table if not exists public.daily_load (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  date            date not null,
  sport           text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other', 'total')),
  tss             numeric(6,1) not null default 0,
  session_count   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists daily_load_user_date_sport_uniq
  on public.daily_load (user_id, date, sport);

create index if not exists daily_load_user_date_idx
  on public.daily_load (user_id, date);

alter table public.daily_load enable row level security;

create policy "Users can view their own daily loads"
  on public.daily_load for select
  using (user_id = auth.uid());

create policy "Users can insert their own daily loads"
  on public.daily_load for insert
  with check (user_id = auth.uid());

create policy "Users can update their own daily loads"
  on public.daily_load for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own daily loads"
  on public.daily_load for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.daily_load to authenticated;

-- Rolling fitness model snapshot (CTL / ATL / TSB per discipline + total)
create table if not exists public.athlete_fitness (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  date            date not null,
  sport           text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other', 'total')),
  ctl             numeric(6,1) not null default 0,
  atl             numeric(6,1) not null default 0,
  tsb             numeric(6,1) not null default 0,
  ramp_rate       numeric(5,2),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists athlete_fitness_user_date_sport_uniq
  on public.athlete_fitness (user_id, date, sport);

-- Latest fitness snapshot per user + sport
create index if not exists athlete_fitness_user_sport_date_idx
  on public.athlete_fitness (user_id, sport, date desc);

alter table public.athlete_fitness enable row level security;

create policy "Users can view their own fitness data"
  on public.athlete_fitness for select
  using (user_id = auth.uid());

create policy "Users can insert their own fitness data"
  on public.athlete_fitness for insert
  with check (user_id = auth.uid());

create policy "Users can update their own fitness data"
  on public.athlete_fitness for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own fitness data"
  on public.athlete_fitness for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.athlete_fitness to authenticated;
