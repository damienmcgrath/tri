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
