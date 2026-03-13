alter table public.sessions
  add column if not exists session_name text,
  add column if not exists discipline text,
  add column if not exists subtype text,
  add column if not exists workout_type text,
  add column if not exists intent_category text,
  add column if not exists session_role text
    check (session_role is null or session_role in ('key', 'supporting', 'recovery', 'optional')),
  add column if not exists source_metadata jsonb,
  add column if not exists execution_result jsonb;

update public.sessions
set session_name = coalesce(session_name, type),
    discipline = coalesce(discipline, sport),
    subtype = coalesce(subtype, type),
    workout_type = coalesce(workout_type, type)
where session_name is null
   or discipline is null
   or subtype is null
   or workout_type is null;

comment on column public.sessions.execution_result is 'Persisted execution review payload for completed and linked sessions.';
comment on column public.sessions.intent_category is 'Planned training intent label used for execution diagnosis and review.';
