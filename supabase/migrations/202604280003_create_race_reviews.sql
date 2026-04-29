-- AI race review: per-bundle narrative generated post-bundling.
-- One row per race_bundle (uniqueness enforced). Populated by lib/race-review.ts
-- as a fire-and-forget after persistMultisportBundle / attemptRaceBundle return
-- with a confirmed planned race session. Row is also upserted on manual
-- regenerate via POST /api/race-reviews/[bundleId]/regenerate.

create table if not exists public.race_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  race_bundle_id uuid not null references public.race_bundles(id) on delete cascade,
  planned_session_id uuid references public.sessions(id) on delete set null,

  headline text not null,
  narrative text not null,
  coach_take text not null,
  transition_notes text,

  -- Per-leg pacing observations grounded in metrics_v2 halves data.
  -- Shape: { swim?: {...}, bike?: {firstHalfAvgPower, lastHalfAvgPower, deltaPct, note},
  --          run?: {firstHalfPaceSecPerKm, lastHalfPaceSecPerKm, deltaPct, note} }
  pacing_notes jsonb not null default '{}'::jsonb,

  -- Each segment's share of total elapsed time, keyed by role.
  -- Shape: { swim: 0.12, t1: 0.01, bike: 0.45, t2: 0.01, run: 0.41 }
  discipline_distribution_actual jsonb not null default '{}'::jsonb,

  -- Actual minus race_profiles.ideal_discipline_distribution. Null when no
  -- matching race_profile exists for the bundle date. T1/T2 are folded into
  -- bike/run respectively before delta computation since the ideal shape
  -- only carries swim/bike/run/strength.
  discipline_distribution_delta jsonb,

  model_used text not null,
  is_provisional boolean not null default false,

  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (race_bundle_id)
);

create index if not exists race_reviews_user_generated_idx
  on public.race_reviews(user_id, generated_at desc);

alter table public.race_reviews enable row level security;

drop policy if exists "race_reviews_select_own" on public.race_reviews;
create policy "race_reviews_select_own"
on public.race_reviews
for select
using (user_id = auth.uid());

drop policy if exists "race_reviews_insert_own" on public.race_reviews;
create policy "race_reviews_insert_own"
on public.race_reviews
for insert
with check (user_id = auth.uid());

drop policy if exists "race_reviews_update_own" on public.race_reviews;
create policy "race_reviews_update_own"
on public.race_reviews
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "race_reviews_delete_own" on public.race_reviews;
create policy "race_reviews_delete_own"
on public.race_reviews
for delete
using (user_id = auth.uid());

drop trigger if exists set_race_reviews_updated_at on public.race_reviews;
create trigger set_race_reviews_updated_at
before update on public.race_reviews
for each row
execute procedure public.set_updated_at();
