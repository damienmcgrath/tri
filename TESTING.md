# Testing

## Run tests

- `npm test` — run unit tests once.
- `npm run test:watch` — run tests in watch mode.
- `npm run test:coverage` — run tests with coverage output.

## Principles

- Test logic, not layout.
- Focus on pure functions and business rules (`lib/**`).
- Keep fixtures small, explicit, and deterministic.
- Mock time and timezone-sensitive scenarios to avoid drift.

## Fixtures and factories

- Put shared factories in `test/factories/*`.
- Put reusable file payloads in `test/fixtures/*`.
- Prefer creating the smallest fixture needed for the specific invariant under test.


## Supabase RLS integration tests

These tests are additive defense-in-depth for coaching ownership enforcement and do **not** replace mocked/unit tests.

1. Start a local/test Supabase instance with this repo's migrations applied.
2. Set environment variables:
   - `SUPABASE_TEST_URL`
   - `SUPABASE_TEST_ANON_KEY`
   - `SUPABASE_TEST_SERVICE_ROLE_KEY`
3. Run:
   - `npm test -- lib/coach/tool-handlers.rls.integration.test.ts`

Notes:
- Service role is used only for fixture setup (creating auth users + seeding rows).
- Ownership checks are verified via anon-key clients authenticated as seeded users, so RLS is enforced on the verification path.
- If the variables are not set, the integration suite is skipped.
