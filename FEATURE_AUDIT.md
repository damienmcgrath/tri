# TriCoach AI Feature Audit and Next-Feature Plan

## 1) What is done so far

### Foundation and platform
- Next.js app scaffold with TypeScript, Tailwind, and core layout/routing is in place.
- Supabase browser/server clients are implemented and reused across app pages/actions.
- Middleware gatekeeps protected routes and redirects unauthenticated users to sign-in.
- Email/password sign-up and sign-in flows are implemented with Supabase Auth.

### Training plan management (MVP-level)
- Users can create plans (`training_plans`) from the `/plan` screen.
- Users can add, edit, and delete planned sessions (`planned_sessions`) via server actions.
- Plan UI groups sessions by week and supports plan switching by query param.
- Zod validation is applied to plan/session action payloads.

### Workout ingestion and dashboard
- Dashboard computes weekly planned vs completed minutes per sport.
- Temporary Garmin bridge is implemented via `.tcx` upload (server action + parser).
- TCX parser normalizes activities into a consistent schema (date/sport/metrics).
- Completed sessions are upserted with dedupe on `(user_id, garmin_id)`.
- Ingestion events are logged for success/failure visibility.

### Data model and security baseline
- Supabase migrations exist for `training_plans`, `planned_sessions`, `completed_sessions`, and `ingestion_events`.
- RLS policies are in place so users can only access their own rows.
- Helpful indexes and updated-at triggers are present for key tables.

## 2) Gaps: what still needs to be built next

### Highest-priority missing MVP features
1. **Real Garmin Health API sync** (replace manual TCX upload as primary path).
2. **AI Coach chat backend + UI flow** (currently scaffold text only).

### Important secondary gaps
- Session matching layer: explicit planned-session ↔ completed-session linkage and status (`completed`, `missed`, `partial`) beyond aggregate minutes.
- Calendar UX: richer weekly/day calendar interactions and quick rescheduling.
- Recovery tracking feature from PRD (daily logs + trend display + coach-aware recommendations).
- PB/FTP tracker and performance trend charts from PRD are not yet implemented.
- Operational hardening: structured error telemetry, job retries, and ingestion observability dashboard.

## 3) Plan for the next 2 features

## Feature 1: Garmin Health API Integration (production ingestion pipeline)

### Objective
Move from manual file upload to automated, reliable Garmin workout ingestion.

### Scope (first deliverable)
- OAuth/connect flow placeholder page updated to real Garmin link state.
- Webhook/ingestion API endpoint(s) that accept Garmin payloads.
- Normalization pipeline into `completed_sessions` schema.
- Idempotent dedupe strategy that handles retries and duplicate webhook delivery.
- Ingestion event logging + error classification.

### Suggested implementation steps
1. **Schema updates**
   - Add `garmin_connections` (user_id, external_athlete_id, token metadata, status, last_sync_at).
   - Add `completed_sessions.external_source` and `external_id` if needed for long-term source compatibility.
2. **Auth/connect flow**
   - Add `/settings/integrations` page with connect/disconnect action.
   - Implement token exchange + secure storage (server-side only).
3. **Webhook ingestion endpoint**
   - Verify request signature.
   - Parse payloads and push each event through normalize/upsert service.
4. **Normalizer service**
   - Map Garmin activity types to sports.
   - Preserve raw payload reference in `ingestion_events` for replay/debug.
5. **Backfill/sync job**
   - Scheduled sync for missed webhook events and historical pull window.
6. **Quality gates**
   - Unit tests for mapper + dedupe.
   - Integration test for endpoint idempotency.

### Definition of done
- User can connect Garmin once and receive new workouts automatically.
- Duplicate deliveries do not create duplicate completed sessions.
- Dashboard updates within one sync cycle without manual upload.

---

## Feature 2: AI Coach v1 (chat + plan-adjustment suggestions)

### Objective
Ship a usable AI coaching assistant that can answer questions and suggest actionable plan changes.

### Scope (first deliverable)
- `/coach` chat UI with message history.
- Server route/action that calls OpenAI (`gpt-4o-mini` default).
- System prompt with coaching style + safety/medical guardrails.
- Context injection: current plan + last 7–14 days of completed sessions + optional recovery inputs.
- Lightweight caching for repeated prompts.

### Suggested implementation steps
1. **Persistence**
   - Add `ai_conversations` + `ai_messages` tables (RLS-scoped by user).
2. **Backend chat endpoint**
   - Validate input length/rate limits.
   - Build context bundle from plan + recent completed sessions.
   - Call model and persist assistant reply.
3. **Prompt/guardrails**
   - Enforce coaching tone, non-diagnostic language, and safe fallback responses.
4. **Actionable responses**
   - Structured suggestion block (e.g., JSON schema) for potential plan edits.
   - Initially present as “proposed changes” requiring user confirmation.
5. **UI delivery**
   - Streaming response UX and error states.
   - Conversation list and “new chat” behavior.
6. **Cost and reliability controls**
   - Cache by normalized question + training context fingerprint.
   - Track token usage and failure telemetry.

### Definition of done
- User can ask triathlon training questions and get coherent, context-aware responses.
- User can receive suggested schedule adjustments without auto-applying unsafe edits.
- Chat runs with predictable latency/cost and has basic observability.

## 4) Recommended sequencing (next 2 sprints)
- **Sprint A:** Ship Garmin Health API ingestion core + integration settings page.
- **Sprint B:** Ship AI Coach v1 with context-aware responses and proposal-style plan adjustments.

This order is recommended because the AI feature quality depends heavily on trustworthy, recent workout data.
