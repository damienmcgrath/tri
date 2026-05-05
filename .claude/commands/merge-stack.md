You are merging a stack of feature branches produced by a multi-agent workflow. Your job is to merge them into main in dependency order, running quality checks after each merge and stopping on any failure.

## Step 1: Identify the feature branches

Run the following to find candidate PRs:
```
gh pr list --label "agent-task" --state open --json number,title,headRefName,body
```

If that returns nothing, also try:
```
gh pr list --state open --json number,title,headRefName,body
```

Print the list and ask the user: "Are these the PRs to merge? Please confirm or provide PR numbers manually." Wait for confirmation before proceeding.

## Step 2: Determine merge order

Parse each PR body for dependency information (look for "Dependencies:" or "Closes #" references and issue numbers with `[agent-` prefixes). Build a topological order — tasks with no dependencies go first, tasks that depend on others go after.

If you cannot determine order automatically, print the PR list and ask the user to specify the order.

Print the planned merge order for user confirmation before proceeding.

## Step 3: Ensure main is up to date

```
git checkout main
git pull origin main
```

## Step 4: Merge each PR in order

For each PR in the confirmed order, run this sequence — stop immediately if any step fails:

### 4a. Review the PR diff
```
gh pr diff PR_NUMBER
```
Print a 3-bullet summary of what the PR changes. Flag anything that looks risky (migration changes, RLS policy changes, new env vars required).

### 4b. Run pre-merge checks on the PR branch
```
git fetch origin BRANCH_NAME
git checkout BRANCH_NAME
npm run typecheck
npm run test
```

If typecheck or tests fail: print the errors, tell the user which agent owns the branch, and STOP. Do not merge. Ask the user whether to skip this PR or fix it first.

### 4c. Merge
```
git checkout main
gh pr merge PR_NUMBER --merge --subject "TITLE (#PR_NUMBER)"
```

### 4d. Post-merge checks on main
```
npm run typecheck
npm run test
```

If either fails after merge: immediately tell the user which PR introduced the failure. Do not proceed to the next PR. Suggest:
```
git revert -m 1 MERGE_COMMIT_HASH
```

### 4e. Report success
Print: "✓ PR #PR_NUMBER merged. Main is clean. Proceeding to next."

Update the GitHub issue status:
```
gh issue close ISSUE_NUMBER --comment "Merged in PR #PR_NUMBER"
```

## Step 5: Final check

After all PRs are merged, run the full suite one more time:
```
npm run lint
npm run typecheck
npm run test
```

Print a pass/fail summary.

## Step 6: Cleanup

Ask the user: "Merge complete. Clean up worktrees and branches?" If yes:

For each merged branch:
```
git worktree remove .claude/worktrees/NN-SLUG --force
git branch -d feat/NN-SLUG
```

Print a summary: how many PRs merged, any that were skipped, and whether main is clean.
