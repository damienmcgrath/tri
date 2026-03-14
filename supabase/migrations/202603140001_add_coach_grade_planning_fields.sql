alter table public.training_weeks
  add column if not exists objective text,
  add column if not exists primary_emphasis text;

comment on column public.training_weeks.objective is 'Athlete-facing weekly objective for the programming rationale view.';
comment on column public.training_weeks.primary_emphasis is 'Primary training emphasis for the week summary.';

alter table public.sessions
  add column if not exists intent_summary text,
  add column if not exists is_protected boolean not null default false,
  add column if not exists is_flexible boolean not null default false;

comment on column public.sessions.intent_summary is 'Short athlete-facing description of the planned session intent.';
comment on column public.sessions.is_protected is 'Whether this session should stay fixed to protect weekly intent.';
comment on column public.sessions.is_flexible is 'Whether this session can move or drop without losing weekly intent.';
