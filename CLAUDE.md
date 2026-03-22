# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript strict check (tsc --noEmit)
npm run test         # Jest tests (--runInBand)
npm run test:watch   # Jest watch mode
npm run test:coverage # Jest with coverage report
```

Run a single test file: `npx jest path/to/file.test.ts`

## Architecture

TriCoach AI is a Next.js 14 App Router app for amateur triathlete training management. It combines training plan management, Garmin activity ingestion (FIT/TCX), and an AI coaching chat interface.

**Request flow:**
```
Browser → Middleware (auth gate) → Protected Routes
       → Server Actions / API Routes
       → lib/* (domain logic)
       → Supabase (Postgres + Auth + RLS) / OpenAI API
```

**Key architectural layers:**

- **`/app/(protected)/`** — Auth-gated pages: dashboard, plan, calendar, coach (AI chat), sessions/[id], activities/[id], debrief, settings
- **`/app/api/`** — API routes for coach chat (streaming OpenAI), activity file uploads, session feels, weekly debrief generation
- **`/app/auth/`** — Sign-in/sign-up/password flows using Supabase Email auth
- **`/lib/`** — All business logic; never imports from `/app/`
- **`/supabase/migrations/`** — 20+ SQL migrations; apply with `supabase db push`

**Core lib modules:**
- `lib/supabase/server.ts` + `browser.ts` — Server/client Supabase clients
- `lib/workouts/` — FIT/TCX file parsing, activity-to-session auto-matching (score ≥ 0.85 to auto-link)
- `lib/coach/` — AI coach: system prompt (`instructions.ts`), OpenAI tool definitions (`tools.ts`), tool execution (`tool-handlers.ts`)
- `lib/athlete-context.ts` — Builds context object injected into every AI coach request
- `lib/session-review.ts`, `lib/execution-review.ts`, `lib/weekly-debrief.ts` — AI-generated content (large files)
- `lib/security/` — Rate limiting + request validation (Zod)

## Database

Supabase Postgres with RLS on all user-owned tables. Key tables:
- `training_plans` → `training_weeks` → `sessions` (planned workouts)
- `completed_sessions` — Parsed activity files; SHA256 dedup per user
- `activity_uploads` — Upload metadata
- `profiles` — User profile + `active_plan_id`
- `ai_conversations` → `ai_messages` — Coach chat history
- `session_reviews`, `weekly_debriefs` — AI-generated content
- `adaptation_logs` — Plan adjustment history

## AI Integration

- Default model: `gpt-5-mini` (env: `OPENAI_MODEL`)
- Deep reasoning model: `gpt-5.4` (env: `OPENAI_REASONING_MODEL`)
- All OpenAI calls are server-side only (API routes / Server Actions)
- Coach chat is streaming via `POST /api/coach/chat`

## Design System

- Tailwind CSS with custom semantic color tokens (`base`, `surface`, `raised`, `overlay`, `accent`, `success`, `warning`, `danger`) plus sport-specific colors (`run`, `swim`, `bike`, `strength`)
- Geist Sans (UI text) + Geist Mono (code/metrics)
- Dark mode throughout

## Agent Preview Mode

For local UI testing without a real Supabase account:

1. Set `AGENT_PREVIEW=true` in `.env.local`
2. Visit `/dev/agent-preview` to seed test data
3. Access protected routes directly without login

**After making any visual change, verify it using Agent Preview Mode before considering the task done.** Start the dev server (`npm run dev`), then use the browser to navigate to the affected route and take a screenshot to confirm the UI looks correct. This applies to component changes, layout fixes, color/style updates, and any new UI elements.

## Environment Setup

Copy `.env.example` to `.env.local`. Required vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`. Optional: Redis (Upstash), weather API, Sentry, PostHog.

## Testing

Jest + @testing-library/react + jsdom. Coverage targets: 75% lines/statements, 80% functions. Tests live alongside source as `*.test.ts` / `*.test.tsx`. Supabase and env directories are excluded from coverage.

After making logic changes, run the tests for the affected module. Before pushing, run the full suite (`npm run test`) and fix any failures before committing. Also run `npm run typecheck` before pushing.
