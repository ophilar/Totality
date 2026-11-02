# Task 1 report — non-destructive timeline cache migration

## Changed files

- `src/main/database/DatabaseMigration.ts`: validates timeline recipe and manifest cache envelopes, migrates structurally valid version-one recipes to version two, retains current/unsupported/malformed records, and emits warnings with the cache key and reason.
- `tests/unit/DatabaseMigration.test.ts`: focused coverage for current records, legacy transformation, malformed-record preservation, and unsupported-record preservation/diagnostics.

## Verification

- `npx vitest run tests/unit/DatabaseMigration.test.ts --reporter=verbose` — passed (1 file, 4 tests).
- `npx tsc --noEmit` — passed.
- `git diff --check` — passed.

Reviewer follow-up: version migration now requires an explicit integer version `1`; missing, non-numeric, and non-integer versions are retained and warned. Regression coverage increased to 5 focused tests.

## Concerns

- Legacy records are transformed only when they match the supported recipe envelope and item shape. Unsupported or malformed payloads remain available for manual recovery and are not modified.
