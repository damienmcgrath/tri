alter table public.completed_activities
  add column if not exists execution_result jsonb;

comment on column public.completed_activities.execution_result is 'AI-generated execution review payload for extra (unplanned) activities that are not linked to a planned session.';
