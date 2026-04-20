create table if not exists public.progress_reports (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  block_start date not null,
  block_end date not null,
  status text not null check (status in ('ready', 'stale', 'failed')),
  source_updated_at timestamptz not null,
  generated_at timestamptz not null default now(),
  generation_version integer not null default 1,
  facts jsonb not null default '{}'::jsonb,
  narrative jsonb not null default '{}'::jsonb,
  helpful boolean,
  accurate boolean,
  feedback_note text,
  feedback_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, block_start)
);

create index if not exists progress_reports_athlete_block_idx
  on public.progress_reports(athlete_id, block_start desc);

alter table public.progress_reports enable row level security;

drop policy if exists "progress_reports_select_own" on public.progress_reports;
create policy "progress_reports_select_own"
on public.progress_reports
for select
using (athlete_id = auth.uid());

drop policy if exists "progress_reports_insert_own" on public.progress_reports;
create policy "progress_reports_insert_own"
on public.progress_reports
for insert
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "progress_reports_update_own" on public.progress_reports;
create policy "progress_reports_update_own"
on public.progress_reports
for update
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "progress_reports_delete_own" on public.progress_reports;
create policy "progress_reports_delete_own"
on public.progress_reports
for delete
using (athlete_id = auth.uid());

drop trigger if exists set_progress_reports_updated_at on public.progress_reports;
create trigger set_progress_reports_updated_at
before update on public.progress_reports
for each row
execute procedure public.set_updated_at();
