-- Phase 1D: Race review AI Layer 4 — Lessons.
--
-- Forward-looking artifacts that turn a single race into permanent training
-- intelligence: athlete-profile takeaways (generalisable patterns),
-- training implications (next-block changes), and a carry-forward (one
-- portable insight surfaced on the next race-week morning).
--
-- One row per race_bundle (uniqueness enforced). When a future race for the
-- same athlete generates new lessons, the prior row is marked superseded so
-- consumers can prefer the most recent reading without losing history.

create table if not exists public.race_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  race_bundle_id uuid not null references public.race_bundles(id) on delete cascade,
  race_review_id uuid references public.race_reviews(id) on delete set null,

  -- 1-3 generalisable patterns about who this athlete is as a racer.
  -- Shape: [{ headline, body, confidence: 'low'|'medium'|'high', referencesCount }]
  athlete_profile_takeaways jsonb not null default '[]'::jsonb,

  -- 1-3 concrete changes for the next training block, each tied to a finding.
  -- Shape: [{ headline, change, priority: 'high'|'medium'|'low', rationale }]
  training_implications jsonb not null default '[]'::jsonb,

  -- One portable insight surfaced during the next race's race-week prep.
  -- Shape: { headline, instruction, successCriterion, expiresAfterRaceId } | null
  carry_forward jsonb,

  -- Prior race bundle ids the lesson draws on (for transparency + audit).
  references_race_ids text[] not null default '{}'::text[],

  -- Set when a future race for the same athlete updates this lesson. The
  -- referenced bundle is the one that *replaced* this reading.
  superseded_by_race_id uuid references public.race_bundles(id) on delete set null,

  model_used text not null,
  is_provisional boolean not null default false,

  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (race_bundle_id)
);

create index if not exists race_lessons_user_generated_idx
  on public.race_lessons(user_id, generated_at desc);

create index if not exists race_lessons_user_active_idx
  on public.race_lessons(user_id, generated_at desc)
  where superseded_by_race_id is null;

alter table public.race_lessons enable row level security;

drop policy if exists "race_lessons_select_own" on public.race_lessons;
create policy "race_lessons_select_own"
on public.race_lessons
for select
using (user_id = auth.uid());

drop policy if exists "race_lessons_insert_own" on public.race_lessons;
create policy "race_lessons_insert_own"
on public.race_lessons
for insert
with check (user_id = auth.uid());

drop policy if exists "race_lessons_update_own" on public.race_lessons;
create policy "race_lessons_update_own"
on public.race_lessons
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "race_lessons_delete_own" on public.race_lessons;
create policy "race_lessons_delete_own"
on public.race_lessons
for delete
using (user_id = auth.uid());

drop trigger if exists set_race_lessons_updated_at on public.race_lessons;
create trigger set_race_lessons_updated_at
before update on public.race_lessons
for each row
execute procedure public.set_updated_at();
