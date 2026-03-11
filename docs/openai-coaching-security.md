# OpenAI Coaching Security Model

## Trust boundary

- The browser is **untrusted**.
- The model is **untrusted** for identity and ownership decisions.
- Supabase Auth (`auth.uid()`) + RLS are the source of truth for data ownership.

## Request flow

1. Frontend calls `POST /api/coach/chat`.
2. Route resolves authenticated user via server-side Supabase client.
3. Route resolves `CoachAuthContext` (`userId`, `athleteId`, `email`) server-side.
4. Route invokes OpenAI **from server only**.
5. If the model requests tools, backend executes tool handlers with request-scoped auth context.
6. Tool handlers query/write only athlete-scoped rows.
7. RLS enforces DB-side ownership isolation even if app code regresses.


## Model selection

Model selection is centralized in `lib/openai.ts`:

- `OPENAI_COACH_MODEL` (default: `gpt-5-mini`) for normal coaching chat.
- `OPENAI_COACH_DEEP_MODEL` (default: `gpt-5.4`) for higher-value/deeper operations (weekly review, diagnosis, deep planning).

Use `getCoachModel()` for normal routes and `getCoachModel({ deep: true })` when opting into deep analysis.

## Why OpenAI never touches DB directly

OpenAI receives prompts and tool outputs only. It has no DB credentials and cannot run arbitrary SQL.
All DB reads/writes happen in our backend tool handlers and route code.

## Tool argument safety

Tools never accept `userId`/`athleteId` in their input contract.
Ownership comes only from `ctx` resolved from auth on each request.

Bad:

```ts
get_recent_sessions({ athleteId, daysBack })
```

Good:

```ts
get_recent_sessions({ daysBack }, ctx)
```

## Proposal-only write model

The model can request `create_plan_change_proposal`, which only inserts a proposal row.
It never directly edits `sessions` or other plan records.

Write-side guardrails:

- Validate referenced `targetSessionId` belongs to current athlete before insert.
- Enforce same ownership in RLS policy (`target_session_id` must reference athlete-owned session).

## RLS defense in depth

Coaching-relevant tables are protected by RLS and athlete ownership policies.
Queries are scoped by `athlete_id = auth.uid()` (with parent ownership checks on child tables).

This means cross-user access should still fail even if a handler accidentally broadens a query.

## Service role usage

User-facing coaching code paths must use request-scoped auth clients.
Do not use `SUPABASE_SERVICE_ROLE_KEY` in interactive route handlers.

Allowed use-cases for service role (separate job contexts only):

- one-off admin repair scripts
- controlled backfills
- offline ETL/cron tasks

Any service-role use must be isolated, documented, and reviewed.

## Audit logging

Coaching code emits structured audit logs for:

- auth failures
- tool execution start/success/failure
- unknown tool requests
- proposal creation
- route success/failure

Logs include safe metadata (`userId`, `athleteId`, tool/route names, status) and sanitized args.
Secrets and raw sensitive payloads must not be logged.

## Safe pattern for adding a new tool

1. Define a strict Zod schema (no ownership identifiers).
2. Add tool descriptor in `lib/coach/tools.ts`.
3. Implement handler that uses `ctx` for ownership.
4. Keep output compact/minimal.
5. Add RLS-compatible queries (`athlete_id` scope + parent checks if needed).
6. Add tests:
   - invalid args rejected
   - cross-user access blocked
   - expected output shape stable
7. Add audit logs for execution and failure.
