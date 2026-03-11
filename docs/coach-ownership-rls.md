# Coaching Ownership + RLS Model

## Ownership model

- `auth.users.id` is the authenticated identity.
- `public.profiles.id` is the athlete record and is a 1:1 mapping to `auth.users.id`.
- Coaching/planning tables now carry an explicit `athlete_id` that references `public.profiles(id)`.
- For this app's current single-athlete-per-user model, `athlete_id` and `user_id` must match.

## Protected tables

The following coaching-relevant tables are protected by RLS and ownership-scoped policies:

- `public.training_plans`
- `public.planned_sessions`
- `public.completed_sessions`
- `public.sessions`
- `public.ai_conversations`
- `public.ai_messages`
- `public.coach_plan_change_proposals`
- `public.recovery_logs`

## Policy shape

Policies use `auth.uid()` and enforce ownership through `athlete_id` (and matching `user_id` where present).

Key protections:

- Users can only `select` rows where `athlete_id = auth.uid()`.
- Inserts/updates require `athlete_id = auth.uid()` and `user_id = auth.uid()` on dual-owner tables.
- Child rows enforce parent ownership:
  - `planned_sessions.plan_id` must belong to a plan owned by the same athlete.
  - `sessions.plan_id` must belong to a plan owned by the same athlete.
  - `ai_messages.conversation_id` must belong to an AI conversation owned by the same athlete.
  - `coach_plan_change_proposals.target_session_id` (when provided) must reference a session owned by the same athlete.

## Secure defaults

- `athlete_id` defaults to `auth.uid()` on the protected tables above.
- `NOT NULL` + FK constraints on `athlete_id` prevent orphaned ownership.
- Check constraints enforce `athlete_id = user_id` on tables that keep both columns.

## Indexes for RLS performance

Added ownership-oriented indexes to avoid full scans under RLS filters:

- `training_plans(athlete_id)`
- `planned_sessions(athlete_id, date)`
- `completed_sessions(athlete_id, date desc)`
- `sessions(athlete_id, date)`
- `ai_conversations(athlete_id, updated_at desc)`
- `ai_messages(athlete_id, created_at desc)`
- `coach_plan_change_proposals(athlete_id, created_at desc)`
- `recovery_logs(athlete_id, date desc)`

## Service role usage review

No user-facing coaching flow in the app currently uses `SUPABASE_SERVICE_ROLE_KEY` directly.
Server routes and server actions use request-scoped Supabase auth clients.

If privileged jobs are added later (e.g., cron backfills), they must be isolated and documented separately.

## Guidance for future tables

For any new athlete-owned table:

1. Add `athlete_id uuid not null references public.profiles(id)`.
2. Enable RLS on table creation.
3. Add explicit `select/insert/update/delete` policies using `athlete_id = auth.uid()`.
4. Add an index on `athlete_id` (plus common filter columns like `date`/`created_at`).
5. Avoid relying on app-layer auth checks alone for data isolation.
