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
