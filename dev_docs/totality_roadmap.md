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


