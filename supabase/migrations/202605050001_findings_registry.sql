-- Findings registry: persists analyzer outputs with versioning and supersession.
--
-- Each row is one finding produced by an analyzer for a session. Analyzers
-- emit a stable `finding_id` per finding type; `(session_id, finding_id,
-- analyzer_version)` is unique so re-running the same analyzer version is
-- idempotent. When a newer analyzer version recomputes, callers can write a
-- new row and link the prior row via `superseded_by` instead of deleting,
-- preserving history while making "active" findings cheap to query through
-- the partial indexes (where superseded_by is null).

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Stable analyzer-defined identifier for the finding type (e.g. 'fade_late').
  finding_id text not null,
  analyzer_id text not null,
  analyzer_version text not null,

  category text not null,
  polarity text not null check (polarity in ('positive', 'observation', 'concern')),
  severity smallint not null check (severity between 0 and 3),

  headline text not null,

  -- Shape: array of evidence objects sourced from the analyzer.
  evidence jsonb not null default '[]'::jsonb,

  reasoning text not null,

  -- Optional structured prescription (next-step recommendation).
  prescription jsonb,

  -- Optional reference to a visual artifact (chart, image url, etc.).
  visual text,

  -- Tags marking findings whose validity depends on caveats (e.g. heat, gps drift).
  conditional_on text[],

  scope text not null check (scope in ('session', 'block', 'segment')),
  scope_ref text,

  generated_at timestamptz not null default now(),

  -- Set when a later finding replaces this one. The replacement row points
  -- back to the prior id so consumers can prefer the most recent reading
  -- without losing the audit trail.
  superseded_by uuid references public.findings(id) on delete set null,

  constraint findings_session_unique unique (session_id, finding_id, analyzer_version)
);

-- Active-only indexes: every consumer query filters out superseded rows, so
-- partial indexes keep them small and cheap.
create index if not exists findings_user_category_active_idx
  on public.findings(user_id, category, generated_at desc)
  where superseded_by is null;

create index if not exists findings_session_active_idx
  on public.findings(session_id)
  where superseded_by is null;

create index if not exists findings_user_polarity_severity_active_idx
  on public.findings(user_id, polarity, severity desc)
  where superseded_by is null;

alter table public.findings enable row level security;

drop policy if exists "findings_select_own" on public.findings;
create policy "findings_select_own"
on public.findings
for select
using (user_id = auth.uid());

-- Inserts come from server-side analyzers running with the service role.
-- The check restricts client-role inserts; service_role bypasses RLS entirely
-- via the role attribute, so this is belt-and-braces against accidental
-- exposure of an authenticated insert path.
drop policy if exists "findings_insert_service_role" on public.findings;
create policy "findings_insert_service_role"
on public.findings
for insert
with check ((auth.jwt() ->> 'role') = 'service_role');
