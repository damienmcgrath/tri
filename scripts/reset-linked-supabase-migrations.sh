#!/usr/bin/env bash
set -euo pipefail

# Destructive reset flow for a linked Supabase project.
# - Wipes public schema objects
# - Clears Supabase migration history
# - Pushes local migrations as fresh baseline
#
# Usage:
#   SUPABASE_DB_PASSWORD=... ./scripts/reset-linked-supabase-migrations.sh

if ! command -v supabase >/dev/null 2>&1; then
  echo "Error: Supabase CLI is not installed or not in PATH." >&2
  exit 1
fi

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "Error: SUPABASE_DB_PASSWORD is required for linked project operations." >&2
  exit 1
fi

echo "==> Confirming linked project"
supabase status >/dev/null || true

echo "==> Listing migrations before reset"
supabase migration list || true

echo "==> Wiping public schema and migration history (DESTRUCTIVE)"
supabase db query <<'SQL'
DO $$
DECLARE
  obj RECORD;
BEGIN
  FOR obj IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', obj.schemaname, obj.tablename);
  END LOOP;

  FOR obj IN
    SELECT n.nspname AS schema_name, c.relname AS sequence_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S' AND n.nspname = 'public'
  LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS %I.%I CASCADE', obj.schema_name, obj.sequence_name);
  END LOOP;

  FOR obj IN
    SELECT routine_schema, routine_name
    FROM information_schema.routines
    WHERE routine_schema = 'public'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I CASCADE', obj.routine_schema, obj.routine_name);
  END LOOP;

  FOR obj IN
    SELECT n.nspname AS schema_name, t.typname AS type_name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e', 'c')
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS %I.%I CASCADE', obj.schema_name, obj.type_name);
  END LOOP;
END $$;

DELETE FROM supabase_migrations.schema_migrations;
SQL

echo "==> Pushing local migrations as fresh baseline"
supabase db push --linked

echo "==> Listing migrations after reset"
supabase migration list

echo "Done. Linked project has been reset and re-seeded from local migrations."
