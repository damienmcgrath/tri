Commit all staged and unstaged changes, push to the current branch, and open a pull request against main.

Follow these steps exactly:

1. Run `git status` and `git diff` in parallel to understand what has changed.
2. Run `git log --oneline -5` to understand the commit style used in this repo.
3. Stage all modified/new tracked files relevant to the work (use specific file paths, not `git add -A`).
4. Write a concise commit message based on the actual changes. Use imperative mood, focus on the "why". Pass via HEREDOC.
5. Commit. If a pre-commit hook fails, fix the issue and recommit — do NOT use `--no-verify`.
6. Push to the current branch with `-u origin <branch>` if not already tracking, otherwise `git push`.
7. Create a PR against `main` using `gh pr create`. Write a brief summary (2-4 bullets) covering what changed and why. Include a short test plan checklist.
8. Return the PR URL.

Do not push to main directly. Do not force push. Confirm before proceeding if on an unexpected branch.
