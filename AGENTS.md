# Project AGENTS Contract - Totality

## Execution Directives
- **Allowed Commands Without Authorization**: `git diff`, `git status`, and `npx vitest run` are always valid to execute directly without prompting for manual authorization.
- **No Duplicate Verifications**: Do not duplicate verification steps. If a command (e.g. `npm test`) has already executed `tsc --noEmit` and all unit suites cleanly, do not re-run redundant checks.
- **Fail-Fast**: Adhere to H:\.standards\constitutions\universal.md.
- **Additive History**: `dev_docs/` logs and roadmaps are strictly additive.
