# Task 2 report — transcoding output safety

## Change

- `TranscodeCommandFactory.resolveOutputMode` is the single output-mode policy boundary.
- `TranscodingService` delegates to that boundary after output verification.
- A lossy encoder can only save a sibling copy or use quarantine replacement; `replace` remains available only to the verified `copy` encoder.
- `defaults.json` already persisted `transcoding_default_output_mode` as `quarantine-replace` at the task start, so no configuration edit was needed.

## Verification

- Red: `npx vitest run tests/unit/services/transcoding/TranscodeCommandFactory.test.ts` failed because `resolveOutputMode` did not exist.
- Green: `npx vitest run tests/unit/services/transcoding tests/unit/services/TranscodingBuilders.test.ts tests/unit/services/TranscodingCapabilities.test.ts tests/unit/services/TranscodingService.test.ts` — 7 files, 61 tests passed.
- `npx tsc --noEmit` passed.
- `git diff --check` passed.

## Scope

Only Task 2 source, regression test, and this report are staged. Existing untracked plan artifacts are intentionally excluded.
