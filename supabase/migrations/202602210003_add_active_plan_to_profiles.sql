alter table public.profiles
  add column if not exists active_plan_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_active_plan_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_active_plan_id_fkey
      foreign key (active_plan_id) references public.training_plans(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists profiles_active_plan_id_idx on public.profiles(active_plan_id);
