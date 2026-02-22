create table if not exists public.activity_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  file_type text not null check (file_type in ('fit','tcx')),
  file_size integer not null check (file_size > 0 and file_size <= 20971520),
  sha256 text not null,
  storage_key text,
  raw_file_base64 text,
  status text not null check (status in ('uploaded','parsed','matched','error')) default 'uploaded',
  error_message text,
  created_at timestamptz not null default now(),
  unique (user_id, sha256)
);

create table if not exists public.completed_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  upload_id uuid references public.activity_uploads(id) on delete set null,
  sport_type text not null,
  start_time_utc timestamptz not null,
  end_time_utc timestamptz,
  duration_sec integer not null check (duration_sec >= 0),
  distance_m numeric(10,2),
  avg_hr integer,
  avg_power integer,
  calories integer,
  source text not null default 'upload' check (source in ('upload')),
  parse_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.session_activity_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_session_id uuid not null references public.planned_sessions(id) on delete cascade,
  completed_activity_id uuid not null references public.completed_activities(id) on delete cascade,
  link_type text not null check (link_type in ('auto','manual')),
  confidence numeric(3,2),
  match_reason jsonb,
  created_at timestamptz not null default now(),
  unique (completed_activity_id)
);

create index if not exists activity_uploads_user_created_idx on public.activity_uploads(user_id, created_at desc);
create index if not exists completed_activities_user_start_idx on public.completed_activities(user_id, start_time_utc desc);
create index if not exists session_activity_links_user_idx on public.session_activity_links(user_id);

alter table public.activity_uploads enable row level security;
alter table public.completed_activities enable row level security;
alter table public.session_activity_links enable row level security;

create policy "activity_uploads_select_own" on public.activity_uploads for select using (auth.uid() = user_id);
create policy "activity_uploads_insert_own" on public.activity_uploads for insert with check (auth.uid() = user_id);
create policy "activity_uploads_update_own" on public.activity_uploads for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "completed_activities_select_own" on public.completed_activities for select using (auth.uid() = user_id);
create policy "completed_activities_insert_own" on public.completed_activities for insert with check (auth.uid() = user_id);
create policy "completed_activities_update_own" on public.completed_activities for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "session_activity_links_select_own" on public.session_activity_links for select using (auth.uid() = user_id);
create policy "session_activity_links_insert_own" on public.session_activity_links for insert with check (auth.uid() = user_id);
create policy "session_activity_links_delete_own" on public.session_activity_links for delete using (auth.uid() = user_id);
