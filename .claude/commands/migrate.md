Create and apply a new Supabase database migration.

Arguments: $ARGUMENTS (brief description of what this migration does)

Steps:

1. Generate a timestamp prefix: `date -u +"%Y%m%d%H%M"` (format: YYYYMMDDHHММ).
2. Slugify the description from $ARGUMENTS (lowercase, underscores, no special chars).
3. Create the migration file at `supabase/migrations/<timestamp>_<slug>.sql`.
4. Write the SQL for the migration based on $ARGUMENTS and current context. Include both the change and any necessary RLS policy updates.
5. Apply with `supabase db push` and confirm success.
6. Run `npx supabase gen types typescript --local > lib/supabase/database.types.ts` to regenerate TypeScript types if the schema changed.
7. Report what was created and any follow-up steps needed (e.g. updating queries that reference changed tables).

If no description is provided in $ARGUMENTS, ask what the migration should do before proceeding.
