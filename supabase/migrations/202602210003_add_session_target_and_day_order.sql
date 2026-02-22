alter table if exists public.sessions
  add column if not exists target text,
  add column if not exists day_order integer not null default 0;

create index if not exists sessions_week_day_order_idx on public.sessions(week_id, date, day_order);

update public.sessions
set day_order = ranked.day_order
from (
  select id, row_number() over (partition by week_id, date order by created_at, id) - 1 as day_order
  from public.sessions
) as ranked
where ranked.id = sessions.id;
