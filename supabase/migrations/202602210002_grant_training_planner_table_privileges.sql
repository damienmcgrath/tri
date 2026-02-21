grant select, insert, update, delete on table public.training_weeks to authenticated;
grant select, insert, update, delete on table public.sessions to authenticated;

grant select, insert, update, delete on table public.training_weeks to service_role;
grant select, insert, update, delete on table public.sessions to service_role;
