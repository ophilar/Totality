# Media Safety and Timeline Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the working timeline feature while making cache migration non-destructive, transcoding output safety explicit, queue state authoritative across renderer reconnects, and renderer failures observable.

**Architecture:** Keep timeline recipes and queue state as single sources of truth. Valid timeline cache records are migrated by version; invalid records are retained with diagnostics. The transcoding service owns the quarantine/direct-replacement invariant, while the renderer consumes persisted latest task state rather than relying on event history.

**Tech Stack:** TypeScript, Electron, React, Better-SQLite, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-08-27-episode-interleaved-timelines-design.md`, `docs/superpowers/specs/2026-08-27-trash-guides-audio-pruning-design.md`

## Global Constraints

- Do not change public names or duplicate existing authorities.
- Do not delete timeline cache records during startup migration.
- Lossy transcodes use quarantine; direct replacement is limited to verified stream-copy/remux.
- Queue state stores the latest progress per task; logs provide history.
- No silent catches or arbitrary-window fallbacks.
- Preserve existing timeline recipe behavior and chronology.

---

### Task 1: Non-destructive timeline cache migration

**Files:**
- Modify: `src/main/database/DatabaseMigration.ts`
- Test: `tests/unit/DatabaseMigration.test.ts` (create focused migration coverage)

- [ ] **Step 1: Add migration tests** for version-2 records, transformable legacy records, malformed records, and preservation of invalid records with diagnostics.
- [ ] **Step 2: Run the focused migration tests** and confirm the preservation test fails against deletion behavior.
- [ ] **Step 3: Implement versioned migration** that transforms only supported legacy payloads, retains invalid payloads, and logs an explicit warning with the cache key and reason.
- [ ] **Step 4: Run focused migration tests and the database test suite.**

### Task 2: Enforce transcoding output safety

**Files:**
- Modify: `src/main/services/TranscodingService.ts`, `src/main/services/transcoding/TranscodeCommandFactory.ts`
- Modify: `src/main/config/defaults.json`
- Test: `tests/unit/services/transcoding/`

- [ ] **Step 1: Add failing tests** asserting lossy output cannot resolve to direct replacement and remux can.
- [ ] **Step 2: Implement the invariant in the service/factory boundary**, leaving UI options as requests rather than policy.
- [ ] **Step 3: Set the persisted default to `quarantine-replace` and remove duplicate renderer-side policy decisions.**
- [ ] **Step 4: Run all transcoding tests and TypeScript checks.**

### Task 3: Persist latest queue state across renderer reconnects

**Files:**
- Modify: `src/main/services/TaskQueueService.ts`
- Test: `tests/unit/TaskQueueService.test.ts` (extend existing queue tests)

- [ ] **Step 1: Add failing tests** for active-task cancellation persistence, latest progress persistence, and notification behavior with no registered window.
- [ ] **Step 2: Update queue state writes** so cancellation and progress are persisted before notification.
- [ ] **Step 3: Emit only through the registered live window**; renderer initialization reads persisted state.
- [ ] **Step 4: Run focused queue tests and the full suite.**

### Task 4: Make renderer failures observable and remove UI warnings

**Files:**
- Modify: `src/renderer/src/components/library/ShowTranscodeModal.tsx`
- Modify: `src/renderer/src/components/library/tv/EpisodeRow.tsx`, `src/renderer/src/components/library/tv/TVShowDetails.tsx`
- Test: `tests/unit/TVShowOptimizationFlow.test.tsx`, `tests/unit/TVShowDeduplication.test.ts`

- [ ] **Step 1: Replace silent promise catches** with the existing renderer error reporting path and add assertions for failed load behavior.
- [ ] **Step 2: Add stable list keys** where the renderer reports missing keys.
- [ ] **Step 3: Wrap asynchronous test interactions in `act`** without weakening production behavior.
- [ ] **Step 4: Run renderer tests and verify warning output is reduced without suppressing errors.**

### Task 5: Documentation and release alignment

**Files:**
- Modify: `CHANGELOG.md`, `package.json`, `package-lock.json`, `dev_docs/totality_roadmap.md`

- [ ] **Step 1: Document the finalized safety and migration contracts.**
- [ ] **Step 2: Confirm the `0.5.0` version and changelog entries match the implemented behavior.**
- [ ] **Step 3: Run `git diff --check`, TypeScript, and the full Vitest suite.**
- [ ] **Step 4: Commit each coherent task or the complete validated set with a descriptive message.**
