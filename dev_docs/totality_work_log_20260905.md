# Totality Work Log - 2026-09-05

## Objectives
- Scope and design Sub-Project 1 (PRs 1–4): Quality Metrics SSOT, Automated Currency, UI Convergence, and Music Simplification.
- Define defensible recoverable bytes (`storage_debt_bytes`) in `QualityAnalyzer` (audio pruning + video bloat above target bitrate) without manufactured values.
- Omit efficiency and recoverable metrics for music items; focus music strictly on fidelity tiers (`HI_RES`, `LOSSLESS`, `LOSSY_HIGH`, `LOSSY_MID`, `LOSSY_LOW`), specs, and completeness.
- Eliminate renderer-side `getQualityTier()` calculations and fragile `ShowCard` memo comparators.
- Derive TV show aggregate metrics directly from child episode records without competing stale fallbacks.
- Enforce automated currency across scanning, metadata mutation, transcoding, settings updates, and manual library scans.
- Formulate technical specification and record ADR-017.

---

## Architectural Decisions
- Recorded ADR-017 in `dev_docs/totality_design.md`.
- Documented Phase 26 in `dev_docs/totality_roadmap.md`.

---

## Sub-Project 1: Task 1 - QualityAnalyzer Sole Producer of Defensible Metrics
- Established `QualityAnalyzer` as the Single Source of Truth (SSOT) for quality and recoverable metrics (`storage_debt_bytes`, `efficiency_score`).
- Implemented `calculateVideoBloatBytes` in `QualityAnalyzer.ts`:
  - Formula: `max(0, ((video_bitrate - target_bitrate) * 1000 * duration_sec) / 8)` where `target_bitrate` comes from `efficiencyThresholds[qualityTier]`.
  - Evaluates strictly to `null` if video bitrate, duration, or quality tier target is missing/non-positive (zero manufactured values).
- Calculated `storage_debt_bytes` as `videoBloatBytes + audioPruningBytes` when video bloat evidence is present; strictly `null` when missing.
- Confirmed `analyzeMusicAlbum` preserves `efficiency_score: null` and `storage_debt_bytes: null` to avoid manufactured synthetic efficiency/debt for music albums.
- Confirmed `ShowOptimizationMetricsService.ts` consumes stored episode analysis results (`storage_debt_bytes`, `efficiency_score`) without running duplicate parallel bitrate/bloat calculations.
- Added comprehensive unit tests in `tests/unit/QualityAnalyzer.test.ts` verifying video bloat, audio pruning, combined debt, missing evidence null-handling, and music null metrics.
- All 166 test files (1,273 tests) pass cleanly.

## Sub-Project 1: Task 2 - Automated Currency & Pure Derived Show Aggregates (PR 2)
- Direct Show Summary Derivation in `TVShowRepository.ts`:
  - Eliminated the fallback chain where `row.storage_debt_bytes` competed with `aggregate.storageDebtBytes` and `row.total_size`.
  - TV show aggregate metrics (`total_size`, `total_recoverable_bytes`, `weighted_efficiency`) derive directly from current child episode records (`aggregatedScoresMap` from episodes) when episodes exist, or `row` values when episodes are absent.
  - When a series has 0 analyzed episodes, its `total_recoverable_bytes` and `weighted_efficiency` evaluate strictly to `undefined` / `null` ("unknown"), never defaulted to 0 or synthetic values.
  - Eliminated `requiresCalculatedSort` and in-memory sorting manipulation (`summaries.sort(...)`); standard `orderBy`, `limit`, and `offset` are now executed directly in SQL queries.
  - Enhanced `aggregatedScoresMap` to index both `seriesIdentityKey` and `seriesTitle`, ensuring robust lookup with fallback.
- Scan Coercion in `SourceManager.ts`:
  - In `triggerPostScanAnalysis(sourceId?: string, libraryId?: string)`, enqueued `TaskType.QualityAnalysis` with `sourceId` and `libraryId` so manual and automatic library scans coerce analysis across existing unchanged files.
- Settings Currency in `src/main/ipc/database.ts`:
  - In `IPC_CHANNELS.DATABASE.SET_SETTING`, when `key.startsWith('quality_')`, enqueued `TaskType.QualityAnalysis` with label `'Recalculate Media Quality (Settings changed)'` alongside cache invalidation, ensuring quality metrics recalculate automatically when thresholds or targets change.
- Unit Testing & TDD:
  - Added unit tests in `tests/unit/TVShowRepository.test.ts` verifying direct derivation from episode quality scores, unanalyzed show undefined metrics, direct SQL sorting with limit/offset, and absence-fallback preservation.
  - Added unit test in `tests/unit/SourceManager.test.ts` verifying `triggerPostScanAnalysis` enqueues `TaskType.QualityAnalysis` with `sourceId`.
  - Added unit test in `tests/unit/IpcRefactorReal.test.ts` verifying modifying a `quality_*` setting enqueues `TaskType.QualityAnalysis`.
  - Full test suite passing: 166 test files, 1,279 tests passing (100%).

## Sub-Project 1: Task 3 - UI Convergence & Stale React Render Elimination (PR 3)
- Eliminated fragile custom memo comparator in `ShowCard.tsx`:
  - Removed custom comparator function passed as the second argument to `memo(...)` in `src/renderer/src/components/library/tv/ShowCard.tsx`.
  - Configured `ShowCard = memo(...)` with standard React shallow prop equality so that updates to `show.weighted_efficiency`, `show.total_recoverable_bytes`, `show.evidence_status`, and other properties trigger immediate re-renders.
  - Retained existing `id: 'analyze'` action under the 3-dot menu and confirmed "Optimize Series" strictly launches the transcode wizard (`onTranscodeShow`) without re-evaluating analysis.
- Pruned dead sort aliases in schemas and types:
  - In `src/main/validation/schemas.ts`: pruned unused `waste` from `TVShowFiltersSchema.sortBy`, pruned unused `waste` and `debt` from `MusicFiltersSchema.sortBy`, and pruned unused `debt` and `waste` from `MediaItemFiltersSchema.sortBy`.
  - In `src/main/types/database.ts`: pruned unused `debt` from `MediaItemFilters.sortBy`, pruned unused `waste` from `TVShowFilters.sortBy`, and pruned unused `waste` and `debt` from `MusicFilters.sortBy`.
  - Retained canonical `recoverable` and `efficiency` sort keys across views and schemas.
- Unit Testing & TDD:
  - Created `tests/unit/ShowCard.test.tsx` verifying:
    - Red phase: reproduced stale render failure where updates to `weighted_efficiency`, `total_recoverable_bytes`, and `evidence_status` failed to re-render the DOM due to the custom memo comparator.
    - Green phase: verified `ShowCard` re-renders immediately with updated values when the custom comparator was removed.
    - Verified action menu invokes `onAnalyzeSeries` and "Optimize Series" triggers `onTranscodeShow` without re-evaluating analysis.
  - All 167 test files (1,284 tests) pass cleanly (100%).

## Sub-Project 1: Task 4 - Music Simplification Architecture (PR 4)
- Deleted Duplicate Renderer-Side `getQualityTier()`:
  - In `MusicView.tsx`: deleted local `getQualityTier(track: MusicTrack)`; filtered tracks now evaluate against canonical authoritative quality tiers (`HI_RES`, `LOSSLESS`, `LOSSY_HIGH`, `LOSSY_MID`, `LOSSY_LOW`) or explicit specs without synthetic defaults.
  - In `TrackListItem.tsx`: deleted local `getQualityTier()` and hardcoded codec/bitrate assumptions; displays authoritative tier badge (`track.quality_tier`), explicit raw specs (`{bitrate} kbps`), or "Unanalyzed".
  - In `MusicAlbumDetails.tsx`: deleted local `getQualityTier()` and hardcoded codec/bitrate assumptions across album header and track list; renders authoritative tier badge (`selectedAlbum.quality_tier`, `track.quality_tier`), explicit raw specs, or "Unanalyzed".
  - In `mediaUtils.ts`: deleted duplicate renderer-side `getTrackQualityTier()` and `getAudioQualityBadge()`; updated `getQualityTierColor` and `getQualityTierBgColor` to format canonical and display tier strings directly.
- Removed Misleading "Efficiency" and "Recoverable" Headers & Sort Controls:
  - In `sortDefinitions.ts`: updated `sortOptions.music` to canonical list: `Title`, `Artist`, `Album`, `Year`, `Size`, `Quality`.
  - In `sortDefinitions.ts`: mapped `track_count` to "Track Count" label in `getSortLabel`.
  - In `MusicView.tsx`: updated `MusicSortKey` to `'title' | 'artist' | 'album' | 'year' | 'size' | 'quality'`.
  - In `MusicView.tsx`: updated list header columns to `['title', 'album', 'artist', 'year', 'size', 'track_count', 'quality']` (Title, Album, Artist, Year, Size, Track Count, Quality).
  - In `MusicView.tsx`: removed empty `onClickQuality={() => {}}` callback.
  - In `TrackListItem.tsx`: removed synthetic `track.efficiency_score` and `track.storage_debt_bytes` indicators.
- Zero Fabricated Defaults:
  - Unanalyzed tracks and albums never default to `LOSSY_MID`. If unanalyzed, components render explicit raw audio specs or "Unanalyzed".
- Verification & Test Suites:
  - Created `tests/unit/MusicView.test.tsx` verifying:
    - Canonical sort options for music without efficiency or recoverable.
    - MusicView rendering with canonical sort controls and headers without efficiency or recoverable.
    - TrackListItem authoritative quality tier usage without local calculation.
    - TrackListItem raw audio specs / Unanalyzed rendering without defaulting to `LOSSY_MID`.
    - MusicAlbumDetails authoritative album quality tier usage without local calculation.
    - MusicAlbumDetails raw specs / Unanalyzed rendering when quality tier is missing.
  - Updated `tests/unit/RendererUtils.test.ts` to test canonical tier color formatters instead of deleted duplicate calculation.
  - Verified 100% test pass rate: 168 test files, 1,288 tests passing.

## Sub-Project 2: Task 5 & 6 - UI Responsiveness, Generation Tracking & Resilient Preflight (PR 5 & 6)
- Race-Free Paginated Data Fetching in `src/renderer/src/hooks/usePaginatedData.ts`:
  - Added request generation counter (`requestGenerationRef = useRef(0)`) to cancel stale in-flight responses.
  - In `loadPage`, increments `currentGeneration = ++requestGenerationRef.current` and discards any response whose generation does not match the active generation ref.
  - In `reset()` and `externalSetItems()`, increments generation counter immediately to invalidate pending fetches during view navigation, search, or filter changes.
- Event Loop Yielding in `src/main/services/MovieCollectionService.ts`:
  - Added `await new Promise(r => setImmediate(r))` yields within collection analysis and batch iteration loops to prevent main-thread Node/Electron starvation during collection processing.
- Episode Measurement Isolation in `src/main/services/TranscodingService.ts`:
  - Replaced static measurement directory (`.totality-measurements`) with per-file isolated workspace: `path.join(path.dirname(filePath), .totality-measurements-${createHash('sha256').update(filePath).digest('hex').slice(0, 12)})`.
  - Added `finally` cleanup to remove the isolated measurement workspace immediately after candidate evaluation completes.
- Resilient Show Preflight in `src/main/services/TranscodingService.ts`:
  - Wrapped individual episode processing in `processEpisode` in a try/catch block to prevent a single corrupt or incompatible episode from failing the entire show's preflight.
  - On episode analysis or authorization failure, logs a warning and returns `{ compatible: false, reason: errorMsg, ... }` with `decisionStatus: 'insufficient_evidence'`.
  - Updated show preflight compatibility to `compatible: results.some(episode => episode.compatible)` so shows with at least one optimizable episode are actionable.
  - In `queueShowTranscode`, removed the blocking preflight check; verifies `queueableEpisodes.length > 0` and safely queues only compatible, actionable episodes.
  - Bounded parallel episode preflight concurrency to 4 to prevent CPU/VMAF starvation.
- Unit Testing & Verification:
  - Added unit test in `tests/unit/services/TranscodingService.test.ts` verifying partial show compatibility permits queueing compatible episodes.
  - Added unit test in `tests/unit/services/TranscodingService.test.ts` verifying `selectMeasuredParameters` creates and cleans up isolated measurement workspaces.
  - Verified 19/19 tests passing in `TranscodingService.test.ts`.

## Step 7: Crash-Consistent Media Replacement Activation Journal & Fault-Injection Tests (PR 7)
- Crash-Consistent Journal in `src/main/services/TranscodingService.ts`:
  - Enriched `ActivationJournal` interface and journal writes with `outputStats` (`fileSize`, `duration`, `video`, `audioTracks`) upon transcode completion prior to destructive movement.
  - Enhanced `recoverActivationJournals()` startup recovery:
    1. **Pre-Replacement Crash (Quarantined but target unplaced)**: When source is quarantined and target does not exist, restores the original media from the quarantine path back to the target/source path and cleanly removes the journal (guarantees zero media data loss).
    2. **Post-Placement Crash (Target activated but DB unsynchronized)**: When target is already moved/activated at the expected destination path, re-synchronizes the database via `db.media.updatePathAndStats(...)` using the recorded journal output stats and deletes the journal (guarantees zero desynchronized or orphaned DB records).
    3. **Prepared State Crash**: When a prepared journal exists with no filesystem moves yet performed, cleans up the stale journal safely.
- Fault-Injection Testing:
  - Added fault-injection test suite in `tests/unit/services/TranscodingService.test.ts`:
    - Simulates crash after source quarantine: asserts quarantine file is restored to target and journal is deleted.
    - Simulates crash after target placement: asserts DB is updated with new path and stats and journal is deleted.
    - Simulates stale prepared journal: asserts journal is discarded.
  - All 21 tests in `TranscodingService.test.ts` pass cleanly.

## Step 8: Transactional SQLite Migrations (PR 8)
- Atomic Data Migrations in `src/main/database/DatabaseMigration.ts`:
  - Wrapped `backfillMediaIdentities` in a transaction: executes `BEGIN IMMEDIATE`, performs batch updates, and commits with `COMMIT`, rolling back via `ROLLBACK` on any error to prevent partial identity corruptions.
  - Wrapped `markLegacyZeroScoresInsufficient` in a transaction: executes `BEGIN IMMEDIATE`, updates legacy score flags, commits, and safely rolls back on failure.
  - Re-verified existing atomic transactions in `rebuildTableWhenNeeded` and `cleanupOrphanedRecords`.
- Unit Testing & Verification:
  - Verified `tests/unit/DatabaseMigration.test.ts` (5/5 tests passing).

## Step 9: Fail-Closed IPC Security & Packaging Smoke Test (PR 9)
- Fail-Closed IPC Boundary in `src/main/ipc/utils/createHandler.ts`:
  - Validates `senderFrame` on every IPC invoke call.
  - Throws `Unauthorized IPC sender frame: <url>` if `event.senderFrame` or `url` is missing or is not part of the allowed protocols (`file:`, `app:`, `localhost:`, `127.0.0.1:`, `local-artwork:`).
  - Permits test runner mock invocations while strictly validating `senderFrame.url` whenever provided in test/Vitest environments.
- Unit Testing & TDD:
  - Added dedicated sender frame security tests in `tests/unit/IpcValidation.test.ts`:
    - Verifies valid local `file://` frames are accepted.
    - Verifies `localhost` and `local-artwork://` frames are accepted.
    - Verifies untrusted remote origin URLs (`https://evil.attacker.com/...`) are rejected with `Unauthorized IPC sender frame`.
    - Verifies non-allowed protocols (`javascript:...`) are rejected.
  - Verified 71/71 tests in `IpcValidation.test.ts` pass cleanly.
- Packaging & Full Verification:
  - Typecheck: `npm run typecheck` passes cleanly with 0 errors.
  - Full Regression Suite: `npx vitest run` passes cleanly with 168/168 test files and 1,296/1,296 tests passing (100%).
  - Production Packaging Smoke Test: `npm run build` completed successfully, producing `dist-electron/main/index.cjs`, `release/win-unpacked/Totality.exe`, and NSIS installer `release/Totality-Setup-0.5.0.exe`.

