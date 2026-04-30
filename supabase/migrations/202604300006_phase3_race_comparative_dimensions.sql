-- Phase 3 — Race Review: Comparative Dimensions.
--
-- Three sub-features:
--   3.1 Race-to-Race Comparison (pair-keyed → new race_comparisons table)
--   3.2 Training-to-Race Linking (single-race → race_reviews.training_to_race_links)
--   3.3 Pre-race Retrospective    (single-race → race_reviews.pre_race_retrospective)
--
-- 3.2 + 3.3 are eager (computed when the race review is generated).
-- 3.1 is lazy (computed on first request and cached pairwise).

-- ─── 3.2 + 3.3: extend race_reviews ──────────────────────────────────────

alter table public.race_reviews
  add column if not exists training_to_race_links jsonb,    -- 3.2 artifact
  add column if not exists pre_race_retrospective jsonb;    -- 3.3 artifact

-- ─── 3.1: pair-keyed race comparisons ────────────────────────────────────

create table if not exists public.race_comparisons (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  -- "this" race (the one we're viewing)
  race_bundle_id           uuid not null references public.race_bundles(id) on delete cascade,
  -- "compared against" — the prior race
  prior_bundle_id          uuid not null references public.race_bundles(id) on delete cascade,

  -- Deterministic per-leg / finish / IF deltas. Computed from both bundles.
  -- Shape: { thisRace, priorRace, finishDeltaSec, perLeg:{swim,bike,run}, transitionsDelta, preRaceStateDelta }
  comparison_payload       jsonb not null,

  -- AI Layer artifact: { headline, perDiscipline:{swim,bike,run}, netDelta, emergedThemes }
  progression_narrative    jsonb,

  model_used               text,
  is_provisional           boolean not null default false,
  generated_at             timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (race_bundle_id, prior_bundle_id),
  -- Disallow comparing a bundle to itself.
  check (race_bundle_id <> prior_bundle_id)
);

create index if not exists race_comparisons_user_idx
  on public.race_comparisons (user_id, generated_at desc);

create index if not exists race_comparisons_bundle_idx
  on public.race_comparisons (race_bundle_id);

create index if not exists race_comparisons_prior_idx
  on public.race_comparisons (prior_bundle_id);

alter table public.race_comparisons enable row level security;

drop policy if exists "race_comparisons_select_own" on public.race_comparisons;
create policy "race_comparisons_select_own"
on public.race_comparisons
for select
using (user_id = auth.uid());

drop policy if exists "race_comparisons_insert_own" on public.race_comparisons;
create policy "race_comparisons_insert_own"
on public.race_comparisons
for insert
with check (user_id = auth.uid());

drop policy if exists "race_comparisons_update_own" on public.race_comparisons;
create policy "race_comparisons_update_own"
on public.race_comparisons
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "race_comparisons_delete_own" on public.race_comparisons;
create policy "race_comparisons_delete_own"
on public.race_comparisons
for delete
using (user_id = auth.uid());

drop trigger if exists set_race_comparisons_updated_at on public.race_comparisons;
create trigger set_race_comparisons_updated_at
before update on public.race_comparisons
for each row
execute procedure public.set_updated_at();
