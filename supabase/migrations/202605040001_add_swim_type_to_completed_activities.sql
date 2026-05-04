-- Adds a `swim_type` classification to completed swim activities so that pool
-- swims and open-water swims can be distinguished in the UI and downstream
-- analytics. See issue #343.

alter table public.completed_activities
  add column if not exists swim_type text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'completed_activities_swim_type_check'
      and conrelid = 'public.completed_activities'::regclass
  ) then
    alter table public.completed_activities
      add constraint completed_activities_swim_type_check
      check (swim_type is null or swim_type in ('pool', 'open_water'));
  end if;
end $$;

-- Backfill: open-water first (more specific signal: subtype text mentions "open").
update public.completed_activities
set swim_type = 'open_water'
where swim_type is null
  and sport_type = 'swim'
  and (
    activity_subtype_raw ilike '%open%'
    or activity_type_raw ilike '%open%'
    or coalesce(metrics_v2->'activity'->>'rawSubType', '') ilike '%open%'
    or coalesce(metrics_v2->'activity'->>'rawType', '') ilike '%open%'
  );

-- Backfill pool: any remaining swim row that has a recorded pool length.
update public.completed_activities
set swim_type = 'pool'
where swim_type is null
  and sport_type = 'swim'
  and pool_length_m is not null;
