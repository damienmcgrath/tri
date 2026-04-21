-- Progress reports can now key on a real training block (preferred)
-- or fall back to a rolling window keyed on block_start (legacy).

alter table public.progress_reports
  add column if not exists block_id uuid references public.training_blocks(id) on delete set null;

create unique index if not exists progress_reports_athlete_block_id_key
  on public.progress_reports(athlete_id, block_id)
  where block_id is not null;

create index if not exists progress_reports_block_id_idx
  on public.progress_reports(block_id);
