# Remaining Test-Warning Remediation Plan

**Created:** 2026-08-28 14:19:16 (Asia/Jerusalem)
**Status:** Planned; warning sources are visible and unsuppressed.

## Objective

Remove remaining React test-lifecycle warnings and expected integration error noise by fixing their causes, without disabling diagnostics or changing production behavior.

## Work items

1. Add an awaited `renderWithProviders` test helper that owns provider initialization and unmount cleanup.
2. Migrate provider-heavy renderer tests from direct `render` calls to the helper.
3. Await asynchronous provider updates with `findBy*`, `waitFor`, and `act` around user-triggered state changes.
4. Add explicit success fixtures to the integrated IPC bridge for source listing, stats, libraries, and connection checks.
5. Keep separate failure fixtures for tests that verify error handling; assert those failures explicitly.
6. Replace arbitrary sleeps and fire-and-forget test promises with condition-based waits and awaited assertions.
7. Capture component stacks for any remaining list-key warning and add stable domain keys at the producing component.
8. Run the full Vitest suite with warning output preserved, then TypeScript, ESLint, diff checks, and the production installer build.

## Completion criteria

- Full test suite passes with no unawaited assertions.
- No React `act()` or list-key warnings remain.
- Integration tests log only failures intentionally under test.
- Production error handling and logging remain unchanged.
- All changes are committed on `master` and verified after the final build.
