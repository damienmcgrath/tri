You are the orchestrator for a multi-agent feature implementation. Your job is to decompose a spec into parallel agent tasks, create GitHub issues, set up git worktrees, and produce self-contained agent briefs.

The spec to decompose is provided in $ARGUMENTS. If $ARGUMENTS is empty, ask the user to paste the spec now before proceeding.

Follow these steps exactly:

## Step 1: Decompose the spec

Analyse the spec and produce a task list. Each task must have:
- A short slug (e.g. `migration`, `api`, `ui`, `tests`)
- A one-line title
- Explicit file ownership — list every file the agent may create or modify. No two tasks may share a file.
- Dependencies — which other task slugs must be merged before this task can start
- Interface contracts — types, function signatures, or API shapes this task produces or consumes that other tasks depend on
- Acceptance criteria — 3–5 bullet points that define done

Print the full decomposition and ask the user: "Does this decomposition look correct? Any changes before I create the issues and worktrees?" Wait for explicit approval before continuing.

## Step 2: Create GitHub issues

For each task, run:

```
gh issue create \
  --title "[agent-SLUG] TITLE" \
  --body "## File ownership\nFILES\n\n## Dependencies\nDEPS\n\n## Interface contracts\nCONTRACTS\n\n## Acceptance criteria\nCRITERIA" \
  --label "agent-task"
```

Create the `agent-task` label first if it does not exist:
```
gh label create "agent-task" --color "0075ca" --description "Multi-agent workflow task"
```

Note the issue number returned for each task. Build a map of slug → issue number.

## Step 3: Create worktrees and branches

For each task, run:
```
git worktree add .claude/worktrees/NN-SLUG -b feat/NN-SLUG
```

Where NN is the issue number and SLUG is the task slug. Print each command as you run it.

## Step 4: Output agent briefs

For each task, print a clearly separated agent brief formatted exactly as follows. The user will copy-paste each brief into a separate Ghostty terminal pane running `claude` from the worktree directory.

---

### Brief for Agent #NN — SLUG

**Start this agent with:**
```
cd ~/tri/.claude/worktrees/NN-SLUG && claude
```

**Paste this into the agent session:**

```
You are working on GitHub issue #NN: TITLE
Branch: feat/NN-SLUG
Working directory: .claude/worktrees/NN-SLUG

Your file ownership — modify ONLY these files:
FILES

Interface contracts you must implement:
CONTRACTS

Dependencies: DEPS
(If a dependency branch is not yet merged to main, ask the orchestrator to run: git fetch origin feat/DEP-BRANCH && git merge origin/feat/DEP-BRANCH from your worktree before you start.)

Task:
ACCEPTANCE_CRITERIA

When done:
1. Run npm run typecheck — fix all errors before continuing
2. Run npm run test — fix any failures before continuing
3. git push -u origin feat/NN-SLUG
4. gh pr create --title "feat: #NN TITLE" --body "Closes #NN\n\n## What\nBRIEF_DESCRIPTION\n\n## Test plan\n- [ ] typecheck passes\n- [ ] tests pass"
5. Tell the orchestrator your PR number and that you are done
```

---

## Step 5: Print the merge order

After all briefs, print:

**Merge order (do not deviate):**
1. List tasks in topological order based on dependencies
2. For each: `gh pr merge PR# --merge` then `npm run typecheck && npm run test`

**Ghostty layout suggestion:**
Print a text diagram showing how many panes are needed and which agent goes in each.

**GitHub Projects:**
Remind the user to add all new issues to their Projects board and move them to "In Progress" as each agent session is started.
