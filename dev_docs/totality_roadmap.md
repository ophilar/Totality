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

## Phase 26: Quality Metrics SSOT, Automated Currency & UI Convergence (Sub-Project 1) [In Progress]
- [x] Make `QualityAnalyzer` the sole producer of `efficiency_score`, `storage_debt_bytes`, and quality tiers for video items with defensible recoverable semantics.
- [x] Omit `efficiency_score` and `storage_debt_bytes` for music items in `QualityAnalyzer`, focusing strictly on quality fidelity tiers, completeness, and specs.
- [ ] Remove duplicate TV dry-run aggregation from `ShowOptimizationMetricsService.ts` and renderer-side duplicate calculations.
- [x] Derive TV show aggregate metrics (`total_size`, `total_recoverable_bytes`, `weighted_efficiency`) directly from child episode records in `TVShowRepository` without in-memory fallback arrays.
- [x] Enforce automated currency across scan/rescan, metadata edit, transcode completion, and quality settings updates.
- [x] Coerce analysis of existing unchanged files upon manual library scan by including `TaskType.QualityAnalysis` in `triggerPostScanAnalysis`.
- [x] Delete renderer-side `getQualityTier()` across `mediaUtils.ts`, `MusicView.tsx`, `TrackListItem.tsx`, and `MusicAlbumDetails.tsx`.
- [x] Remove misleading "Efficiency" and "Recoverable" headers and sort keys from `MusicView.tsx`, and remove empty `onClickQuality` callback.
- [x] Remove fragile custom memo comparator in `ShowCard.tsx` to fix stale React rendering and converge UI sort vocabulary.
- [ ] Verify 100% test pass rate across unit suites and production build.
