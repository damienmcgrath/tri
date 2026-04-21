-- Replace the partial unique index on (athlete_id, block_id) with a regular
-- (non-partial) unique index. PostgREST's `on_conflict` parameter only accepts
-- a column list and cannot express the WHERE predicate required to infer a
-- partial unique index, so block-keyed upserts (refreshProgressReport when a
-- real block is supplied) could not land on the existing constraint and would
-- fail after block date edits. A non-partial index keeps (athlete_id, block_id)
-- unique when block_id is not null and — with default NULLS DISTINCT — leaves
-- legacy rows that still carry block_id NULL unconstrained on this index
-- (their uniqueness is covered by the original UNIQUE(athlete_id, block_start)
-- from 202604200001).

drop index if exists public.progress_reports_athlete_block_id_key;

create unique index if not exists progress_reports_athlete_block_id_key
  on public.progress_reports(athlete_id, block_id);
