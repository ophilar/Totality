# TV Recoverable Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TV-series Total Debt sorting, dry-run savings, percentages, and optimization recommendations consume one non-overlapping canonical recovery model.

**Architecture:** Centralize recovery accounting in `OptimizationSavingsService` and action precedence in `OptimizationDecisionService`. Preserve the existing combined `storage_debt_bytes` value as the persisted list/sort aggregate, while fresh dry-run separates video and audio without double-counting. TV renderer state is keyed by `series_identity_key + source_id + library_id`. Runtime TV operations must use that identity; historical rows without identity must be canonicalized in persistence rather than resolved by title at call sites.

**Tech Stack:** TypeScript 5.6, Electron, React 19, Drizzle ORM/libSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-tv-recoverable-contract-design.md`

**Implementation:** Draft PR #154, branch `fix/tv-recoverable-contract`. Keep open until the latest head passes CI and review.

## Global Constraints

- Preserve existing features, optimization actions, and persisted user data.
- Never fabricate missing evidence; unknown values remain `null`.
- Never count the same storage bytes in more than one recovery mechanism.
- Compatibility savings aliases such as `recoverableBytes` and `totalCombinedSavingsBytes` MUST equal canonical `totalRecoverableBytes`.
- Runtime TV identity is `series_identity_key + source_id + library_id`; `series_title` is display metadata, not identity.
- Historical identity repair belongs in database migration, not renderer/IPC title fallbacks.
- **Total Debt** is the single TV list debt metric; audio/video component values are diagnostic breakdowns, not additional TV debt columns.

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
- [x] Add explicit `videoDebtBytes` input alongside documented legacy combined `recoverableBytes` input semantics.
- [x] Derive only the nonnegative video residual from legacy combined totals during fresh dry-run.
- [x] Count a scored episode only when an efficiency score exists.
- [x] Map output compatibility aliases `recoverableBytes` and `totalCombinedSavingsBytes` to canonical `totalRecoverableBytes`.

### Task 3: Persist explicit savings components — intentionally deferred additive migration

Existing `storage_debt_bytes` already stores the combined video-bloat + audio-pruning total. Altering old rows or attempting to split that value would fabricate evidence. The current correctness fixes therefore preserve it as the Total Debt aggregate and stop interpreting it as video-only debt.

A later migration, paired with re-analysis, may:

- [ ] Promote `estimated_savings_bytes` to the explicit canonical persisted total.
- [ ] Add nullable `video_debt_bytes`.
- [ ] Add nullable `audio_pruning_savings_bytes`.
- [ ] Add nullable `audio_transcode_savings_bytes`.
- [ ] Populate component fields only from fresh/reproducible analysis.
- [ ] Keep `storage_debt_bytes` until all consumers migrate.

This component migration is independent of the identity backfill in Task 6b.

### Task 4: Fix TV aggregation, identity join, Total Debt sort, and pagination — implemented

**Files:**
- Modify: `src/main/database/repositories/TVShowRepository.ts`
- Create: `tests/unit/services/TVShowRepositoryIdentity.test.ts`

**Interfaces:**
- `TVShowSummary.total_recoverable_bytes` remains the existing combined Total Debt aggregate and is the value used by the TV `recoverable` sort key.

- [x] Add same-title/different-identity regression coverage.
- [x] Join resolved episode aggregates using `series_identity_key + source_id + library_id`.
- [x] Prevent resolved same-title identities from borrowing each other's aggregate data.
- [x] Add descending sort coverage asserting the sorted key equals rendered `total_recoverable_bytes`.
- [x] Add pagination coverage proving same-title identities do not duplicate or disappear across pages.
- [x] Present one TV list column labeled **Total Debt**; keep the existing internal `recoverable` sort key.
- [x] Keep existing persisted combined totals intact.

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
- [x] Preserve existing response fields (`recoverableBytes`, `totalCombinedSavingsBytes`, `action`) as aliases/translations; savings aliases equal the canonical total.
- [x] Scope dry-run episode lookup by `series_identity_key` and `library_id` so same-title identities are not mixed.
- [x] Use series TMDB identity from the selected episodes when available.

### Task 6: Renderer identity and Total Debt convergence — implemented except historical identity boundary

**Files:**
- Modify: `src/renderer/src/components/library/TVShowsView.tsx`
- Modify: `src/renderer/src/components/library/tv/TVShowDetails.tsx`
- Create: `src/renderer/src/components/library/tv/showIdentity.ts`
- Modify: `src/renderer/src/components/library/MediaBrowser.tsx`
- Modify: `src/renderer/src/components/library/hooks/useAnalysisManager.ts`
- Modify: `src/renderer/src/components/library/hooks/useGlobalSearch.ts`
- Modify: `src/renderer/src/components/library/hooks/useDismissHandlers.ts`
- Modify: `src/renderer/src/components/library/sortDefinitions.ts`
- Modify: `src/renderer/src/contexts/LibraryContext.tsx`
- Modify: `src/preload/api/media.ts`
- Modify: `src/main/ipc/series.ts`
- Modify/add renderer tests.

**Interfaces:**
- Renderer selection carries the full scoped TV identity instead of a title string.
- Identity-aware bridge operations accept `series_title + source_id + series_identity_key + library_id`.
- Identity-scoped preload methods live in the existing `mediaApi`; no second thin preload wrapper exists.

- [x] Store selected TV show as a full `TVShowSummary`, not `series_title`.
- [x] Key completeness state and React rows by stable scoped identity.
- [x] Load selected-show episodes by scoped identity.
- [x] Analyze one selected series by scoped identity.
- [x] Scope missing-item state updates to the selected identity rather than searching by title.
- [x] Remove the duplicate `seriesIdentityApi` preload surface and reuse `mediaApi`.
- [x] Log malformed audio metadata instead of silently ignoring parse failures.
- [x] Display one **Total Debt** column/sort option in the TV list.
- [x] Keep audio-pruning/video-debt breakdown inside dry-run diagnostics rather than separate TV list columns.
- [x] Reset unsupported cross-view sort state to `title / asc`.
- [x] Add same-title selection and stable-identity regressions.

### Task 6b: Canonicalize historical TV identity — required before merge

Current migrations add `series_identity_key` columns but do not backfill their values. That forces the remaining renderer/repository legacy title boundary. The correct removal path is persistence-first.

- [ ] Backfill missing `series_completeness.series_identity_key` deterministically using the existing `deriveSeriesIdentityKey` implementation.
- [ ] Backfill missing episode `media_items.series_identity_key` using the same identity rules and available authoritative IDs.
- [ ] Run the backfill before duplicate-series consolidation/uniqueness enforcement.
- [ ] Remove the legacy title branch from `getTVShowIdentityKey`.
- [ ] Remove the legacy-null/title aggregate join branch once migrated rows are canonical.
- [ ] Update identity regression tests to assert canonical unresolved identities rather than runtime title fallback.
- [ ] Remove identity-scoped IPC argument optionality that exists only to permit title fallback, where existing callers provide the full scope.

### Task 7: Verification — latest PR-head run required

- [ ] Latest PR-head CI: full test command passes.
- [ ] Latest PR-head CI: production build passes.
- [x] Inspect PR diff for unrelated production changes.
- [x] Verify savings-component persistence is not fabricated.
- [ ] Verify runtime TV identity has no title fallback after Task 6b.
- [x] Verify core savings invariants against the design spec.

Do not use an earlier green CI run as evidence for a later PR head. PR #154 remains draft/open until Task 6b is complete and the final head is verified and reviewed.
