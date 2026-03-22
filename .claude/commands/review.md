Run the full quality check suite and report results before pushing.

Execute these steps in order — stop and report on the first failure:

1. Run `npm run lint` and report any ESLint errors.
2. Run `npm run typecheck` and report any TypeScript errors.
3. Run `npm run test` and report any test failures or coverage regressions.

If all three pass, confirm the branch is ready to push. If any fail, list the specific errors and suggest fixes — do not push until they are resolved.
