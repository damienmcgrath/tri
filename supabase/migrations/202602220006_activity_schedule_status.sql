alter table public.completed_activities
  add column if not exists schedule_status text
  check (schedule_status in ('scheduled', 'unscheduled'))
  default 'unscheduled';

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
  alter column schedule_status set not null;

alter table public.session_activity_links
  alter column planned_session_id drop not null;

