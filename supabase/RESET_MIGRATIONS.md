# Reset Supabase migrations from scratch (destructive)

This repo now uses a single squashed baseline migration:

- `supabase/migrations/202602220001_baseline_schema.sql`

Use this flow when remote migration history is out of sync and you are OK losing data.

## 1) Reset remote schema + migration history
Run in the Supabase SQL editor against your project:

```sql
drop schema if exists public cascade;
create schema public;

grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

truncate table supabase_migrations.schema_migrations;
```

## 2) Push baseline migration

```bash
supabase db push
```

## 3) Verify

Ensure expected tables/columns exist (example):

- `public.sessions.target`
- `public.sessions.day_order`

## Notes

- This is destructive and intended only when you explicitly want a clean restart.
- After this reset, all future changes should be added as new migrations on top of the baseline file.


## If you still see "permission denied"

After adding new grant migrations, run:

```bash
supabase db push
```

This applies privilege migrations (for example on `completed_sessions`) to remote DBs that were reset manually.
