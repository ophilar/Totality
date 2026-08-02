# Totality Roadmap

## Phase 1: Core System & Media Analysis [Completed]
- Initial Media Library, SQLite Database, and Media Analyzer integration.

## Phase 2: Transcoding Subsystem & UI Redesign [In Progress]
- [x] Brainstorming & Architecture Spec Approval
- [x] Implement `ITranscodeCommandBuilder` & Hardware Strategy Builders (`NvidiaCommandBuilder`, `IntelCommandBuilder`, `SoftwareCommandBuilder`)
- [x] Refactor `TranscodingService.ts` to use strategy pattern and zero-copy NVENC/QSV pipelines
- [ ] Redesign `TranscodeModal.tsx` into 3-tab Wizard (`QuickPresetsTab`, `AdvancedTab`, `LiveEncodingTab`)
- [ ] Unit & System Integration Verification

## Phase 3: Metadata Fusion & Acquisition Integration [In Progress]
- [x] Concurrent provider fusion by shared external IDs and robust title/alias matching
- [x] Configurable TVDB provider and AniList/MusicBrainz identity enrichment
- [x] Optional Sonarr/Radarr configuration, read-only identity lookup, and explicit search commands
- [x] Persisted provider enablement and ordering preferences
- [x] Protected/Expanded terminology compatibility
- [ ] Connect *arr lookup/search actions to media detail UI with confirmation and status polling
- [ ] Add generic locked-match identity and alias persistence across movie, TV, music, and artwork
- [ ] Replace JSON provider preferences with accessible controls
- [ ] Complete responsive UI and sortable-column review across every view
