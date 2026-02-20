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
1. **AI Coach chat backend + UI flow** (currently scaffold text only).
2. **Session matching + execution tracking** (planned-session ↔ completed-session status + workflow).

### Deferred item (future sprint)
- **Real Garmin Health API sync** remains important, but is intentionally deferred for now.

### Important secondary gaps
- Session matching layer: explicit planned-session ↔ completed-session linkage and status (`completed`, `missed`, `partial`) beyond aggregate minutes.
- Calendar UX: richer weekly/day calendar interactions and quick rescheduling.
- Recovery tracking feature from PRD (daily logs + trend display + coach-aware recommendations).
- PB/FTP tracker and performance trend charts from PRD are not yet implemented.
- Operational hardening: structured error telemetry, job retries, and ingestion observability dashboard.

## 3) Plan for the next 2 features

## Feature 1: AI Coach v1 (chat + plan-adjustment suggestions)

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

---

## Feature 2: Session Matching + Recovery Insights v1

### Objective
Move from aggregate minute comparisons to actionable execution tracking and recovery-aware recommendations.

### Scope (first deliverable)
- Explicit planned-session ↔ completed-session linkage.
- Session status model (`completed`, `missed`, `partial`) with simple matching heuristics.
- Calendar interactions for status updates and quick rescheduling.
- Lightweight daily recovery log (sleep/soreness/energy) and 7-day trend card.
- Coach context hooks that include execution + recovery summary.

### Suggested implementation steps
1. **Schema updates**
   - Add linkage table or nullable foreign keys for matched planned/completed sessions.
   - Add `completion_status` and `completion_confidence` fields where appropriate.
   - Add `recovery_logs` table (date, sleep_score, soreness_score, energy_score, notes).
2. **Matching service**
   - Implement deterministic heuristics (date window, sport type, duration tolerance).
   - Add manual override endpoint/action to fix mismatches.
3. **Calendar UX**
   - Show planned/completed/partial/missed badges.
   - Add one-click reschedule and mark-complete controls.
4. **Recovery insights**
   - Add daily recovery entry UI.
   - Compute rolling trend and low-recovery flags.
5. **Coach integration**
   - Include weekly adherence + recovery summary in coach context payload.
6. **Quality gates**
   - Unit tests for matching heuristics.
   - Integration tests for status transitions and manual override flows.

### Definition of done
- User can see which planned sessions were completed, missed, or partial.
- User can correct mismatches and quickly reschedule missed sessions.
- Recovery trends are visible and available to coach/context features.

## 4) Recommended sequencing (next 2 sprints)
- **Sprint A:** Ship AI Coach v1 with context-aware responses and proposal-style plan adjustments.
- **Sprint B:** Ship Session Matching + Recovery Insights v1 to improve adherence visibility and recommendations.

Garmin Health API integration is explicitly deferred to a later sprint while we prioritize coach usability and training execution clarity.
