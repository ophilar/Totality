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

## Known follow-ups

- Add dedicated settings cards for future API-key providers beyond the currently supported OMDb/TVDB configuration paths.
- Expand *arr command polling with richer progress/status history if needed.
- TMDB's external `adult` field remains unchanged because it is part of the upstream API contract.


