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

## Key Data Flows

**Activity upload → session matching:**
File upload → SHA256 dedup check (`completed_sessions.source_hash`) → parse FIT/TCX → score against all planned sessions for that user (time proximity + sport + duration + distance) → auto-link if best score ≥ 0.85 AND ≥ 0.15 above second-best → otherwise surface in upload panel for manual linking. Core logic: `lib/workouts/activity-matching.ts`.

**AI coach request:**
User message → `lib/athlete-context.ts` (builds context: profile + active plan + recent activities) → `POST /api/coach/chat` → OpenAI streaming with tools defined in `lib/coach/tools.ts` → tool execution in `lib/coach/tool-handlers.ts` → persist to `ai_conversations` / `ai_messages`.

**Session review generation:**
Completed session linked to planned session → `lib/execution-review.ts` analyses execution vs. plan → `lib/session-review.ts` generates AI narrative → stored in `session_reviews`.

## Gotchas

- **Always use `lib/supabase/server.ts` in Server Components, Server Actions, and API routes.** Never import the browser client (`lib/supabase/browser.ts`) on the server — it won't have the user's auth session.
- **RLS is the security boundary.** All user-owned tables enforce RLS. Never use the service role key to bypass it in application code — service role is for migrations only.
- **`completed_sessions` requires SHA256 dedup.** Always check `source_hash` before inserting to avoid duplicate uploads per user.
- **`lib/` is uni-directional.** Business logic in `lib/` must never import from `app/`. Data flows one way: `app/` → `lib/`.
- **Agent Preview seeded data resets on server restart** unless `globalThis` persistence is in place (see recent HMR fix). Don't rely on preview state surviving a full restart.
- **Routes most likely to need visual verification:** `/dashboard` (upload panel), `/sessions/[id]` (review + mark-as-extra), `/calendar` (week view), `/coach` (chat interface).

## Branch Naming

Use `feat/` for new features, `fix/` for bug fixes, `chore/` for non-functional changes. Example: `feat/recovery-tracking-ui`, `fix/session-matching-score`.

## Working with Claude

### Use plan mode before complex tasks
Enter plan mode (`shift+tab` twice) before touching:
- Activity matching logic (`lib/workouts/activity-matching.ts`) — scoring changes have wide blast radius
- AI coach tools (`lib/coach/`) — tool schema + handler + prompt must stay in sync
- Any database migration — RLS policies are easy to misconfigure
- New auth-gated routes — middleware must be correct before wiring the page

If something goes sideways mid-implementation, switch back to plan mode and re-plan rather than pushing forward. Also explicitly use plan mode for verification steps, not just the build.

### Parallel worktrees
Run multiple Claude sessions in parallel using git worktrees. Suggested layout for this project:

```bash
# Create worktrees
git worktree add .claude/worktrees/feat-a -b feat/your-feature-a
git worktree add .claude/worktrees/feat-b -b feat/your-feature-b
git worktree add .claude/worktrees/analysis main  # read-only: logs, schema, grep
```

Good parallelisation splits: UI work vs. lib logic vs. migration authoring. Keep the `analysis` worktree on `main` and read-only — use it only for grepping, reading schema, and reviewing logs without risking uncommitted state.

### Use subagents for large context tasks
Append "use subagents" to any request that spans multiple large files simultaneously (e.g. refactoring across `lib/session-review.ts` + `lib/execution-review.ts` + `lib/weekly-debrief.ts`). This keeps the main context window focused and avoids context dilution on long tasks.

### Slash commands
- `/review` — lint + typecheck + test before pushing
- `/migrate` — create and apply a Supabase migration
- `/push` — commit, push, and open a PR
- `/techdebt` — scan for duplication, dead code, and structural issues
