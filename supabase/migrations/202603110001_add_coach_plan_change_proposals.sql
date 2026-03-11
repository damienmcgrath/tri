create extension if not exists pgcrypto;

create table if not exists public.coach_plan_change_proposals (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_session_id uuid references public.sessions(id) on delete set null,
  title text not null,
  rationale text not null,
  change_summary text not null,
  proposed_date date,
  proposed_duration_minutes integer check (proposed_duration_minutes is null or proposed_duration_minutes > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_plan_change_proposals_user_id_idx
  on public.coach_plan_change_proposals(user_id, created_at desc);

alter table public.coach_plan_change_proposals enable row level security;

drop policy if exists "coach_plan_change_proposals_select_own" on public.coach_plan_change_proposals;
create policy "coach_plan_change_proposals_select_own"
on public.coach_plan_change_proposals
for select
using (auth.uid() = user_id);

drop policy if exists "coach_plan_change_proposals_insert_own" on public.coach_plan_change_proposals;
create policy "coach_plan_change_proposals_insert_own"
on public.coach_plan_change_proposals
for insert
with check (auth.uid() = user_id and auth.uid() = athlete_id);

drop policy if exists "coach_plan_change_proposals_update_own" on public.coach_plan_change_proposals;
create policy "coach_plan_change_proposals_update_own"
on public.coach_plan_change_proposals
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "coach_plan_change_proposals_delete_own" on public.coach_plan_change_proposals;
create policy "coach_plan_change_proposals_delete_own"
on public.coach_plan_change_proposals
for delete
using (auth.uid() = user_id);

drop trigger if exists set_coach_plan_change_proposals_updated_at on public.coach_plan_change_proposals;
create trigger set_coach_plan_change_proposals_updated_at
before update on public.coach_plan_change_proposals
for each row
execute procedure public.set_updated_at();
