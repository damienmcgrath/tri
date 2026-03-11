-- Establish explicit athlete ownership chain (profiles.id == auth.uid())
-- and harden RLS across coaching-relevant tables.

-- 1) Add athlete_id ownership columns.
alter table public.training_plans
  add column if not exists athlete_id uuid references public.profiles(id) on delete cascade;

alter table public.planned_sessions
  add column if not exists athlete_id uuid references public.profiles(id) on delete cascade;

alter table public.completed_sessions
  add column if not exists athlete_id uuid references public.profiles(id) on delete cascade;

alter table public.sessions
  add column if not exists athlete_id uuid references public.profiles(id) on delete cascade;

alter table public.ai_conversations
  add column if not exists athlete_id uuid references public.profiles(id) on delete cascade;

alter table public.ai_messages
  add column if not exists athlete_id uuid references public.profiles(id) on delete cascade;

alter table public.recovery_logs
  add column if not exists athlete_id uuid references public.profiles(id) on delete cascade;

-- 2) Backfill athlete_id from existing ownership data.
update public.training_plans
set athlete_id = coalesce(athlete_id, user_id)
where athlete_id is null;

update public.planned_sessions ps
set user_id = coalesce(ps.user_id, tp.user_id)
from public.training_plans tp
where tp.id = ps.plan_id
  and ps.user_id is null;

update public.planned_sessions
set athlete_id = coalesce(athlete_id, user_id)
where athlete_id is null;

update public.completed_sessions
set athlete_id = coalesce(athlete_id, user_id)
where athlete_id is null;

update public.sessions
set athlete_id = coalesce(athlete_id, user_id)
where athlete_id is null;

update public.ai_conversations
set athlete_id = coalesce(athlete_id, user_id)
where athlete_id is null;

update public.ai_messages m
set athlete_id = coalesce(m.athlete_id, m.user_id, c.athlete_id)
from public.ai_conversations c
where c.id = m.conversation_id
  and m.athlete_id is null;

update public.recovery_logs
set athlete_id = coalesce(athlete_id, user_id)
where athlete_id is null;

-- 3) Secure defaults and constraints for future writes.
alter table public.training_plans
  alter column athlete_id set default auth.uid();
alter table public.planned_sessions
  alter column athlete_id set default auth.uid();
alter table public.completed_sessions
  alter column athlete_id set default auth.uid();
alter table public.sessions
  alter column athlete_id set default auth.uid();
alter table public.ai_conversations
  alter column athlete_id set default auth.uid();
alter table public.ai_messages
  alter column athlete_id set default auth.uid();
alter table public.recovery_logs
  alter column athlete_id set default auth.uid();

alter table public.training_plans
  alter column athlete_id set not null;
alter table public.planned_sessions
  alter column athlete_id set not null;
alter table public.completed_sessions
  alter column athlete_id set not null;
alter table public.sessions
  alter column athlete_id set not null;
alter table public.ai_conversations
  alter column athlete_id set not null;
alter table public.ai_messages
  alter column athlete_id set not null;
alter table public.recovery_logs
  alter column athlete_id set not null;

alter table public.training_plans
  drop constraint if exists training_plans_owner_match_chk;
alter table public.training_plans
  add constraint training_plans_owner_match_chk check (athlete_id = user_id);

alter table public.planned_sessions
  drop constraint if exists planned_sessions_owner_match_chk;
alter table public.planned_sessions
  add constraint planned_sessions_owner_match_chk check (athlete_id = user_id);

alter table public.completed_sessions
  drop constraint if exists completed_sessions_owner_match_chk;
alter table public.completed_sessions
  add constraint completed_sessions_owner_match_chk check (athlete_id = user_id);

alter table public.sessions
  drop constraint if exists sessions_owner_match_chk;
alter table public.sessions
  add constraint sessions_owner_match_chk check (athlete_id = user_id);

alter table public.ai_conversations
  drop constraint if exists ai_conversations_owner_match_chk;
alter table public.ai_conversations
  add constraint ai_conversations_owner_match_chk check (athlete_id = user_id);

alter table public.ai_messages
  drop constraint if exists ai_messages_owner_match_chk;
alter table public.ai_messages
  add constraint ai_messages_owner_match_chk check (athlete_id = user_id);

alter table public.recovery_logs
  drop constraint if exists recovery_logs_owner_match_chk;
alter table public.recovery_logs
  add constraint recovery_logs_owner_match_chk check (athlete_id = user_id);

-- 4) Performance indexes for RLS filters.
create index if not exists training_plans_athlete_id_idx
  on public.training_plans(athlete_id);

create index if not exists planned_sessions_athlete_id_date_idx
  on public.planned_sessions(athlete_id, date);

create index if not exists completed_sessions_athlete_id_date_idx
  on public.completed_sessions(athlete_id, date desc);

create index if not exists sessions_athlete_id_date_idx
  on public.sessions(athlete_id, date);

create index if not exists ai_conversations_athlete_id_updated_at_idx
  on public.ai_conversations(athlete_id, updated_at desc);

create index if not exists ai_messages_athlete_id_created_at_idx
  on public.ai_messages(athlete_id, created_at desc);

create index if not exists coach_plan_change_proposals_athlete_id_created_at_idx
  on public.coach_plan_change_proposals(athlete_id, created_at desc);

create index if not exists recovery_logs_athlete_id_date_idx
  on public.recovery_logs(athlete_id, date desc);

-- 5) Ensure RLS is enabled and policies are explicitly ownership-scoped.
alter table public.training_plans enable row level security;
alter table public.planned_sessions enable row level security;
alter table public.completed_sessions enable row level security;
alter table public.sessions enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.coach_plan_change_proposals enable row level security;
alter table public.recovery_logs enable row level security;


-- Remove legacy broad ownership policies before recreating explicit ones.
drop policy if exists "users manage own training_plans" on public.training_plans;
drop policy if exists "users manage own planned_sessions" on public.planned_sessions;
drop policy if exists "users manage own completed_sessions" on public.completed_sessions;
drop policy if exists "users manage own recovery_logs" on public.recovery_logs;

-- training_plans
 drop policy if exists "training_plans_select_own" on public.training_plans;
create policy "training_plans_select_own"
on public.training_plans
for select
using (athlete_id = auth.uid());

drop policy if exists "training_plans_insert_own" on public.training_plans;
create policy "training_plans_insert_own"
on public.training_plans
for insert
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "training_plans_update_own" on public.training_plans;
create policy "training_plans_update_own"
on public.training_plans
for update
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "training_plans_delete_own" on public.training_plans;
create policy "training_plans_delete_own"
on public.training_plans
for delete
using (athlete_id = auth.uid());

-- planned_sessions
 drop policy if exists "planned_sessions_select_own" on public.planned_sessions;
create policy "planned_sessions_select_own"
on public.planned_sessions
for select
using (athlete_id = auth.uid());

drop policy if exists "planned_sessions_insert_own" on public.planned_sessions;
create policy "planned_sessions_insert_own"
on public.planned_sessions
for insert
with check (
  athlete_id = auth.uid()
  and user_id = auth.uid()
  and exists (
    select 1
    from public.training_plans tp
    where tp.id = planned_sessions.plan_id
      and tp.athlete_id = auth.uid()
  )
);

drop policy if exists "planned_sessions_update_own" on public.planned_sessions;
create policy "planned_sessions_update_own"
on public.planned_sessions
for update
using (athlete_id = auth.uid())
with check (
  athlete_id = auth.uid()
  and user_id = auth.uid()
  and exists (
    select 1
    from public.training_plans tp
    where tp.id = planned_sessions.plan_id
      and tp.athlete_id = auth.uid()
  )
);

drop policy if exists "planned_sessions_delete_own" on public.planned_sessions;
create policy "planned_sessions_delete_own"
on public.planned_sessions
for delete
using (athlete_id = auth.uid());

-- completed_sessions
 drop policy if exists "completed_sessions_select_own" on public.completed_sessions;
create policy "completed_sessions_select_own"
on public.completed_sessions
for select
using (athlete_id = auth.uid());

drop policy if exists "completed_sessions_insert_own" on public.completed_sessions;
create policy "completed_sessions_insert_own"
on public.completed_sessions
for insert
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "completed_sessions_update_own" on public.completed_sessions;
create policy "completed_sessions_update_own"
on public.completed_sessions
for update
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "completed_sessions_delete_own" on public.completed_sessions;
create policy "completed_sessions_delete_own"
on public.completed_sessions
for delete
using (athlete_id = auth.uid());

-- sessions
 drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own"
on public.sessions
for select
using (athlete_id = auth.uid());

drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own"
on public.sessions
for insert
with check (
  athlete_id = auth.uid()
  and user_id = auth.uid()
  and exists (
    select 1
    from public.training_plans tp
    where tp.id = sessions.plan_id
      and tp.athlete_id = auth.uid()
  )
);

drop policy if exists "sessions_update_own" on public.sessions;
create policy "sessions_update_own"
on public.sessions
for update
using (athlete_id = auth.uid())
with check (
  athlete_id = auth.uid()
  and user_id = auth.uid()
  and exists (
    select 1
    from public.training_plans tp
    where tp.id = sessions.plan_id
      and tp.athlete_id = auth.uid()
  )
);

drop policy if exists "sessions_delete_own" on public.sessions;
create policy "sessions_delete_own"
on public.sessions
for delete
using (athlete_id = auth.uid());

-- ai_conversations
 drop policy if exists "ai_conversations_select_own" on public.ai_conversations;
create policy "ai_conversations_select_own"
on public.ai_conversations
for select
using (athlete_id = auth.uid());

drop policy if exists "ai_conversations_insert_own" on public.ai_conversations;
create policy "ai_conversations_insert_own"
on public.ai_conversations
for insert
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "ai_conversations_update_own" on public.ai_conversations;
create policy "ai_conversations_update_own"
on public.ai_conversations
for update
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "ai_conversations_delete_own" on public.ai_conversations;
create policy "ai_conversations_delete_own"
on public.ai_conversations
for delete
using (athlete_id = auth.uid());

-- ai_messages
 drop policy if exists "ai_messages_select_own" on public.ai_messages;
create policy "ai_messages_select_own"
on public.ai_messages
for select
using (
  athlete_id = auth.uid()
  and exists (
    select 1
    from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.athlete_id = auth.uid()
  )
);

drop policy if exists "ai_messages_insert_own" on public.ai_messages;
create policy "ai_messages_insert_own"
on public.ai_messages
for insert
with check (
  athlete_id = auth.uid()
  and user_id = auth.uid()
  and exists (
    select 1
    from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.athlete_id = auth.uid()
  )
);

drop policy if exists "ai_messages_update_own" on public.ai_messages;
create policy "ai_messages_update_own"
on public.ai_messages
for update
using (
  athlete_id = auth.uid()
  and exists (
    select 1
    from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.athlete_id = auth.uid()
  )
)
with check (
  athlete_id = auth.uid()
  and user_id = auth.uid()
  and exists (
    select 1
    from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.athlete_id = auth.uid()
  )
);

drop policy if exists "ai_messages_delete_own" on public.ai_messages;
create policy "ai_messages_delete_own"
on public.ai_messages
for delete
using (
  athlete_id = auth.uid()
  and exists (
    select 1
    from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.athlete_id = auth.uid()
  )
);

-- coach_plan_change_proposals
 drop policy if exists "coach_plan_change_proposals_select_own" on public.coach_plan_change_proposals;
create policy "coach_plan_change_proposals_select_own"
on public.coach_plan_change_proposals
for select
using (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "coach_plan_change_proposals_insert_own" on public.coach_plan_change_proposals;
create policy "coach_plan_change_proposals_insert_own"
on public.coach_plan_change_proposals
for insert
with check (
  athlete_id = auth.uid()
  and user_id = auth.uid()
  and (
    target_session_id is null
    or exists (
      select 1
      from public.sessions s
      where s.id = coach_plan_change_proposals.target_session_id
        and s.athlete_id = auth.uid()
    )
  )
);

drop policy if exists "coach_plan_change_proposals_update_own" on public.coach_plan_change_proposals;
create policy "coach_plan_change_proposals_update_own"
on public.coach_plan_change_proposals
for update
using (athlete_id = auth.uid() and user_id = auth.uid())
with check (
  athlete_id = auth.uid()
  and user_id = auth.uid()
  and (
    target_session_id is null
    or exists (
      select 1
      from public.sessions s
      where s.id = coach_plan_change_proposals.target_session_id
        and s.athlete_id = auth.uid()
    )
  )
);

drop policy if exists "coach_plan_change_proposals_delete_own" on public.coach_plan_change_proposals;
create policy "coach_plan_change_proposals_delete_own"
on public.coach_plan_change_proposals
for delete
using (athlete_id = auth.uid() and user_id = auth.uid());


-- recovery_logs
drop policy if exists "recovery_logs_select_own" on public.recovery_logs;
create policy "recovery_logs_select_own"
on public.recovery_logs
for select
using (athlete_id = auth.uid());

drop policy if exists "recovery_logs_insert_own" on public.recovery_logs;
create policy "recovery_logs_insert_own"
on public.recovery_logs
for insert
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "recovery_logs_update_own" on public.recovery_logs;
create policy "recovery_logs_update_own"
on public.recovery_logs
for update
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid() and user_id = auth.uid());

drop policy if exists "recovery_logs_delete_own" on public.recovery_logs;
create policy "recovery_logs_delete_own"
on public.recovery_logs
for delete
using (athlete_id = auth.uid());
