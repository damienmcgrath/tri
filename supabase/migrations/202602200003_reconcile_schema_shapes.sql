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
