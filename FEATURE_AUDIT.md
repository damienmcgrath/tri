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
- Dashboard now includes a workout analysis summary card with completion and coaching insights.

### AI coach experience (new)
- `/coach` now has a modern chat UX with conversation bubbles and insight side panel.
- AI Coach backend endpoint (`/api/coach/chat`) is implemented.
- Coach responses include workout analysis based on recent planned/completed sessions.
- If `OPENAI_API_KEY` is set, responses use `gpt-4o-mini`; otherwise a local coaching fallback keeps the feature testable.

### Data model and security baseline
- Supabase migrations exist for `training_plans`, `planned_sessions`, `completed_sessions`, and `ingestion_events`.
- RLS policies are in place so users can only access their own rows.
- Helpful indexes and updated-at triggers are present for key tables.

## 2) Reprioritized next features (Garmin API moved down)

### Highest-priority next features
1. **AI Coach v1 hardening** (conversation persistence, guardrails, and structured recommendations).
2. **Workout analysis and performance summaries v1.1** (richer metrics, trend windows, and plan-adjustment suggestions).

### Deferred (due to access constraints)
- **Garmin Health API integration** is intentionally postponed until API access is available.
- Continue using TCX import path as the short-term ingestion mechanism.

## 3) Plan for the next 2 features

## Feature 1: AI Coach v1 Hardening

### Objective
Make AI coaching reliable and production-ready for day-to-day usage.

### Scope (first deliverable)
- Persist conversations and messages per user.
- Add stronger system prompt guardrails and refusal/safety handling.
- Return structured suggestions (e.g., recover/easy/key session recommendations).
- Add rate limiting, error telemetry, and usage counters.

### Suggested implementation steps
1. **Persistence layer**
   - Add `ai_conversations` and `ai_messages` tables with RLS.
2. **Prompt + policy layer**
   - Standardize coaching style and non-medical boundaries.
3. **Structured output**
   - Return both free-text coaching response and structured recommendation payload.
4. **Operational safeguards**
   - Add per-user request limits and error monitoring.
5. **UX polish**
   - Add conversation history, “new chat”, and streaming responses.

### Definition of done
- User can return to prior chats.
- Coach responses are consistently formatted and safe.
- Suggested actions are explicit and easy to apply manually.

---

## Feature 2: Workout Analysis + Summary v1.1

### Objective
Turn raw completed sessions into actionable training intelligence.

### Scope (first deliverable)
- Add rolling windows (7d/14d/28d) for planned vs completed load.
- Surface sport distribution and consistency trend.
- Add “risk flags” (e.g., sudden spikes, low completion streaks).
- Provide summary blocks the AI coach can reuse in prompts.

### Suggested implementation steps
1. **Analytics helpers**
   - Expand summary logic with trend windows and load-change calculations.
2. **Dashboard UX**
   - Add trend cards and progress visuals.
3. **Coach context sharing**
   - Use shared summary builder in dashboard + coach endpoint.
4. **Validation**
   - Add unit tests around summary math and edge cases.

### Definition of done
- Dashboard communicates not just totals, but trajectory and risk.
- AI coach references the same summary model for consistent advice.

## 4) Sequencing recommendation
- **Sprint A:** AI Coach v1 hardening.
- **Sprint B:** Workout analysis + summary v1.1.
- **Later:** Garmin Health API integration when access is available.
