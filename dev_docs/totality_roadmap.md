# Totality Roadmap
## Phase 1: Core System & Media Analysis [Completed]
- Initial Media Library, SQLite Database, and Media Analyzer integration.

## Phase 2: Transcoding Subsystem & UI Redesign [Maintenance]
- [x] Brainstorming & Architecture Spec Approval
- [x] Implement `ITranscodeCommandBuilder` & Hardware Strategy Builders (`NvidiaCommandBuilder`, `IntelCommandBuilder`, `SoftwareCommandBuilder`)
- [x] Refactor `TranscodingService.ts` to use strategy pattern and zero-copy NVENC/QSV pipelines
- [x] Redesign `TranscodeModal.tsx` into 3-tab Wizard (`QuickPresetsTab`, `AdvancedTab`, `LiveEncodingTab`)
- [x] Unit & System Integration Verification
- [x] Cache the startup hardware snapshot and show detected devices only
- [ ] Exercise encoder-specific live transcoding on representative hardware
- [ ] Consider future Dolby Vision Profile 5 container handling; current output remains MKV

## Phase 3: Metadata Fusion & Acquisition Integration [Completed]
- [x] Concurrent provider fusion by shared external IDs and robust title/alias matching
- [x] Configurable TVDB provider and AniList/MusicBrainz identity enrichment
- [x] Optional Sonarr/Radarr configuration, read-only identity lookup, and explicit search commands
- [x] Persisted provider enablement and ordering preferences
- [x] Protected/Expanded terminology compatibility
- [x] Connect *arr lookup/search actions to media detail UI with confirmation and status polling
- [x] Add generic locked-match identity and alias persistence across movie, TV, and music
- [x] Replace JSON provider preferences with accessible controls
- [x] Complete responsive UI and sortable-column review across primary and secondary views
- [x] Add TVDB identity persistence and managed Sonarr lookup
- [x] Add provider enable/disable and ordering controls for keyless and API-key providers
- [x] Rename application-facing NSFW/adult terminology to Protected/Expanded while retaining TMDB compatibility fields

## Phase 4: Franchise Timelines & Plex Playlist Sync [Completed]
- [x] Brainstorming & Architecture Spec Approval
- [x] Implement `ITimelineRecipeProvider` strategy (Remote Registry & Trakt Provider)
- [x] Implement `TimelineResolutionEngine` for strict ID matching (`tmdbId`, `tvdbId`, `imdbId`)
- [x] Implement `PlexPlaylistSyncService` with Plex API CRUD and viewed status preservation
- [x] Build desktop UI for Timelines roadmap view, quality tags, and Sonarr/Radarr search triggers
- [x] End-to-end Vitest and Plex playlist synchronization verification
- [x] Implement Bundled Curated Presets (Star Trek Chronology/Release, Star Wars, MCU, DCEU, Alien) for offline resilience
- [x] Implement `WebGuideRecipeProvider` for universal internet viewing guides (IGN, startrekviewingguide.com, Rotten Tomatoes, etc.) and AI-assisted franchise generation
- [x] Enhanced multi-source timeline importer with real-time feedback and source badges in `TimelinesView.tsx`

## Phase 5: TV Show Batch Optimization & UI Performance [Completed]
- [x] Optimize UI responsiveness with abort-token sequence tracking and parameter debouncing in `TranscodeModal.tsx`
- [x] Throttle high-frequency live progress logging in `LiveEncodingTab.tsx`
- [x] Cache disk optimization decisions in `ConversionRecommendation.tsx` to eliminate redundant FFprobe invocations
- [x] Add visible "Optimize Series" action button to `TVShowDetails.tsx` header action bar
- [x] Modernize `ShowTranscodeModal.tsx` with glassmorphic cards, AV1/HEVC presets, and real-time preflight feedback
- [x] Fix modal z-index layering (`z-250`) and dropdown menu clipping in `EpisodeRow.tsx`
- [x] Full Vitest suite passing (134 test files, 1,017 tests)

## Phase 6: TV Show Canonical Single-Identity & Deduplication (TOT-BUG-03) [Completed]
- [x] Audit scanner and normalize series paths by stripping season folders and release tags
- [x] Enforce scoped DB uniqueness constraints on `(series_identity_key, source_id, library_id)`, `tvdb_id`, and `tmdb_id`
- [x] Implement in-place conflict-free upserts in `TVShowRepository`
- [x] Write database migration `mergeDuplicateSeriesCompleteness` to merge duplicate show clusters and repoint episodes
- [x] Add automated regression test suite (`tests/test_tv_deduplication.py` and `tests/unit/TVShowDeduplication.test.ts`)
- [x] Record ADR-001 in `DECISIONS.md` and update `Totality — Active Project.md` to `[test-verified]`

## Phase 7: Architecture Simplification, SOLID, & SSOT Refinements (ADR-003) [Completed]
- [x] Centralize extras and bonus detection in `FileNameParser` (SSOT) and eliminate duplicate regexes in `LocalFolderProvider`
- [x] Implement batch identity conflict querying in `IdentityRepository` and `TVShowRepository` to eliminate $N$ DB round-trips
- [x] Optimize `SeriesCompletenessService.analyzeAllSeries` with $O(1)$ set-based lookups and canonical identity key indexing
- [x] Consolidate startup index enforcement in `DatabaseMigration`

## Phase 8: Collection Direct Resolution, Music Filter Query Builders & Metadata Inverted Indexing (ADR-004) [Completed]
- [x] Enable direct TMDB collection ID resolution in `MovieCollectionService.analyzeCollection`
- [x] Consolidate album and track SQL filter generation in `MusicRepository` using single-responsibility condition builders
- [x] Implement $O(1)$ inverted index candidate deduplication in `MetadataMatchingService`

## Phase 9: Dolby Vision Profile 5 MKV-to-MP4 Remuxing & Transcoding Integration (ADR-005) [Planned]
- [ ] Implement `DolbyVisionRemuxService` for zero-loss MKV-to-MP4 stream copy with `dvh1` tagging and faststart optimization
- [ ] Update `HdrTranscodingPolicy` to support non-destructive Profile 5 container conversions while guarding against lossy re-encoding
- [ ] Integrate `dovi_tool` hybrid RPU extraction/injection pipeline for downsizing/re-encoding
- [ ] Restore `HandBrakeCLI` backend worker from git history (`commit 1707241` / `fafb9f4`) as an alternate engine strategy
- [ ] Generate exportable HandBrake `.json` presets tuned for RTX 5070 Ti NVENC 10-bit AV1/HEVC encoding

## Phase 10: UI Responsiveness, Timelines Viewport, Dolby Vision Detection & Transcoding Visibility [Completed]
- [x] Fix Dolby Vision `"dovi"` side data detection in `mediaContracts.ts` and `MediaFileAnalyzer.ts` so DV items display purple badges instead of falling back to HDR10
- [x] Add codec bitrate estimation helper to `AudioCodecRanker.ts` and integrate into `OptimizationDecisionService.ts` for universal audio track removal/transcoding estimates
- [x] Refactor `TimelinesView.tsx` with a unified scrollable container and compact recipe selector to unblock viewport, timeline items, and Plex playlist sync
- [x] Connect `ShowTranscodeModal.tsx` directly to live task queue progress via `ToastContext` and batch drawer tracking
- [x] Fix `EpisodeRow.tsx` 3-dot dropdown z-index stacking context and align quick actions with `MediaDetails.tsx`
- [x] Add instant `useToast()` feedback and diagnostic messages to Sonarr/Radarr test connection buttons in `ServicesTab.tsx`

## Known follow-ups

- Add dedicated settings cards for future API-key providers beyond the currently supported OMDb/TVDB configuration paths.
- TMDB's external `adult` field remains unchanged because it is part of the upstream API contract.

## Phase 11: Title-to-ID Matching, Direct ID Precedence & NSFW Resolution [Completed]
- [x] Implement direct external ID resolution precedence in `MetadataMatchingService` and `CompositeMetadataProvider` for Plex, Kodi, and Jellyfin sources
- [x] Update `selectAutomaticMatch` to guarantee instant resolution on matching external IDs
- [x] Fix numeric title normalization (*1984*, *2001*, *1917*, *300*) in `TitleMatching.ts`
- [x] Incorporate `alternateTitles` scoring into candidate re-ranking in `MetadataMatchingService.ts`
- [x] Pass `includeAdult` / `includeExpanded` through `LocalFolderProvider` movie and episode scanning flows
- [x] Relax mandatory `tmdbId` constraint in `database.ts` and `series.ts` `FIX_MATCH` handlers to support pure IMDb, TVDB, and AniList matches
- [x] Full regression verification across all unit and integration test suites (137 test files, 1,031 tests passing, 0 typecheck errors)

## Phase 12: MusicBrainz Monotonic Rate Limiting & Adult / Scene Title Resolution [Completed]
- [x] Refactor `SimpleDelayRateLimiter` to monotonic timestamp scheduling to eliminate concurrency race condition bursts
- [x] Eliminate parallel bursts in `MusicBrainzService.getArtistDiscography` to maintain strict 1 req/s compliance
- [x] Implement `isPlaceholderMusicTitle` pre-validation to intercept and skip untagged/fallback music titles
- [x] Add circuit breaker fault tolerance in `MusicBrainzService.analyzeAllMusic` against persistent network drops
- [x] Enhance `selectAutomaticMatch` with multi-tier Strategy Pattern (Direct ID, Exact Title + Exact/Fuzzy Year, Top Exact Title, and High Confidence Score Winner)
- [x] Normalize Roman numerals (`II` -> `2`) and adult/scene noise tokens in `TitleMatching.ts`
- [x] Strip studio/site prefixes during candidate query generation in `MetadataMatchingService.ts`
- [x] Fix `isExtrasContent` false positive filtering on numbered scene titles in `FileNameParser.ts`
- [x] Fix TV show search year parameter (`first_air_date_year`) in `TMDBMetadataProvider.ts`
- [x] Integrate live transcoding telemetry (FPS, Speed Multiplier, ETA) directly into `ActivityPanel` for 1-click global monitoring
- [x] Verify type safety (`tsc --noEmit`) and unit test suite passing (104 tests passing across 5 core test suites)

## Phase 13: Storage Safety Guardrails, Quarantine Integrity & Timeline Franchise Sync [Completed]
- [x] Retain original source video extension (`.mp4`, `.avi`, `.mkv`, `.ts`, `.webm`) on quarantine backup files in `TranscodingService.ts` to ensure backups remain fully playable.
- [x] Implement intelligent bitrate ceiling in `NvidiaCommandBuilder.ts` based on source stream bitrate / duration to prevent NVENC VBR file size inflation on low-bitrate sources.
- [x] Add size check in `TranscodingService.ts` aborting replacement if transcoded output exceeds source file size in `quarantine-replace` mode.
- [x] Expand `type: 'show'` timeline items into constituent chronological episodes in `TimelineResolutionEngine.ts` with season range parsing for Star Trek franchise watch orders and Plex playlist sync.
- [x] Throttle FFmpeg progress updates in `TranscodingService.ts` to 250ms (4 Hz) to eliminate IPC bottleneck and UI sluggishness.
- [x] Wire "Optimize Series" action button into `ShowListItem.tsx` and standardize modal z-index hierarchy (`z-50`).
- [x] Full regression test suite passing (139 test files, 1,052/1,052 tests passing).

## Phase 14: Diagnostic Observability & Notification Logging [Completed]
- [x] Integrate structured logging in `NotificationRepository.addNotification` to emit all created notifications (errors, task failures, warnings, info) to `LoggingService`.
- [x] Verified diagnostic and file logging traceability with full unit test coverage (144 test files, 1088/1088 tests passing).

## Phase 15: Language Decision & Analysis Diagnostics Logging [Completed]
- [x] Add detailed warning logging for unknown original language, missing stream tags, and evidence conflicts in `LanguageDecisionService.ts`.
- [x] Add intermediate error and warning diagnostics across `MovieCollectionService.ts` and `SeriesCompletenessService.ts`.
- [x] Enhance extras filtering in `FileNameParser.ts` and skip invalid scraping queries during collection analysis.
- [x] Sanitize TMDB response logs in `TMDBService.ts` to eliminate `total_results: undefined` on entity details.

## Phase 16: TV Show Runtime Deduplication & Canonical Consolidation [Completed]
- [x] Expose `mergeDuplicateShows` in `TVShowRepository` as canonical clustering and merge service.
- [x] Enhance `TVShowRepository.upsertCompleteness` matching with normalized titles, clean titles, and computed unresolved keys.
- [x] Deduplicate analysis queues and automatically merge duplicate clusters after post-scan analysis in `SeriesCompletenessService`.
- [x] Trigger series deduplication during duplicate scans in `DeduplicationService` and after manual matches in `series:fixMatch`.
- [x] Verify full regression test suite (144 test files, 1,091 tests passing).

## Phase 17: Fine-Resolution Episode-Interleaved Timelines & Viewing Orders [Completed]
- [x] Brainstorming & Architecture Spec Approval (`docs/superpowers/specs/2026-08-27-episode-interleaved-timelines-design.md`)
- [x] Implement complete interleaved episode-level presets for Star Trek, Star Wars, and MCU in `bundledRecipes.ts`
- [x] Align `WebGuideRecipeProvider.ts` and `TimelineResolutionEngine.ts` for fine-resolution episode-by-episode resolution
- [x] Update Plex Playlist Sync to sequence 100% fine-grained mixed movie/episode lists
- [x] Unit & integration test verification (144 test files, 1,091 tests passing)

## Phase 18: TRaSH Guides Optimization, Audio Pruning & Subtitle Whitelist [Completed]
- [x] Integrate TRaSH Guides quality tier classification (`Remux`, `WEB-DL`, `WEBRip`, `BluRay`, `HDTV`, `SDTV`) and stream pruning rules in `MediaFileAnalyzer` and `QualityAnalyzer`
- [x] Implement 3 optimization strategies (`smart`, `remux_only`, `transcode`) with lossless stream copy container cleanup (`-c:v copy`)
- [x] Implement subtitle language whitelist configuration and filtering across backend transcoding pipeline and UI
- [x] Build interactive Preflight Preview Plan modal with TRaSH Source Tier badges, Advisory Badges, and action counters in `ShowTranscodeModal.tsx`
- [x] Add global Subtitle Stream Preferences in Settings `GeneralTab.tsx`
- [x] Full TypeScript typecheck and Vitest regression verification (148 test files, 1,131 tests passing)
- [x] Canonical fine-grained episode interleaving for Star Trek (TNG S6/DS9 S1, TNG S7/DS9 S2, DS9/VOY) and isolated curated presets in RemoteRegistryRecipeProvider

## Phase 19: Media Safety and Timeline Hardening [Completed]
- [x] Preserve timeline cache records during versioned migration and log invalid payloads instead of deleting them.
- [x] Enforce quarantine replacement for lossy transcodes; direct replacement is limited to verified stream-copy/remux work.
- [x] Persist the latest task queue state before renderer notification so reconnecting renderers read the authoritative state.
- [x] Report ShowTranscodeModal failures through application logging and remove renderer list-key warnings.

## Phase 20: Correctness, Security & Architectural Hardening [Completed]
- [x] Fix path authorization containment and eliminate allow-on-unknown bypass in `local-artwork` and `MediaPathAuthorization`
- [x] Implement atomic export/import and strict transaction batch management in `BetterSQLiteService`
- [x] Align database schema Single Source of Truth (SSOT) via Drizzle ORM definitions and migrations
- [x] Eliminate sentinel fake episode records (`mediaItemId: 0`, `"Unknown"`) from TV preflight analysis and propagate real failures
- [x] Ensure `QualityAnalyzer` preserves unknown/error states without injecting synthetic zero bitrates or SD defaults
- [x] Implement explicit GPU vendor strategy in `TranscodeCommandFactory` to prevent silent fallback to software encoding
- [x] Eliminate test overrides and PATH binary fallbacks from `MediaFileAnalyzer`
- [x] Consolidate IPC handler registration pipelines (`createHandler` / `genericHandlers`)
- [x] Unify provider definitions and instantiation into a single-source registry
- [x] Eliminate silent error swallowing in `safeSend` and unify `SectionErrorBoundary`
- [x] Full TypeScript typecheck and Vitest regression verification (158 test files, 1,203 tests passing)

## Phase 21: Home TV Completeness, Green CI Gate & Release Polish [Completed]
- [x] Restore Home TV completeness data contract across `SourceContext`, `Dashboard`, and `SeriesCompletenessService`.
- [x] Fix dismissal exclusion types (`series_episode` and `artist_album`) in `Dashboard.tsx`.
- [x] Make test suites cross-platform (`DatabasePath.test.ts`, `TranscodingService.test.ts`) for Linux/POSIX CI compatibility.
- [x] Harden database migration error handling to fail fast on unexpected baseline schema execution failures.
- [x] Preserve `null` semantics for unmeasured stream evidence in `QualityAnalyzer.analyzeVersion`.
- [x] Enforce sender frame security validation across all IPC handlers.
- [x] Prevent database shutdown races and guarantee task queue interruption persistence on quit.
- [x] Enable Chromium GPU hardware acceleration in main process.
## Phase 22: Analysis Reliability, Provider Identity & Media UX Unification [Completed]
- [x] Shared Analysis Outcome & Diagnostic Contracts: Created typed contracts (`AnalysisStatus`, `AnalysisDiagnostic`, `AnalysisOutcome`, `CalculationStatus`, `OptimizationMetricsSummary`) in `src/main/types/database.ts`.
- [x] Database Transaction Isolation: Depth evaluation in `BetterSQLiteService.ts` before mutex acquisition preventing deadlock on nested `withBatch` calls.
- [x] MediaMonkey Scanning Throughput: Chunked song upserts in batches of 500 in `MediaMonkeyProvider.ts` via `bulkUpsertTracks`.
- [x] MusicBrainz Analysis & Exact Deferred Work: Decoupled artist/album queues, exact deferred calculations, and 5-consecutive-error circuit breaker in `MusicBrainzService.ts`.
- [x] Provider-Authoritative Series Resolution: 5-tier resolution (`user_fixed_match` -> canonical identity -> tmdb_id -> clean exact -> fuzzy match), immutable lock protection, and atomic stale TMDB identity cleanup in `SeriesCompletenessService.ts`.
- [x] Decomposed SQLite Diagnostics & Conflict Resolution: Created `parseDatabaseError` and resolved unique index collision in `TVShowRepository.upsertCompleteness`.
- [x] Unified Movie & TV Optimization Calculations: Implemented `getOptimizationMetricsSummary` and dual-metric calculated sorting in `MediaRepository.ts` and `TVShowRepository.ts`.
- [x] Shared Media UX Components: Built `EvidenceStatusBadge.tsx`, `EfficiencyDisplay.tsx`, `RecoverableWasteDisplay.tsx`, and `OptimizationMetrics.tsx` and integrated across `MoviesView.tsx`, `ShowCard.tsx`, and `ShowListItem.tsx`.
- [x] Task Queue Integration: Integrated `AnalysisOutcome` tracking into `TaskQueueService.ts` and consolidated single notifications for series and music scan batches.
- [x] Verification Suite: Verified clean typecheck (`npm run typecheck`), 100% Vitest pass rate (165 test files, 1,251 tests passing), and clean production release build (`Totality-Setup-0.5.0.exe`).

## Phase 23: Complete Movie & TV UI Parity & Authoritative External ID Matching [Completed]
- [x] Authoritative IMDb-first resolution in `MovieCollectionService.ts` via `findByExternalId(m.imdb_id, 'imdb_id')` before title search and fallback on stale IDs.
- [x] Exact UI parity between Movie and TV Show cards and list items: integrated canonical metrics row (`Size · RecoverableWasteDisplay · EfficiencyDisplay · EvidenceStatusBadge`) with zero data loss.
- [x] Header-level `OptimizationMetrics` banner summary across both Movies and TV Shows.
- [x] Strict fail-fast hygiene: zero fallbacks, silent errors, synthetic byte counts, or duplicate verifications across services and components.
- [x] Full regression test suite passing (166 test files, 1,253/1,253 tests passing).

## Phase 24: Deduplicated SOLID Components & TV Shows Season/Episode Precision [Completed]
- [x] Extracted [`MediaMetricsRow.tsx`](file:///H:/Totality/src/renderer/src/components/library/MediaMetricsRow.tsx) eliminating metric markup duplication across `MovieCard` and `ShowCard`.
- [x] Extracted [`calculateOptimizationSummary`](file:///H:/Totality/src/renderer/src/components/library/optimizationSummary.ts) pure function eliminating calculation duplication between `MoviesView.tsx` and `TVShowsView.tsx`.
- [x] Unified `formatBytes` usage from canonical SSOT [`mediaUtils.ts`](file:///H:/Totality/src/renderer/src/components/library/mediaUtils.ts).
- [x] Fixed TV Show season count precision in [`TVShowRepository.ts`](file:///H:/Totality/src/main/database/repositories/TVShowRepository.ts) by selecting distinct seasons from episode records, eliminating the `0 Seasons` bug for unanalyzed/local shows.
- [x] Full regression test suite passing (166 test files, 1,259/1,259 tests passing, 100%).

## Phase 25: Build Size Optimization, Recoverable Terminology & UI Responsiveness [Completed]
- [x] Configured NSIS maximum solid compression in `electron-builder.yml` to significantly reduce installer executable size.
- [x] Standardized optimization terminology across Movies, TV Shows, and Music to "Recoverable" in `sortDefinitions.ts`, `MoviesView.tsx`, `MusicView.tsx`, and `MediaBrowser.tsx`.
- [x] Fixed `MediaItemFiltersSchema` validation by permitting legacy/cross-view keys (`waste`, `weighted_efficiency`) alongside `recoverable`.
- [x] Prevented UI freezes by debouncing `onLibraryUpdated` in `usePaginatedData.ts` (400ms) and yielding the main-thread event loop with `setImmediate` in `SeriesCompletenessService.analyzeAllSeries`.
- [x] Fixed notification contract in `SeriesCompletenessService.ts` by returning `processedCount` and `totalCount`, eliminating `undefined analyzed` notices.
- [x] Full regression test suite passing (166 test files, 1,259/1,259 tests passing, 100%).

## Phase 26: Quality Metrics SSOT, Automated Currency & UI Convergence (Sub-Project 1) [Completed]
- [x] Make `QualityAnalyzer` the sole producer of `efficiency_score`, `storage_debt_bytes`, and quality tiers for video items with defensible recoverable semantics.
- [x] Omit `efficiency_score` and `storage_debt_bytes` for music items in `QualityAnalyzer`, focusing strictly on quality fidelity tiers, completeness, and specs.
- [x] Verify stored episode analysis consumption in `ShowOptimizationMetricsService.ts` and renderer-side duplicate calculation pruning.
- [x] Derive TV show aggregate metrics (`total_size`, `total_recoverable_bytes`, `weighted_efficiency`) directly from child episode records in `TVShowRepository` without in-memory fallback arrays.
- [x] Enforce automated currency across scan/rescan, metadata edit, transcode completion, and quality settings updates.
- [x] Coerce analysis of existing unchanged files upon manual library scan by including `TaskType.QualityAnalysis` in `triggerPostScanAnalysis`.
- [x] Delete renderer-side `getQualityTier()` across `mediaUtils.ts`, `MusicView.tsx`, `TrackListItem.tsx`, and `MusicAlbumDetails.tsx`.
- [x] Remove misleading "Efficiency" and "Recoverable" headers and sort keys from `MusicView.tsx`, and remove empty `onClickQuality` callback.
- [x] Remove fragile custom memo comparator in `ShowCard.tsx` to fix stale React rendering and converge UI sort vocabulary.
- [x] Verify 100% test pass rate across unit suites (168 test files, 1,288 tests passing).

## Phase 27: UI Freezes Elimination & Full-TV Optimization Repair (Sub-Project 2) [Completed]
- [x] Eliminate stale pagination data race with request generation counters (`requestGenerationRef`) in `usePaginatedData.ts`.
- [x] Yield event loop with `setImmediate` in `MovieCollectionService.ts` batch processing to prevent UI lockups.
- [x] Implement per-file unique measurement directory isolation (`.totality-measurements-${fileHash}`) with `finally` cleanup in `TranscodingService.ts`.
- [x] Make show preflight resilient to individual episode failures; allow queueing when partially compatible without failing entire season.
- [x] Add regression test suite verifying partial compatibility queueing and isolated measurement workspace cleanup (19/19 tests passing).

## Phase 28: Crash-Consistent Replacement Journal & Fault-Injection Tests (Step 7) [Completed]
- [x] Write `outputStats` (`fileSize`, `duration`, `video`, `audioTracks`) into media replacement activation journal before destructive file replacement in `TranscodingService.ts`.
- [x] In `recoverActivationJournals()`, handle crash scenarios:
  - If source was quarantined and target was not placed &rarr; roll back quarantine to original file path and delete journal (zero data loss).
  - If target was placed/activated but process terminated before DB synchronization &rarr; update database path and stats (`updatePathAndStats`) using journal stats and delete journal (zero orphaned state).
  - If prepared state without movement &rarr; cleanly discard prepared journal.
- [x] Added fault-injection and journal recovery unit tests in `tests/unit/services/TranscodingService.test.ts` (21/21 tests passing).

## Phase 29: Transactional SQLite Migrations (Step 8) [Completed]
- [x] Wrap data transformation loops in `DatabaseMigration.ts` in atomic `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` blocks.
- [x] Made `backfillMediaIdentities` execute inside transaction with rollback on failure.
- [x] Made `markLegacyZeroScoresInsufficient` execute inside transaction with rollback on failure.
- [x] Verified `rebuildTableWhenNeeded` and `cleanupOrphanedRecords` execute atomically with transaction-safe table migration.
- [x] Verified database migration test suite in `tests/unit/DatabaseMigration.test.ts` (5/5 tests passing).

## Phase 30: Fail-Closed Security & Packaging Verification (Step 9) [Completed]
- [x] Enforce fail-closed sender frame validation in `src/main/ipc/utils/createHandler.ts`.
- [x] Throw `Unauthorized IPC sender frame` on missing event, missing sender frame, or non-whitelisted remote origin URLs.
- [x] Whitelist only trusted local origins: `file://`, `app://`, `localhost`, `127.0.0.1`, and `local-artwork://`.
- [x] Add dedicated sender frame security unit tests in `tests/unit/IpcValidation.test.ts` (71/71 tests passing).
- [x] Verify full TypeScript typecheck (`npm run typecheck`) cleanly passes with 0 errors.
- [x] Verify full Vitest suite (168 test files, 1,296/1,296 tests passing, 100%).
- [x] Verify Windows production packaging bundle (`npm run build`) cleanly creates `release/Totality-Setup-0.5.0.exe` and `release/win-unpacked/Totality.exe`.

## Phase 31: Audio Track Protection SSOT & Remote Branch Hygiene [Completed]
- [x] Port applicable import alias cleanups from `fix/remove-unused-import-alias-6756725909868916101` and `remove-unused-toast-type-import-1694350168243227804` onto `master`.
- [x] Prune 15 merged, closed, superseded, and obsolete remote branches on `origin` after verifying non-default status.
- [x] Retain and clean-port PR #152 (`refactor/extract-audio-track-utils-1449766582793748380`) onto latest `master`.
- [x] Centralize audio track protection logic into `src/main/services/utils/audioTrackUtils.ts` (`isCommentaryTrack`, `isAudioDescriptionTrack`, `isAccessibilityTrack`, `isProtectedAudioTrack`).
- [x] Preserve existing audio-protection behavior and strict metadata contracts (`metadataString` validation in `QualityAnalyzer.ts`).
- [x] Verify TypeScript typecheck (0 errors) and unit test suite (38/38 audio tests passing).

## Phase 32: Safe Operational Vertical Slice & Architectural Directives [Completed]
- [x] Implemented and verified the 6-stage safe optimization operational vertical slice in `SafeOptimizationSliceService.ts`:
  1. `getReadOnlyInventory`: Discovers media state with explicit scope; unavailable sources never masked as empty collections.
  2. `generateProposedActions`: Transparent, inspectable proposals explaining what and why with explicit evidence metrics.
  3. `executeDryRun`: Dry-run planning pipeline classifying executable, blocked, and invalid without mutations.
  4. `verifyRecoverability`: Verified quarantine writeability and atomic rollback guarantee prior to mutation.
  5. `executeBoundedOptimization`: Strictly bounded batch (max 1 item); zero silent software/GPU fallback; real atomic swap with rollback.
  6. `recordAuditLog`: Append-only JSONL execution audit log with inputs, proposal, actual outcome, and recovery evidence.
- [x] Verified full 10/10 test suite in `tests/unit/services/SafeOptimizationSliceService.test.ts`.
- [x] Aligned TV completeness contract (TOT-BUG-05) and episode exclusion keying (`StatsRepository.ts`, `Dashboard.tsx`).
- [x] Unified Show and Mixed library capabilities in `Sidebar.tsx`.
- [x] Enforced strict fail-fast migration policy without catch-and-continue (TOT-BUG-07).
- [x] Hardened evidence correctness: missing metrics remain `null`, insufficient evidence blocks optimization (TOT-BUG-08).
- [x] Centralized IPC sender frame verification across all handlers including `app:openExternal`, `plex:selectServer`, and `APP.GET_VERSION` (TOT-BUG-10).
- [x] Standardized ordered shutdown coordinator (stop work &rarr; settle operations &rarr; persist state &rarr; checkpoint WAL &rarr; close DB &rarr; exit) (TOT-BUG-11).
- [x] Enforced explicit partial-failure semantics on source scans and completeness analysis (TOT-BUG-12).
- [x] Removed guessed `'ffmpeg'` executable fallback in `MediaFileAnalyzer.ts`.
- [x] Consolidated optimization vertical slice into canonical `LanguageRemuxService.ts` and eliminated redundant 880-line `SafeOptimizationSliceService.ts` wrapper layer for net-negative lines of code.
- [x] Updated `Totality — Active Project.md` to reference projection, establishing Command Center as mutable operational SSOT.

## Phase 33: Upstream Feature Porting & Acceptance Integration [Completed]
- [x] Consolidate remote branches and PRs: prune 10 stale remote branches (`origin/fix/*`), merge `feat/totality-safe-operational-slice`, audit PR #166 and prune merged branch `remotes/origin/totality-safety-contracts-fix`, ensuring `master` is the sole clean branch.
- [x] Implement native fetch `httpClient.ts` replacing `axios` in `UdpDiscoveryService.ts`.
- [x] Implement 30s task execution watchdog in `FFprobeWorkerPool.ts` to terminate hung child processes.
- [x] Enforce fail-closed credential encryption in `CredentialEncryptionService.ts`.
- [x] Preserve `release_date` on collection movies in `MovieCollectionService.ts`, `database.ts`, and `CompletenessEngine.ts`.
- [x] Establish shared setting keys SSOT under `@shared/settingKeys` with tsconfig, vite, and vitest path aliases.
- [x] Add "Dismiss all missing" in `CollectionModal.tsx`, integrate into `useDismissHandlers.ts` and `MediaBrowser.tsx`.
- [x] Add TV empty seasons and movie theatrical lag settings controls to `LibrarySettingsTab.tsx`.
- [x] Debounce library task completion events (250ms trailing) in `useLibraryEventListeners.ts` to prevent UI render storms.
- [x] Implement integration acceptance test suite `tests/integration/CriticalFlowsAcceptance.test.ts` verifying privileged IPC authorization, database persistence, safe remux recoverability and audit logs, and completeness invariants.
- [x] Rectify test harnesses post-upstream merge: bind database exclusion channels to `tests/TestUtils.ts` bridge, update `UdpDiscoveryService.test.ts` to test `fetchJSON` contracts, and advance timers for debounced task queue completion in `useLibraryEventListeners.test.tsx`.
- [x] Verify full test suite across entire repository (`npx vitest run`): 185/185 test files passing (1,394/1,394 tests, 0 errors, 0 unhandled rejections).
- [x] Verify full TypeScript typecheck (`npx tsc --noEmit`) clean 0 errors.

## Phase 34: TV Show Series Identity Key Realignment & Episode Inventory Recovery [Completed]
- [x] Fixed root cause of TV shows not showing all episodes on disk (only 1 or 0 episodes appearing per show).
- [x] Prevented individual episode TMDB/TVDB external IDs from being passed to `deriveSeriesIdentityKey` in `MediaTransformer.fromPlex`, `fromJellyfin`, and `fromKodi`.
- [x] Enhanced `PlexProvider.scanLibrary` to request `includeGuids: 1` and fetch canonical show metadata so `showTmdbId` and `showTvdbId` are consistently propagated to all child episodes.
- [x] Extended `updateEpisodeMetadata` and `updateBatchEpisodeMetadata` in `MediaRepository` and `TVShowRepository` to accept `seriesIdentityKey`.
- [x] Backfilled `seriesIdentityKey` synchronously when updating episode metadata in `SeriesCompletenessService.analyzeSeries`.
- [x] Added database migration in `SeriesIdentityMigration.ts` realigning historical mismatched `series_identity_key` on `media_items` and `series_completeness` to the canonical series key.
- [x] Added automated regression test in `tests/unit/database/SeriesIdentityMigration.test.ts` verifying full episode list recovery and summary accuracy.
- [x] Verified full repository test suite (`npx vitest run`): 201/201 test files passing (1,597/1,597 tests passing, 0 failures).

## Phase 35: System Architecture Audit — ID SSOT, Duplicate Prevention & UI Responsiveness [In Progress]
- [x] Audited entity identity architecture: verified `media_identities` vs denormalized `media_items` / `series_completeness` columns and established `series_identity_key` as the invariant SSOT for television series.
- [x] Audited database duplication in user database (`totality.db`): identified two distinct categories (multi-row show completeness clusters caused by legacy episode identity keys vs multi-source physical file duplication caused by concurrent Plex and Local sources pointing to `E:\Media`).
- [x] Audited UI unresponsiveness root causes via 26,477-line production log: identified MusicBrainz 503 rate-limit retries (68% of log volume), sub-second SQLite state serialization in `TaskQueueService`, and un-throttled React full-library re-querying across IPC.
- [ ] Implement TaskQueueService progress write throttling and IPC debouncing to eliminate renderer freeze under background analysis storms.

## TV optimization and online viewing orders — 2026-09-30
- [x] Carry approved per-episode plans, real measurements, conversions and retained playback samples through existing optimization APIs.
- [x] Verify and journal activation, persist complete output analysis, account for retained originals and physical recovery, and scope show controls by batch.
- [x] Refresh online guide snapshots, resolve within the selected source, retain completeness placeholders and publish verified staged Plex sequences.
- [x] Validate real software/hardware encoding, genuine HDR clips, built-app preflight and disposable live Plex operations.
- [ ] Validate additional Dolby Vision profiles and the full encoder/color/container matrix on physical target devices. See `specs/tv-optimization-online-order/verification.md` for the verified boundary.

## Test and dependency maintenance - 2026-10-02
- [x] Upgrade all currently compatible direct packages and document incompatible newer majors.
- [x] Consolidate redundant test suites and correct lifecycle resource ownership.
- [x] Fix the joined TV show alphabet query reported by the installed-app log.
- [x] Build the complete Windows installer with Electron 44.5.1.
- [ ] Establish the cause of the intermittent native lifecycle access violation; a passing rerun alone does not establish resolution.

## Database summaries, analysis, and item optimization - 2026-10-02
- [x] Repair compact FFprobe packet parsing, normalized codec scoring, and evidence-basis persistence.
- [x] Make the app back up and transactionally reconcile verified unlocked orphan TV summaries after a successful scoped scan.
- [x] Enable movie/episode Optimize controls through the shared preflight, sample review, approval, and queue path; make preflight refresh and persist analysis itself.
- [x] Preserve provider failures in task outcomes, enrich Plex audio metadata from local analysis, and refresh stale TMDB movie collection recipes.
- [x] Finish lower-concurrency full-suite validation and build the Windows installer; renderer and service flows pass component and integration tests.
- [ ] Launch the packaged installer build against an isolated user-data directory and verify Optimize interaction visually.

## TV analysis cleanup convergence - 2026-10-02
- [x] Make successful TV series analysis own its backup and stale-summary reconciliation for every affected source/library scope, independent of whether the caller supplied a library ID.
- [x] Remove the task queue's separate cleanup implementation so all-series callers share one app-owned data workflow.

## Unified analysis queue and optimization convergence - 2026-10-02
- [x] Route scoped analysis requests and successful scan follow-up through persisted analysis jobs planned by `AnalysisTaskPlanner`.
- [x] Add artist scope, scoped music filters, serialized queue acceptance, cancellation by task ID, and explicit stage outcomes.
- [x] Route stream pruning through reviewed preflight and queued optimization; remove renderer-callable direct remux and obsolete series-analysis/dry-run entry points.
  - [x] Run full automated suite and Windows package build; packaged UI and live database flows remain acceptance gates.
  - [ ] Exercise packaged UI and real-database scan, scoped cleanup, restart, cancellation, and optimization flows.
# 2026-10-03 — UI responsiveness and cancellation

- Implemented library refresh ownership/coalescing, stale-result protection, TMDB draft testing, guided playback target editing, collection partial outcomes, and cancellation for provider waits, TMDB tests, AI chat/reports, and existing queued tasks.
- Verification passed: `npm test` (208 files passed, 2 skipped; 1,600 tests passed, 7 skipped) and packaged Windows `npm run build`.
- Remaining acceptance: standalone operation cancellation audit, packaged performance comparison, constrained playback layout, and live TMDB key test.
- Details and boundaries are recorded in `totality_work_log_20261003.md` and `specs/ui-responsiveness-cancellation/spec.md`.

## 2026-10-03 — Cancellation plumbing continuation [In Progress]
- [x] Add renderer-scoped cancellation registry for direct long operations, with owner teardown and explicit pre-commit/committing state.
- [x] Add cancellable database JSON/CSV export, pre-commit transactional import cancellation, and duplicate scan cancellation; retain existing task-queue ownership for queued work.
- [x] Verify focused real-database/registry regressions, complete test suite, Windows package build, and whitespace checks.
- [ ] Complete cancellation audit and implementation for timeline operations, metadata/source-provider actions, Arr command waits, and update downloads; establish documented native cancellation boundaries.
- [ ] Complete live packaged performance comparison, constrained playback layout review, live TMDB credential test, and cancellation acceptance for every user-started long action.
- [x] Add cancellation and a reachable control for timeline resolution/import/refresh, with cancellation checks between library-matching batches and an explicit snapshot commit boundary.
- [ ] Implement/report cancellation for Plex playlist sync, metadata and source-provider actions, Arr command waits, and update downloads after documenting each owner's commit or external-acceptance boundary.
- [ ] Complete live packaged performance, playback layout, TMDB credential, and full action-cancellation acceptance.
- [x] Add cancellation for auto-update downloads through electron-updater's native CancellationToken; disclose the uncancellable install boundary.
- [x] Add cancellation for Sonarr command polling and disclose that an accepted external search command continues after Totality stops waiting.
- [ ] Continue cancellation coverage for Plex playlist sync and metadata/source-provider request flows; complete live acceptance.
- [x] Propagate Sonarr command-wait cancellation through HTTP requests and abortable polling delays; explain the accepted-command boundary in the UI.
- [ ] Implement cancellation for Plex staged playlist publication and remaining metadata/source-provider flows; verify all other long actions against the visible cancellation contract.
- [x] Centralize direct background-operation state, cancellation, retained outcomes, and on-demand results in Activity; keep queue controls scoped to queued tasks and preserve AI/timeline results after view closure.
- [ ] Complete provider/Plex cancellation audit and live packaged performance, playback-layout, and TMDB credential acceptance.

2026-10-03: Automatic TMDB startup/saved-key validation implemented; live credential/UI acceptance remains pending.

## Automatic service health and background operations — 2026-10-03 [In Progress]
- [x] Add automatic, revisioned TMDB and Gemini saved-credential checks; preserve manual draft testing.
- [x] Remove renderer-owned periodic source health checks; check only on configuration/enablement changes and discard stale responses.
- [x] Verify source access through provider-owned read paths, including Plex/Jellyfin/Emby library access and non-recursive local directory checks.
- [x] Keep GPU selection explicit; coalesce updater checks, expose download cancellation, and remove repeated update notifications.
- [x] Record the full implementation plan and action-by-action cancellation audit under `specs/automatic-service-health/`.
- [x] Move OMDb, TVDB, MusicBrainz, Sonarr, and Radarr saved status checks into provider-owned automatic health state and remove renderer-side provider fetches.
- [ ] Close the cancellation audit for metadata/source authentication and discovery, preflight/compatibility, Plex playlist publication, and all remaining user-started long actions.
- [ ] Complete live packaged performance comparison, saved TMDB validation, constrained/200% playback review, and Activity/cancellation acceptance. Keep this phase open until those checks pass.
- Verification: `npm test` passed (209 files; 1,609 passed, 7 skipped); packaged `npm run build` passed and created `release/Totality-Setup-0.5.1.exe`.
- [x] Add automatic saved-configuration health checks for OMDb, TVDB, MusicBrainz, Sonarr, and Radarr; retain status and retry/cancel state in main-process service ownership.
- [ ] Complete cancellation coverage for metadata/source actions, preflight/compatibility, and Plex playlist publication; complete packaged live acceptance.
- [x] Cancel foreground Match Fix metadata searches through the existing operation registry, propagate AbortSignal through provider fusion/search requests, discard post-cancel results, and return an explicit cancelled outcome.
- [ ] Complete cancellation for source authentication/discovery, preflight/compatibility, Plex playlist publication, and remaining action paths; verify packaged live behavior.

2026-10-04: Plex playlist sync now uses Activity cancellation through staging and verification; publication is the commit boundary. Focused tests, full suite, and packaged build passed. Source authentication/discovery, preflight/compatibility, remaining action audit, and live acceptance remain open.

2026-10-04: Jellyfin/Emby UDP discovery now stops when the setup dialog closes, with no additional UI controls. Focused checks and TypeScript passed; the full suite had an intermittent AutoUpdateService native worker crash (3221225477), and the packaged build passed. Remaining source auth/test flows and live acceptance are open.

2026-10-04: Cancellation surface refined: short automatic discovery and timeline loads stay quiet; saved health checks show status and Retry without Cancel. Global search now hides old-query results and exposes retryable failures. Paginated source/filter resets serialize against active reads. New playback profiles require explicit capability choices and the shared IPC schema rejects invalid required values. Final `npm test` passed (210 files; 1,613 passed, 7 skipped); packaged build passed. Live library performance, TMDB key, constrained playback layout, and remaining source/preflight cancellation acceptance remain open.

2026-10-04 verification update: paginated sections discard results after deactivation. Final full suite passed (210 files; 1,614 passed, 7 skipped); final packaged Windows build succeeded. Live UI and real-library gates remain unverified.

- [x] Combine complete-analysis packet accounting and bitrate-window metrics into one exact FFprobe pass; retain exact audio volume analysis.
- [x] Preserve post-scan analysis queue failures as explicit partial scan outcomes and keep cancellation out of error notifications.
- [x] Let Activity clear all completed queue history while retaining active work; show verified encoders only in Settings.
- [ ] Validate responsiveness and cancellation against the actual library in the packaged app; inspect legacy timeline cache behavior before any cleanup.
- Verification 2026-10-05: focused regression checks passed (6 files, 41 tests); full `npm test` passed (210 files, 1,616 passed, 7 skipped); packaged `npm run build` passed.

## Activity and optimization review — 2026-10-05
- [x] Show recent analysis summaries inside the chronological Notifications feed; remove the separate Recent analysis panel.
- [x] Keep task-history clearing distinct from clearing persisted notifications.
- [x] Make show optimization preflight cancellable through its existing operation registry; propagate cancellation through measured FFmpeg samples and sample analysis, stop later batches, and prevent cancelled reviews from being persisted.
- [x] Report a no-change source that fails the selected playback profile as incompatible, not already optimized.
- Verification: `npm test` passed (210 files; 1,616 passed, 7 skipped); `npm run build` passed. Real-library UI and performance acceptance remain unverified.
