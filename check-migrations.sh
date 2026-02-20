#!/bin/bash

# Script to check Supabase migration status
# Usage: ./check-migrations.sh

echo "Checking migration status..."
echo ""

# Method 1: Try CLI if password is set
if [ -n "$SUPABASE_DB_PASSWORD" ]; then
  echo "Using Supabase CLI..."
  supabase migration list
else
  echo "SUPABASE_DB_PASSWORD not set. Using alternative methods..."
  echo ""
  echo "To use CLI method:"
  echo "  export SUPABASE_DB_PASSWORD=your_password"
  echo "  supabase migration list"
  echo ""
  echo "Or check via Supabase Dashboard:"
  echo "  1. Go to: https://supabase.com/dashboard/project/ukvgtjvcdkfzmpajfwqh"
  echo "  2. Navigate to: Database → Migrations"
  echo "  3. Or use SQL Editor with:"
  echo "     SELECT version, name, inserted_at FROM supabase_migrations.schema_migrations ORDER BY version;"
fi

echo ""
echo "Local migration files:"
ls -1 supabase/migrations/ | sort
