create table if not exists public.completed_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  garmin_id text not null,
  date date not null,
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other')),
  metrics jsonb not null default '{}'::jsonb,
  source text not null default 'tcx_import' check (source in ('tcx_import', 'garmin_api')),
  source_file_name text,
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, garmin_id)
);

create table if not exists public.ingestion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('tcx_import', 'garmin_api')),
  file_name text,
  source_hash text,
  status text not null check (status in ('success', 'partial', 'failed')),
  imported_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists completed_sessions_user_id_idx on public.completed_sessions(user_id);
create index if not exists completed_sessions_date_idx on public.completed_sessions(date);
create index if not exists completed_sessions_sport_idx on public.completed_sessions(sport);
create index if not exists ingestion_events_user_id_idx on public.ingestion_events(user_id);
create index if not exists ingestion_events_created_at_idx on public.ingestion_events(created_at desc);

alter table public.completed_sessions enable row level security;
alter table public.ingestion_events enable row level security;

create policy "completed_sessions_select_own"
on public.completed_sessions
for select
using (auth.uid() = user_id);

create policy "completed_sessions_insert_own"
on public.completed_sessions
for insert
with check (auth.uid() = user_id);

create policy "completed_sessions_update_own"
on public.completed_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "completed_sessions_delete_own"
on public.completed_sessions
for delete
using (auth.uid() = user_id);

create policy "ingestion_events_select_own"
on public.ingestion_events
for select
using (auth.uid() = user_id);

create policy "ingestion_events_insert_own"
on public.ingestion_events
for insert
with check (auth.uid() = user_id);

create policy "ingestion_events_update_own"
on public.ingestion_events
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "ingestion_events_delete_own"
on public.ingestion_events
for delete
using (auth.uid() = user_id);

create trigger set_completed_sessions_updated_at
before update on public.completed_sessions
for each row
execute procedure public.set_updated_at();
