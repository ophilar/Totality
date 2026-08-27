# Task 3 report — queue state persistence

## Change

- Persisted `currentTask` alongside queued and completed tasks, including the latest progress payload.
- Serialized state writes so progress, cancellation, and lifecycle writes cannot overwrite newer state.
- Active cancellation marks and persists the task before the queue update notification is sent.
- Queue startup requeues any persisted active task so a stale task cannot block processing.
- Renderer notifications remain limited to the explicitly registered live main window.

## Verification

- `npx vitest run tests/unit/TaskQueueService.test.ts` — 12 tests passed.
- `npx tsc --noEmit` — passed.
- `git diff --check` — passed.

## Scope

Only the queue service, its focused tests, and this report are staged. Existing untracked plan artifacts are intentionally excluded.

## Concern

Cancellation is represented immediately as `cancelled` while the underlying task is unwinding; completion history is still recorded by the existing finalization path.
