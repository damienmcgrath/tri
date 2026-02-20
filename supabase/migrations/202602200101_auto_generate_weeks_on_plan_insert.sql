-- Only create trigger if training_weeks table exists (migration 202602200100 must be applied first)
do $migration$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'training_weeks'
  ) then
    create or replace function public.create_training_weeks_for_plan()
    returns trigger
    language plpgsql
    as $$
    begin
      insert into public.training_weeks (plan_id, week_index, week_start_date, focus)
      select
        new.id,
        gs.week_index,
        (new.start_date + ((gs.week_index - 1) * interval '7 day'))::date,
        'Build'
      from generate_series(1, greatest(new.duration_weeks, 1)) as gs(week_index)
      on conflict (plan_id, week_index) do nothing;

      return new;
    end;
    $$;

    drop trigger if exists create_training_weeks_after_plan_insert on public.training_plans;
    create trigger create_training_weeks_after_plan_insert
    after insert on public.training_plans
    for each row
    execute procedure public.create_training_weeks_for_plan();
  end if;
end;
$migration$;

-- Backfill for any plans that still have no week rows.
-- Only run if training_weeks table exists (migration 202602200100 must be applied first)
do $backfill$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'training_weeks'
  ) then
    insert into public.training_weeks (plan_id, week_index, week_start_date, focus)
    select
      tp.id,
      gs.week_index,
      (tp.start_date + ((gs.week_index - 1) * interval '7 day'))::date,
      'Build'
    from public.training_plans tp
    join lateral generate_series(1, greatest(tp.duration_weeks, 1)) as gs(week_index) on true
    where not exists (
      select 1
      from public.training_weeks tw
      where tw.plan_id = tp.id
    )
    on conflict (plan_id, week_index) do nothing;
  end if;
end;
$backfill$;
