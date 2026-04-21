-- Plan → Block → Week → Session tree.
--
-- Before this migration, training_blocks and training_weeks were siblings
-- both hanging off training_plans. Block assignment was re-derived every
-- read via date-range overlap. This migration makes weeks a formal child
-- of blocks via FK, and backfills the link for existing data.

alter table public.training_weeks
  add column if not exists block_id uuid references public.training_blocks(id) on delete set null;

create index if not exists training_weeks_block_id_idx on public.training_weeks(block_id);

-- Backfill: assign each week to the block whose date range covers its
-- week_start_date, matching on the same plan.
update public.training_weeks w
set block_id = b.id
from public.training_blocks b
where w.block_id is null
  and b.plan_id = w.plan_id
  and w.week_start_date between b.start_date and b.end_date;
