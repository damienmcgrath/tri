-- Add session_feels table for post-session RPE and subjective feedback capture
create table if not exists public.session_feels (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null references public.sessions(id) on delete cascade,
  rpe          smallint not null check (rpe between 1 and 10),
  note         text check (char_length(note) <= 200),
  was_prompted boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (session_id)
);

-- Index for efficient per-user lookups
create index if not exists session_feels_user_session_idx
  on public.session_feels (user_id, session_id);

-- RLS
alter table public.session_feels enable row level security;

create policy "Users can view their own session feels"
  on public.session_feels for select
  using (user_id = auth.uid());

create policy "Users can insert their own session feels"
  on public.session_feels for insert
  with check (user_id = auth.uid());

create policy "Users can update their own session feels"
  on public.session_feels for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own session feels"
  on public.session_feels for delete
  using (user_id = auth.uid());

-- Grant access to authenticated role
grant select, insert, update, delete on public.session_feels to authenticated;
