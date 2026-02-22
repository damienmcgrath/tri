alter table public.session_activity_links
  drop constraint if exists session_activity_links_planned_session_id_fkey;

alter table public.session_activity_links
  add constraint session_activity_links_planned_session_id_fkey
  foreign key (planned_session_id)
  references public.sessions(id)
  on delete cascade;
