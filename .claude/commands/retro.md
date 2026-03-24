Run a post-implementation retrospective on the current branch. Review what was built, what went wrong, and what was learned — then store anything reusable in the right place.

## Step 1 — Gather evidence

Run all of these in parallel:
- `git log main..HEAD --oneline` — commits on this branch
- `git diff main...HEAD --stat` — files changed
- `git diff main...HEAD` — full diff (for context on what was actually built)
- `gh pr view --json title,body,url 2>/dev/null || echo "no PR"` — PR description if available

Also read:
- `CLAUDE.md` — so you know what's already documented and don't duplicate it
- `~/.claude/projects/-Users-Damien-Code-tri/memory/MEMORY.md` — same for personal memory

## Step 2 — Reflect honestly

Think through the session. Be specific and self-critical. For each category below, write down what actually happened — not a sanitised summary, but the real sequence including wrong turns.

**What was built**
- What is the feature/fix in plain terms?
- What are the key files and why?
- Were there any non-obvious design decisions? (things that look weird without context)

**Where the agent went wrong**
Be honest. Look for evidence in the diff of things that were added then removed (debug logs, half-built approaches, reverted changes). Think about:
- Wrong assumptions made upfront that required backtracking
- Debugging approaches that didn't work before finding the real cause
- Tools used incorrectly before finding the right approach
- Time wasted testing against the wrong target (e.g. wrong server, wrong branch, wrong env)
- Anything the user had to correct or redirect

**What was unexpectedly hard**
- Things that should have been simple but weren't
- Environment or tooling issues that blocked progress
- Gaps between what the code appeared to do vs. what it actually did at runtime

**What worked well**
- Approaches that paid off
- Tools or patterns that were efficient
- Anything worth repeating

## Step 3 — Propose what to save

For each insight from Step 2, decide where it belongs:

| Insight type | Where it goes |
|---|---|
| Tool quirk, workflow preference, personal habit | Personal memory (`~/.claude/projects/.../memory/`) |
| Gotcha any contributor would hit, project convention, debugging pattern | `CLAUDE.md` in the repo |
| Non-obvious design decision in the code itself | Code comment or inline note (flag it, don't write it) |
| Too session-specific to reuse | Nowhere — discard |

Write out your proposed additions clearly, with the exact text you'd write and where it would go. Include a one-line rationale for each.

**Do not write anything yet.** Present the proposals first.

## Step 4 — Ask for approval

Show the user:
1. A brief summary of what was built (2-3 sentences)
2. The top 2-3 missteps/lessons, with honest description
3. Your proposed memory/CLAUDE.md additions, each with: destination, content, rationale

Ask: "Should I write any of these? You can approve all, pick specific ones, or adjust the wording."

## Step 5 — Write approved items

For each approved item:
- If personal memory: create or update the relevant file in `~/.claude/projects/-Users-Damien-Code-tri/memory/` following the frontmatter format, then update `MEMORY.md`
- If `CLAUDE.md`: edit the file, placing the addition in the most relevant existing section (Gotchas, Working with Claude, etc.)

Confirm what was written and where.
