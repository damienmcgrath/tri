create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_conversations_user_id_updated_at_idx
  on public.ai_conversations(user_id, updated_at desc);

create index if not exists ai_messages_conversation_id_created_at_idx
  on public.ai_messages(conversation_id, created_at);

create index if not exists ai_messages_user_id_created_at_idx
  on public.ai_messages(user_id, created_at desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy "ai_conversations_select_own"
on public.ai_conversations
for select
using (auth.uid() = user_id);

create policy "ai_conversations_insert_own"
on public.ai_conversations
for insert
with check (auth.uid() = user_id);

create policy "ai_conversations_update_own"
on public.ai_conversations
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "ai_conversations_delete_own"
on public.ai_conversations
for delete
using (auth.uid() = user_id);

create policy "ai_messages_select_own"
on public.ai_messages
for select
using (auth.uid() = user_id);

create policy "ai_messages_insert_own"
on public.ai_messages
for insert
with check (auth.uid() = user_id);

create policy "ai_messages_update_own"
on public.ai_messages
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "ai_messages_delete_own"
on public.ai_messages
for delete
using (auth.uid() = user_id);

drop trigger if exists set_ai_conversations_updated_at on public.ai_conversations;
create trigger set_ai_conversations_updated_at
before update on public.ai_conversations
for each row
execute procedure public.set_updated_at();
