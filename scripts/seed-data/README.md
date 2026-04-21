# Historical Plan Seed — D McG 2026

One-off tooling to seed a real user account with the full 2026 Half Ironman
plan (Nov 2025 → Jun 2026), then backfill Strava activities and AI content
against it.

## Files

- `types.ts` — season → block → week → session type definitions
- `plan-2026.ts` — the declarative plan (31 weeks, 4 blocks, ~220 sessions).
  Transcribed from the spreadsheet screenshot with these splitting rules:
  - `Swim + X | D` → swim 60 + X (D−60)
  - `Gym + X | D` → gym 45 (separate) + X (D)
  - `GYM + EZ Spin + OW Swim | D` → gym 45 + OW swim 45 + spin (D−45)
  - `Long Brick` → bike + run pair
  - Skiing weeks kept as `sport: 'other'`
- `../seed-plan.ts` — the seeder. Idempotent. Three modes: inspect, dry-run, apply.

## Flow

### 1. Inspect what's already in the user's account

Reports existing plans, seasons, blocks, sessions, and activity links in the
plan's date range. No writes.

```bash
USER=<your-uuid>
npx tsx --env-file=.env.local scripts/seed-plan.ts --user=$USER --inspect
```

### 2. Dry-run the seed

Shows how many rows would be inserted vs. updated. No writes.

```bash
npx tsx --env-file=.env.local scripts/seed-plan.ts --user=$USER --dry-run
```

### 3. Apply the seed

Writes season, plan, blocks, weeks, sessions. Existing sessions are
re-parented (matched by `user_id + date + sport`). `completed_activities`
and `session_activity_links` are never touched.

```bash
npx tsx --env-file=.env.local scripts/seed-plan.ts --user=$USER --apply

# To also set profiles.active_plan_id to the new plan:
npx tsx --env-file=.env.local scripts/seed-plan.ts --user=$USER --apply --set-active
```

The seeder is idempotent: re-run it safely after editing `plan-2026.ts`.

### 4. Backfill Strava activities

If Strava is already connected for the user, trigger a sync for the full plan
range. The default sync window is 7 days; temporarily widen it or use the
existing resync script.

**Option A — extend sync window and hit /sync (authenticated UI)**:
```sql
-- In Supabase SQL editor, expand the window before syncing
update public.external_connections
   set sync_window_days = 220
 where user_id = '<uuid>' and provider = 'strava';
```
Then trigger sync from the app UI (Settings → Integrations → Sync now).

**Option B — one-off re-sync of already-imported activities** (when the
normaliser shape changes):
```bash
npx tsx --env-file=.env.local scripts/strava-resync.ts <email>
```

Both paths write to `completed_activities` and then auto-match against the
seeded planned sessions (threshold 0.85). The seed's sport + date grid gives
the matcher plenty to work with.

### 5. Generate AI content (session reviews + weekly debriefs)

After sessions + activities + links are in place, backfill all AI content in
one sweep:

```bash
npx tsx --env-file=.env.local scripts/refresh-ai-content.ts \
  --user=$USER \
  --scope=sessions,extras,weekly,patterns
```

This populates:
- `sessions.execution_result` (per-session execution review)
- `sessions` AI verdicts via `syncSessionExecutionFromActivityLink`
- `weekly_debriefs` (one per week touched by completed work)
- Observed patterns (deterministic aggregation)

Expect ~2 AI calls per linked session + ~1 per unlinked activity + ~1 per
week. Budget accordingly.

## Safety notes

- Runs with the service-role key. RLS bypassed — keep off user-facing paths.
- Sessions are never deleted. Existing `session_activity_links`,
  `session_reviews` (via `sessions.execution_result`), and
  `completed_activities` rows are preserved.
- The seeder matches existing sessions by `(user_id, date, sport)`. If you
  have two planned sessions of the same sport on the same date already, the
  oldest is re-parented and the seed's second session is inserted as a new
  row.
- `--set-active` only flips `profiles.active_plan_id`; old plans are left in
  place for historical reference.

## Corrections

`plan-2026.ts` was transcribed by eye from the screenshot. Known ambiguities
flagged inline in `notes:`:
- Phase 3 Thu durations read as 90 min (sheet cells ambiguous; chosen to make
  weekly totals balance).
- Race durations (`Joe Hannon Olympic`, `Lusk 4 Miler`, `Half IM`) are
  approximate.
- Skiing days encoded as 240 min/day of `sport: 'other'` — these won't match
  any Strava activity unless you log skiing to Strava.

Edit the file and re-run `--apply`; updates are idempotent.
