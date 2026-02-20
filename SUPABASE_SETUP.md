# Supabase setup guide (TriCoach AI)

Use this checklist after creating your Supabase account.

## 1) Create a Supabase project

1. In Supabase dashboard, click **New project**.
2. Choose your org, set a strong DB password, and pick a region close to your users.
3. Wait for project provisioning to finish.

## 2) Collect your project credentials

From **Project Settings → API**, copy:

- `Project URL`
- `publishable` key (`sb_publishable_...`)
- `service_role` key (server-side only, never expose in client code)

## 3) Configure local environment variables

1. Copy `.env.example` to `.env.local`.
2. Fill in the Supabase values:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=... # legacy fallback
SUPABASE_SERVICE_ROLE_KEY=...
```

`NEXT_PUBLIC_*` vars are safe for browser usage; `SUPABASE_SERVICE_ROLE_KEY` must stay server-only.

## 4) Start the app

```bash
npm install
npm run dev
```

The app already includes Supabase client helpers in `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts`.

## 5) Enable authentication

In Supabase dashboard:

1. Go to **Authentication → Providers**.
2. Enable **Email** first.
3. Optionally enable Google/GitHub OAuth later.
4. Add your local callback URLs during development (for example `http://localhost:3000`).

## 6) Create initial schema

Run this in **SQL Editor**:

```sql
create table if not exists public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

alter table public.training_plans enable row level security;

create policy "Users can read own plans"
  on public.training_plans
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own plans"
  on public.training_plans
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own plans"
  on public.training_plans
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own plans"
  on public.training_plans
  for delete
  using (auth.uid() = user_id);
```

## 7) Smoke-test DB access from app

After sign-in, test a simple query from a server component or API route with the Supabase server client.

## 8) Production checklist

- Add the same env vars in your hosting provider (for example Vercel).
- Restrict auth redirect URLs to your real domains.
- Rotate keys if they are ever exposed.
- Keep `service_role` key out of client bundles and logs.

## 9) Reliable CLI migration workflow (recommended)

Use this sequence instead of a blind `db push`:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase migration list --linked
npx supabase db push --linked --include-all
npx supabase migration list --linked
```

Why this works better:
- `--linked` ensures commands target the currently linked remote project.
- `migration list` shows what Supabase thinks is applied remotely vs local files.
- `--include-all` helps when remote migration history got out of sync.

If you manually ran SQL in Supabase UI and need to reconcile migration history:

```bash
npx supabase migration repair --status applied 202602200100
npx supabase migration repair --status applied 202602200101
npx supabase migration list --linked
```

If a migration is marked applied but you need CLI to run it again, mark it reverted first:

```bash
npx supabase migration repair --status reverted <version>
npx supabase db push --linked --include-all
```
