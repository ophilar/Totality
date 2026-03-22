# Totality Work Log

## 2026-03-19
- **Fixed Database Integrity Issues:**
    - Resolved `SqliteError: NOT NULL constraint failed: series_completeness.library_id` and similar errors in `movie_collections`.
    - Updated `BetterSQLiteService.ts` and `MusicRepository.ts` to ensure `library_id` and `source_id` are always populated with at least an empty string if undefined.
    - Updated database migrations to ensure new columns are added with `NOT NULL DEFAULT ''` to prevent future constraint failures on existing installations.
    - Added missing `library_id` column and index to `artist_completeness` table in `schema.ts`.
- **Improved Music Metadata Fetching:**
    - Modified `MusicBrainzService.ts` to gracefully handle 404 errors when fetching artist or release data, preventing them from crashing the sync process.
    - Updated `upsertArtistCompleteness` to support the new `library_id` field for multi-library tracking.
- **Log Noise Reduction & Standardization:**
    - Refactored `PlexProvider.ts` to replace `console.log/warn/error` with `LoggingService`.
    - Downgraded routine "Skipping" logs (for items without media parts) to `verbose` level to reduce clutter in standard application logs.
    - Downgraded routine scan progress and completion messages to `verbose` or formatted them for better readability in `info` level.

## 2026-03-22
- **Architectural Consolidation & Refactoring (v0.4.0):**
    - **Centralized Robust Matching:** Extracted advanced TMDB search logic (fuzzy year matching and AI disambiguation) from individual providers into `TMDBService.ts`.
    - **Unified FFprobe Enhancement:** Centralized `needsEnhancement` and `enhanceMetadata` in `MediaFileAnalyzer.ts`, deduplicating technical stream merging across Kodi and Local providers.
    - **Consolidated Discovery:** Merged `EmbyDiscoveryService` and `JellyfinDiscoveryService` into a single, generic `UdpDiscoveryService.ts`.
    - **Provider Refactoring:** Strengthened `BaseMediaProvider` with shared logic for quality scoring (`calculateVersionScore`) and title normalization (`normalizeGroupTitle`). All providers now inherit from this base class.
    - **Kodi Unification:** Created `KodiMappingUtils.ts` to share field-mapping logic across Local SQLite, MySQL, and JSON-RPC variants.
    - **Generic Repository Pattern:** Implemented `BaseRepository.ts` to handle standard SQL patterns, simplifying `MediaRepository` and `MusicRepository`.
    - **IPC Unification:** Consolidated Jellyfin and Emby IPC handlers into a unified registration loop.
    - **Build Stabilization:** Resolved 78+ TypeScript errors and regressions, achieving a 100% stable production build verification.
    - **Cleanup:** Purged redundant file fragments and duplicate logic across the provider tree.


