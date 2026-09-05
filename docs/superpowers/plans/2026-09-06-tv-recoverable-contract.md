# TV Recoverable Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TV-series Recoverable sorting, dry-run savings, percentages, and optimization recommendations consume one non-overlapping canonical recovery model.

**Architecture:** Centralize recovery accounting in `OptimizationSavingsService` and action precedence in `OptimizationDecisionService`. Preserve the existing combined `storage_debt_bytes` value as a compatibility aggregate for persisted list/sort data, while fresh dry-run separates video and audio without double-counting. Explicit persisted component columns are a separate additive migration because legacy combined values cannot be split safely without re-analysis.

**Tech Stack:** TypeScript 5.6, Electron, React 19, Drizzle ORM/libSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-tv-recoverable-contract-design.md`

**Implementation:** Draft PR #154, branch `fix/tv-recoverable-contract`.

## Global Constraints

- Preserve existing features, optimization actions, and persisted user data.
- Never fabricate missing evidence; unknown values remain `null`.
- Never count the same storage bytes in more than one recovery mechanism.
- Keep compatibility aliases until all current consumers are migrated.

---

### Task 1: Lock decision semantics — implemented

**Files:**
- Modify: `tests/unit/services/OptimizationDecisionService.test.ts`
- Modify: `src/main/services/OptimizationDecisionService.ts`

**Interfaces:**
- Consumes: existing `OptimizationDecisionInput` plus explicit `legacyTotalRecoverableBytes` compatibility input.
- Produces: corrected `OptimizationDecision.primaryAction` and non-overlapping audio-transcode candidates.

- [x] Add regression coverage for video-only `primaryAction === 'transcode-video'`.
- [x] Add regression coverage proving removable tracks are excluded from audio-transcode candidates.
- [x] Change primary-action precedence to `review-language -> remove-audio-tracks -> transcode-audio -> transcode-video -> no-action`.
- [x] Restrict audio-transcode candidates to retained tracks.
- [x] Add legacy combined-total handling so stored audio pruning is not interpreted as video debt.

### Task 2: Canonical savings accounting — implemented

**Files:**
- Create: `src/main/services/OptimizationSavingsService.ts`
- Create: `tests/unit/services/OptimizationSavingsService.test.ts`
- Modify: `src/main/services/ShowOptimizationMetricsService.ts`
- Modify: `tests/unit/services/RealDryRunOptimizationCalculations.test.ts`
- Create: `tests/unit/services/ShowOptimizationContractRegression.test.ts`

**Interfaces:**
- Produces `OptimizationSavingsBreakdown` with `videoDebtBytes`, `audioPruningBytes`, `audioTranscodeBytes`, `totalRecoverableBytes`, `percentageSavings`, and coverage.

- [x] Test non-overlapping component sums, null evidence, and total percentage.
- [x] Implement the pure accounting helper.
- [x] Add explicit `videoDebtBytes` input alongside documented legacy combined `recoverableBytes`.
- [x] Derive only the nonnegative video residual from legacy combined totals during fresh dry-run.
- [x] Count a scored episode only when an efficiency score exists.
- [x] Keep compatibility fields while exposing canonical `totalRecoverableBytes`.

### Task 3: Persist explicit components — intentionally deferred additive migration

Implementation review established that existing `storage_debt_bytes` already stores the combined video-bloat + audio-pruning total. Altering old rows or attempting to split that value would fabricate evidence. The current correctness fixes therefore preserve it as a compatibility aggregate and stop interpreting it as video-only debt.

A later migration, paired with re-analysis, may:

- [ ] Promote `estimated_savings_bytes` to the explicit canonical persisted total.
- [ ] Add nullable `video_debt_bytes`.
- [ ] Add nullable `audio_pruning_savings_bytes`.
- [ ] Add nullable `audio_transcode_savings_bytes`.
- [ ] Populate component fields only from fresh/reproducible analysis.
- [ ] Keep `storage_debt_bytes` as a legacy compatibility field until all consumers migrate.

This deferred schema migration is not required to fix the current TV list/sort/dry-run defects and must not be backfilled by guessing component values.

### Task 4: Fix TV aggregation, identity join, Recoverable sort, and pagination — implemented

**Files:**
- Modify: `src/main/database/repositories/TVShowRepository.ts`
- Create: `tests/unit/services/TVShowRepositoryIdentity.test.ts`

**Interfaces:**
- `TVShowSummary.total_recoverable_bytes` remains the existing combined recoverable aggregate and is the value used by Recoverable sorting.

- [x] Add same-title/different-identity regression coverage.
- [x] Join episode aggregates identity-first using `series_identity_key + source_id + library_id`.
- [x] Restrict title fallback in the aggregate join to rows whose identity is unresolved/null.
- [x] Add Recoverable descending-sort coverage asserting the sorted key equals the rendered `total_recoverable_bytes`.
- [x] Add pagination coverage proving same-title identities do not duplicate or disappear across pages.
- [x] Keep existing persisted combined totals intact rather than introducing a destructive migration.

### Task 5: Make dry-run consume canonical accounting and shared action precedence — implemented

**Files:**
- Modify: `src/main/ipc/optimization.ts`
- Modify: `src/main/services/ShowOptimizationMetricsService.ts`
- Modify: `src/preload/api/optimization.ts`
- Modify/add service regressions.

**Interfaces:**
- Fresh FFmpeg evidence -> canonical savings accounting -> shared `OptimizationDecisionService` precedence -> compatibility response aliases.

- [x] Verify dry-run displayed total and percentage use the same canonical numerator.
- [x] Remove the old rule that mapped any positive audio savings to generic `review-required`.
- [x] Resolve primary action through `OptimizationDecisionService` precedence.
- [x] Return `totalRecoverableBytes`, `audioPruningBytes`, `videoDebtBytes`, `coverage`, and `primaryAction`.
- [x] Preserve legacy response fields (`recoverableBytes`, `totalCombinedSavingsBytes`, `action`) as compatibility aliases/translations.
- [x] Scope dry-run episode lookup by `series_identity_key` and `library_id` so same-title identities are not mixed.
- [x] Use series TMDB identity from the selected episodes before title-based metadata fallback.

### Task 6: Renderer and sort-state convergence — implemented

**Files:**
- Modify: `src/renderer/src/components/library/TVShowsView.tsx`
- Modify: `src/renderer/src/components/library/sortDefinitions.ts`
- Modify: `src/renderer/src/contexts/LibraryContext.tsx`
- Modify: `tests/unit/librarySortDefinitions.test.ts`
- Modify: `tests/unit/TVShowsViewRendering.test.tsx`

**Interfaces:**
- Renderer consumes the canonical total/percentage and identity-scoped dry-run API.

- [x] Display `totalRecoverableBytes` as Estimated Recoverable with compatibility fallback.
- [x] Display `audioPruningBytes` and `videoDebtBytes` independently.
- [x] Show recovery evidence coverage.
- [x] Pass series identity and library into dry-run.
- [x] Use identity-aware React keys for same-title shows.
- [x] Reset unsupported cross-view sort state to `title / asc`.
- [x] Add renderer regression coverage for identity-scoped dry-run and total/percentage consistency.

### Task 7: Verification — final run pending after documentation/test updates

- [ ] Latest PR-head CI: full test command passes.
- [ ] Latest PR-head CI: production build passes.
- [x] Inspect PR diff for unrelated production changes.
- [x] Verify no persisted data migration or deletion was introduced.
- [x] Verify core invariants against the design spec.
