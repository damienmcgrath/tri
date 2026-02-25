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
