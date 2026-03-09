alter table public.completed_activities
  add column if not exists schedule_status text;

update public.completed_activities ca
set schedule_status = case
  when exists (
    select 1
    from public.session_activity_links sal
    where sal.completed_activity_id = ca.id
      and sal.planned_session_id is not null
  ) then 'scheduled'
  else 'unscheduled'
end
where schedule_status is null
   or schedule_status not in ('scheduled', 'unscheduled');

alter table public.completed_activities
  alter column schedule_status set default 'unscheduled';

alter table public.completed_activities
  alter column schedule_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'completed_activities_schedule_status_check'
      and conrelid = 'public.completed_activities'::regclass
  ) then
    alter table public.completed_activities
      add constraint completed_activities_schedule_status_check
      check (schedule_status in ('scheduled', 'unscheduled'));
  end if;
end $$;
