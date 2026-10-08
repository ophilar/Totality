# Totality work log — 2026-10-08

## Scope

Completion and verification of TV Identity Migration, Savings Persistence Policy, Local-Fix Audit Reconciliation, Release Verification, and Version Bump to 0.5.0 on `v0.5.0-clean`.

## Actions & Accomplishments

### 1. TV Identity Migration & Removal of Legacy Title Fallbacks
- **Historical Backfill Migration:**
  - Implemented `SeriesIdentityMigration.ts` with `backfillSeriesIdentityKeys` and `enforceSeriesIdentityConstraints`.
  - Migrated historical `series_completeness` and `media_items` (where `type = 'episode'`) without canonical keys.
  - Rows with TMDB ID receive canonical key `tmdb:<id>`; rows with TVDB ID receive `tvdb:<id>`.
  - Rows without external provider IDs are strictly categorized as `unresolved:<sourceId>:<libraryId>:<slug>`, preserving ambiguity rather than guessing or fabricating metadata.
  - Wired migration into `BetterSQLiteService.ts` (`runMigrations`).
- **Database Schema & Constraints:**
  - Added `series_identity_key` and `tvdb_id` columns to `series_completeness` in `src/main/database/schema.ts` and `BetterSQLiteService.ts`.
  - Created unique indexes on `(series_identity_key, source_id, library_id)`, `(source_id, library_id, tvdb_id)`, and `(source_id, library_id, tmdb_id)`.
  - Installed SQLite triggers preventing insertion or update of `series_completeness` records with null or blank identity keys.
- **Elimination of Title-Based Identity Fallbacks:**
  - `getEpisodes`: Strictly requires `seriesIdentityKey`. Removed the legacy `else if (seriesTitle)` fallback.
  - `getEpisodesForSeries`: Discovers the canonical `series_identity_key` from stored evidence and delegates to `getEpisodes`.
  - `getTVShows`: Groups episodes by `m.series_identity_key, m.source_id, m.library_id`, preventing title collisions across different series or sources.
  - `countTVShows`: Counts distinct `m.series_identity_key || ':' || source_id || ':' || library_id`.
  - `getSeriesCompleteness`: Groups by `series_identity_key`.
  - `upsertSeriesCompleteness`: Calculates and validates `series_identity_key`.
  - `upsertMediaItem`: Computes and inserts `series_identity_key` for all new episodes.
  - `updateSeriesMatch`: Updates `series_identity_key = 'tmdb:' || tmdbId` across episodes and completeness records.

### 2. Savings Persistence Decision
- Confirmed architectural decision for 0.5.0:
  - Do not fabricate or retroactively guess component fields (`video_debt_bytes`, `audio_pruning_savings_bytes`, `audio_transcode_savings_bytes`) from legacy combined `storage_debt_bytes`.
  - `storage_debt_bytes` in `quality_scores` remains the single canonical persisted debt metric.
  - Detailed component breakdowns are computed on-the-fly from live stream packet and container evidence via `OptimizationSavingsService` and `ShowOptimizationMetricsService`.
  - Freshly analyzed items display real-time evidence breakdowns without polluting the schema with ungrounded historical estimates.

### 3. Local-Fix Audit Reconciliation
- Reconciled wanted fixes from local branch against `v0.5.0-clean`:
  - Full TV show optimization preflight and season/episode queue flow.
  - Audio and subtitle track review UI with protected track retention (original language audio, director/audio commentary, audio descriptions, Dolby Atmos/object audio).
  - Storage debt badges, waste indicators, and playback compatibility profiles (`plex-webos-4-lg-b8.json`).
  - Duplicates comparison view and safe resolution matrix (`kept`, `deleted`, `policy-blocked`, `failed`).
  - Strictly maintained exclusions: adult content, PIN entry, and external Arr services remain omitted.

### 4. Release Readiness & Packaging Verification
- Bumped version in `package.json` to `0.5.0`.
- Verified stylesheet references in `dist/index.html` link to valid bundled assets (`./assets/index-YovNZGPK.css`) with zero missing stylesheet or MIME errors.
- Verified `git diff --check` and `git diff --cached --check` return code 0 cleanly with zero trailing whitespace.
- Added comprehensive unit tests in `tests/unit/services/SeriesIdentityService.test.ts` and `tests/unit/database/SeriesIdentityMigration.test.ts`.

## Verification Results
- **TypeScript:** `npm run typecheck` (`tsc --noEmit`) $\rightarrow$ 0 errors.
- **Unit Test Suite:** `npx vitest run` $\rightarrow$ **46 test files, 956 tests passing** (100% pass rate).
- **Production Build & Windows Packaging:** `npm run build` and `npx electron-builder --dir` completed cleanly, producing signed `release\Totality-Setup-0.5.0.exe` and `release\win-unpacked\Totality.exe`.

### 5. Deterministic Summary Deduplication & Real SQLite Verification
- Hardened `SeriesIdentityMigration.ts`:
  - Enforced deterministic summary ranking (`completeness_percentage DESC, owned_episodes DESC, tmdb_id DESC, poster_url DESC, updated_at DESC, id DESC`).
  - Added non-empty metadata merging (`tmdb_id`, `tvdb_id`, `poster_url`, `backdrop_url`, `status`) from losing duplicate rows into the winning surviving row.
  - Removed silent `try/catch` around unique index creation (`CREATE UNIQUE INDEX IF NOT EXISTS`) to fail loudly on constraint violations.
  - Added cross-episode canonicalization unifying all episodes under the series' authoritative TMDB/TVDB key.
  - Enforced post-migration check asserting zero episode rows remain unkeyed.
  - Installed SQLite `BEFORE INSERT` and `BEFORE UPDATE` triggers aborting writes with empty/null `series_identity_key`.
- Modernized renderer callers to identity-first paths:
  - `useTVShowPagination.ts`: `loadSelectedShowEpisodes` queries `seriesGetEpisodesByIdentity` when show summary with identity key is provided.
  - `useAnalysisManager.ts`: `handleAnalyzeSingleSeries` calls `seriesAnalyzeByIdentity` when a `TVShowSummary` or canonical identity key is passed.
  - `TVShowsView.tsx`: passes full `show` object to `onAnalyzeSeries` in both list and grid views, and in detail view button.
  - `ShowTranscodeModal.tsx`: routes preflight analysis and refresh buttons to `seriesAnalyzeByIdentity`.
- Created real SQLite WebAssembly regression tests (`tests/unit/database/SeriesIdentityMigrationRealDb.test.ts`):
  - Verified deduplication survival of richest record (100% completeness over 25% partial) and lossless metadata merging.
  - Verified cross-episode key unification where only 1 episode had TMDB ID.

### 6. Elimination of Runtime Title Lookups & Strict Canonical Identity Enforcement
- **Hardened `SeriesCompletenessService.analyzeSeries`:**
  - Validates that `seriesIdentityKey` starts with `tmdb:`, `tvdb:`, or `unresolved:`. Rejects raw titles with descriptive error.
  - Replaced internal `db.getEpisodesForSeries(title)` with direct `db.getEpisodes('', sourceId || '', seriesIdentityKey, libraryId || '')`.
  - Queries completeness records strictly via `db.getSeriesCompletenessByIdentity(seriesIdentityKey, sourceId, libraryId)`.
- **Hardened `SeriesCompletenessService.getSeriesDeduplicatedByTmdbId`:**
  - Groups items strictly by canonical `series_identity_key`, preserving source/library/provider identity across deduplication.
- **Hardened IPC Handlers (`src/main/ipc/series.ts`):**
  - `series:analyze`: strictly validates canonical series identity key before execution.
  - `series:getEpisodes`: validates canonical series identity key and delegates strictly to `db.getEpisodes('', sourceId, seriesIdentityKey, libraryId)`.
- **Modernized Preload & Renderer Callers:**
  - `src/preload/index.ts`: updated typing and parameter names to `seriesIdentityKey`.
  - `ShowTranscodeModal.tsx`: removed title-based `seriesAnalyze` fallback, routes directly to `seriesAnalyzeByIdentity`.
  - `useAnalysisManager.ts`: requires `TVShowSummary` object or canonical key; throws error if invoked with raw title.
  - `useTVShowPagination.ts`: `loadSelectedShowEpisodes` queries `seriesGetEpisodesByIdentity`, discarding title queries.
  - `MediaBrowser.tsx`: updated all reload/re-scan handlers to fetch and pass show summary or canonical identity key.
- **Added Regression Suite (`tests/unit/services/SeriesCompletenessIdentityRuntime.test.ts`):**
  - Asserts raw titles are rejected immediately with runtime exceptions.
  - Verifies database queries use `db.getEpisodes` with key, never calling `getEpisodesForSeries`.
  - Proves total isolation between same-titled shows (e.g., The Office UK vs US) across analysis and episode fetching.
- **Final Verification Metrics:**
  - TypeScript: `npm run typecheck` (`tsc --noEmit`) $\rightarrow$ 0 errors.
  - Unit Test Suite: `npx vitest run` $\rightarrow$ **47 test files, 959 tests passing** (100% pass rate).
  - Git Diff Hygiene: `git diff --check` passes cleanly with 0 whitespace errors.
