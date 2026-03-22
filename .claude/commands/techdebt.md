Scan the codebase for tech debt and report findings. Focus on duplication, dead code, and structural issues — not style preferences.

## What to check

### 1. Duplicated AI generation patterns
`lib/session-review.ts`, `lib/execution-review.ts`, and `lib/weekly-debrief.ts` all call OpenAI with similar prompt-building patterns. Check whether:
- The prompt construction, model selection, and error handling can be extracted to a shared utility
- Any helper functions are copy-pasted across these files

### 2. Duplicated Supabase query patterns
Look across `app/(protected)/*/actions.ts` and `lib/` for repeated query shapes (e.g. fetching sessions + completed_sessions together, joining profiles). Flag any that appear 3+ times without abstraction.

### 3. Dead exports
Scan `lib/` for exported functions/types that are never imported anywhere in `app/` or `lib/`. List them — they're candidates for deletion.

### 4. Oversized files
Flag any file over 400 lines. For each, identify the natural split point (e.g. types vs. logic vs. prompts).

### 5. Inconsistent patterns
- Mixed use of `createServerClient` vs `createClient` across server files
- Any API routes that do business logic directly instead of delegating to `lib/`
- Any `lib/` files that import from `app/` (violates the uni-directional rule in CLAUDE.md)

### 6. Tool handler drift
`lib/coach/tools.ts` defines the AI tool schemas and `lib/coach/tool-handlers.ts` executes them. Check whether any tool defined in `tools.ts` is missing a handler or vice versa.

## Output format

For each issue found:
- **File(s):** path(s)
- **Issue:** one-line description
- **Fix:** concrete suggestion (extract function, delete, move, etc.)
- **Effort:** S / M / L

End with a prioritised list of the top 3 fixes to do first.
