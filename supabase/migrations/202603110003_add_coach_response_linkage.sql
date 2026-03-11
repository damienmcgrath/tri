alter table public.ai_conversations
  add column if not exists last_response_id text;

alter table public.ai_messages
  add column if not exists response_id text,
  add column if not exists previous_response_id text,
  add column if not exists model text;

create index if not exists ai_conversations_athlete_id_last_response_idx
  on public.ai_conversations(athlete_id, last_response_id)
  where last_response_id is not null;

create index if not exists ai_messages_conversation_id_response_id_idx
  on public.ai_messages(conversation_id, response_id)
  where response_id is not null;
