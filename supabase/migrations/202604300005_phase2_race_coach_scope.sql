-- Phase 2 — Race Review: Interrogation Layer.
--
-- Lets a coach conversation be scoped to a specific race bundle. When set,
-- the chat-flow loads the full race object into context and exposes
-- race-scoped tools to the model. Deleting a bundle nulls the scope rather
-- than cascading the conversation away — chat history outlives the race.
--
-- Citations are persisted on each assistant message so they survive page
-- reload and can be replayed for audit.

alter table public.ai_conversations
  add column if not exists race_bundle_id uuid
    references public.race_bundles(id) on delete set null;

create index if not exists ai_conversations_user_race_idx
  on public.ai_conversations(user_id, race_bundle_id)
  where race_bundle_id is not null;

-- Citations attached to assistant messages. Shape:
--   [{ type, refId, label }]
-- where type is one of:
--   'segment' | 'reference_frame' | 'lesson' | 'pre_race' | 'subjective'
--   | 'prior_race' | 'best_comparable_training'
alter table public.ai_messages
  add column if not exists citations jsonb not null default '[]'::jsonb;
