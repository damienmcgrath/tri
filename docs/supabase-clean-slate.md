# Supabase clean-slate reset (linked remote project)

This runbook is for when migration history is badly drifted and you want to start over.

> **Warning**: This is destructive and will delete database objects/data in the linked project.

## Preconditions

- Supabase CLI installed and logged in.
- Project is linked (`supabase link ...`).
- `SUPABASE_DB_PASSWORD` exported.

## Optional backups before reset

If you want a safety net before deleting data, use CLI-supported dump flags:

```bash
# Full database dump (schema + data)
supabase db dump --linked -f backup-full.sql

# Data-only dump
supabase db dump --linked --data-only -f backup-data.sql
```

> Note: `supabase db dump` does **not** support `--schema-only`.

## Fast path (script)

```bash
SUPABASE_DB_PASSWORD=your_db_password ./scripts/reset-linked-supabase-migrations.sh
```

What it does:
1. Shows current migration list.
2. Drops all `public` schema tables/sequences/functions/types.
3. Clears `supabase_migrations.schema_migrations`.
4. Runs `supabase db push --linked`.
5. Shows final migration list.

## Manual commands

```bash
supabase migration list
```

```sql
-- Run in supabase db query / SQL editor
DELETE FROM supabase_migrations.schema_migrations;
```

```bash
supabase db push --linked
supabase migration list
```

## Notes

- If you still hit drift after reset, create a new single baseline migration locally and archive old reconcile migrations.
- For production environments, take a dump before destructive operations.
