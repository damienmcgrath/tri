-- Add adaptations table for AI-driven and rule-based training adaptations
create table if not exists public.adaptations (
  id                  uuid primary key default gen_random_uuid(),
  athlete_id          uuid not null references auth.users(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  week_id             uuid references public.training_weeks(id) on delete set null,
  trigger_type        text not null,
  trigger_session_id  uuid references public.sessions(id) on delete set null,
  options             jsonb not null default '[]'::jsonb,
  selected_option     jsonb,
  status              text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  model_used          text,
  created_at          timestamptz not null default now(),
  applied_at          timestamptz
);

-- Index for efficient per-athlete/week/status lookups
create index if not exists adaptations_athlete_week_status_idx
  on public.adaptations (athlete_id, week_id, status);

-- RLS
alter table public.adaptations enable row level security;

create policy "Athletes can view their own adaptations"
  on public.adaptations for select
  using (athlete_id = auth.uid());

create policy "Athletes can insert their own adaptations"
  on public.adaptations for insert
  with check (athlete_id = auth.uid());

create policy "Athletes can update their own adaptations"
  on public.adaptations for update
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

create policy "Athletes can delete their own adaptations"
  on public.adaptations for delete
  using (athlete_id = auth.uid());

-- Grant access to authenticated role
grant select, insert, update, delete on public.adaptations to authenticated;
