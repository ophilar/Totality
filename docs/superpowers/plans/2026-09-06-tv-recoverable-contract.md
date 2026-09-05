# TV Recoverable Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TV-series Recoverable sorting, dry-run savings, percentages, and optimization recommendations consume one non-overlapping canonical recovery model.

**Architecture:** Centralize recovery accounting in a dedicated savings service and keep `OptimizationDecisionService` as the only action authority. Persist explicit savings components plus a canonical total, aggregate TV rows by series identity, and keep renderer/API compatibility aliases while all consumers migrate.

**Tech Stack:** TypeScript 5.6, Electron, React 19, Drizzle ORM/libSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-tv-recoverable-contract-design.md`

## Global Constraints

- Preserve existing features, optimization actions, and persisted user data.
- Never fabricate missing evidence; unknown values remain `null`.
- Never count the same storage bytes in more than one recovery mechanism.
- Use test-first changes and keep compatibility aliases until all current consumers are migrated.

---

### Task 1: Lock decision semantics

**Files:**
- Modify: `tests/unit/services/OptimizationDecisionService.test.ts`
- Modify: `src/main/services/OptimizationDecisionService.ts`

**Interfaces:**
- Consumes: existing `OptimizationDecisionInput`.
- Produces: corrected `OptimizationDecision.primaryAction` and non-overlapping audio-transcode savings.

- [ ] Add a failing video-only test expecting `primaryAction === 'transcode-video'`.
- [ ] Add a failing mixed-audio test proving removable tracks are excluded from audio-transcode savings.
- [ ] Run CI/test and verify failure is due to current decision behavior.
- [ ] Change primary-action precedence to `review-language -> remove-audio-tracks -> transcode-audio -> transcode-video -> no-action`.
- [ ] Restrict audio-transcode candidates to retained tracks.
- [ ] Re-run focused tests and commit.

### Task 2: Canonical savings accounting

**Files:**
- Create: `src/main/services/OptimizationSavingsService.ts`
- Create: `tests/unit/services/OptimizationSavingsService.test.ts`
- Modify: `src/main/services/ShowOptimizationMetricsService.ts`
- Modify: `tests/unit/services/RealDryRunOptimizationCalculations.test.ts`
- Modify: `tests/unit/services/ShowOptimizationMetricsService.test.ts`

**Interfaces:**
- Produces `OptimizationSavingsBreakdown` with `videoDebtBytes`, `audioPruningBytes`, `audioTranscodeBytes`, `totalRecoverableBytes`, `percentageSavings`, and coverage.

- [ ] Add failing tests for non-overlapping component sums, null evidence, and total percentage.
- [ ] Implement the minimal pure accounting helper.
- [ ] Refactor dry-run aggregation to use explicit video debt rather than ambiguous `recoverableBytes` semantics.
- [ ] Count a scored episode only when an efficiency score is present.
- [ ] Keep compatibility fields (`recoverableBytes`, `totalCombinedSavingsBytes`) mapped to canonical values during migration.
- [ ] Re-run focused tests and commit.

### Task 3: Persist canonical components

**Files:**
- Modify: `src/main/database/drizzleSchema.ts`
- Modify: `src/main/database/schema.ts`
- Modify: `src/main/database/DatabaseMigration.ts`
- Modify: `src/main/types/database.ts`
- Modify: `src/main/services/QualityAnalyzer.ts`
- Modify: `tests/unit/services/QualityAnalyzer.test.ts`

**Interfaces:**
- Adds `video_debt_bytes`, `audio_pruning_savings_bytes`, `audio_transcode_savings_bytes` to `quality_scores`.
- Uses existing `estimated_savings_bytes` as canonical total.

- [ ] Add failing analyzer tests asserting component separation and canonical total.
- [ ] Add nullable schema/migration columns; do not backfill fabricated components from legacy combined debt.
- [ ] Make analysis write video debt separately from audio pruning.
- [ ] Populate `estimated_savings_bytes` from the canonical non-overlapping total.
- [ ] Preserve `storage_debt_bytes` for compatibility only.
- [ ] Re-run analyzer/database tests and commit.

### Task 4: Fix TV aggregation and Recoverable sort

**Files:**
- Modify: `src/main/database/repositories/TVShowRepository.ts`
- Add/modify repository tests covering TV summaries and sorting.

**Interfaces:**
- `TVShowSummary.total_recoverable_bytes` becomes the canonical series total.

- [ ] Add a failing same-title/different-identity regression test.
- [ ] Add a failing Recoverable descending-sort test using canonical totals.
- [ ] Aggregate `estimated_savings_bytes`, not legacy combined debt, for Recoverable.
- [ ] Join episode aggregates identity-first using `series_identity_key + source_id + library_id`.
- [ ] Restrict title fallback to unresolved legacy identities.
- [ ] Verify pagination count equals logical series count without duplicates.
- [ ] Re-run repository tests and commit.

### Task 5: Make dry-run consume the authorities

**Files:**
- Modify: `src/main/ipc/optimization.ts`
- Modify: `src/main/services/ShowOptimizationMetricsService.ts`
- Modify corresponding IPC/service tests.

**Interfaces:**
- Fresh FFmpeg evidence -> savings accounting -> `OptimizationDecisionService` -> series aggregate.

- [ ] Add failing tests that dry-run displayed total and percentage use the same canonical numerator.
- [ ] Add failing test that a clean removable-audio case does not become generic `review-required`.
- [ ] Remove independent IPC recommendation synthesis.
- [ ] Return structured decision mechanisms plus `primaryAction`.
- [ ] Preserve legacy response fields as aliases to canonical fields.
- [ ] Re-run focused tests and commit.

### Task 6: Renderer and sort-state convergence

**Files:**
- Modify: `src/renderer/src/components/library/TVShowsView.tsx`
- Modify: `src/renderer/src/components/library/tv/ShowListItem.tsx`
- Modify: `src/renderer/src/contexts/LibraryContext.tsx` and/or `MediaBrowser.tsx`
- Modify renderer tests.

**Interfaces:**
- Renderer consumes canonical total/percentage and structured action data.

- [ ] Add failing renderer tests for total/percentage consistency and partial evidence.
- [ ] Display canonical Recoverable everywhere.
- [ ] Show component breakdown in dry-run while preserving current actions.
- [ ] Reset unsupported cross-view sort state to `title / asc` for TV.
- [ ] Re-run renderer tests and commit.

### Task 7: Verification

- [ ] Run `npm run typecheck`.
- [ ] Run focused Vitest suites for decision, savings, analyzer, repository, dry-run, and renderer behavior.
- [ ] Run `npm test`.
- [ ] Run `npm run build -- --publish never`.
- [ ] Verify invariants from the spec and inspect the final PR diff for unrelated changes.
