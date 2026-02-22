create table if not exists public.session_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength')),
  type text not null,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 480),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_templates_name_not_blank check (length(btrim(name)) > 0),
  constraint session_templates_type_not_blank check (length(btrim(type)) > 0)
);

create index if not exists session_templates_user_id_idx on public.session_templates(user_id);
create index if not exists session_templates_user_id_name_idx on public.session_templates(user_id, name);

alter table public.session_templates enable row level security;

drop policy if exists "session_templates_select_own" on public.session_templates;
create policy "session_templates_select_own"
on public.session_templates
for select
using (auth.uid() = user_id);

drop policy if exists "session_templates_insert_own" on public.session_templates;
create policy "session_templates_insert_own"
on public.session_templates
for insert
with check (auth.uid() = user_id);

drop policy if exists "session_templates_update_own" on public.session_templates;
create policy "session_templates_update_own"
on public.session_templates
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "session_templates_delete_own" on public.session_templates;
create policy "session_templates_delete_own"
on public.session_templates
for delete
using (auth.uid() = user_id);

drop trigger if exists set_session_templates_updated_at on public.session_templates;
create trigger set_session_templates_updated_at
before update on public.session_templates
for each row
execute procedure public.set_updated_at();
