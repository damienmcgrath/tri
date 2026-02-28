alter table if exists public.sessions
  add column if not exists is_key boolean not null default false;

comment on column public.sessions.is_key is 'Manual key-session flag used across plan, calendar, and dashboard.';
