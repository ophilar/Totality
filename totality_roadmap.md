# Totality Roadmap

## Phase 1: Security & Stability (Complete)
- [x] **Critical:** Upgrade Electron to latest stable (v41.0.2) for security patches.
- [x] **Major:** Resolve suspicious dependency versions (`axios`, `mysql2`).
- [x] **Major:** Fix `FilePathSchema` to prevent path traversal/probing.
- [x] Implement `safeStorage` for OS-level credential encryption.
- [x] Harden IPC bridge with `contextBridge` and Zod validation.
- [x] Sanitize all database inputs with parameterized queries.

## Phase 2: Performance Optimization (Complete)
- [x] Optimization: Move `PRAGMA integrity_check` to an optional or maintenance-only task.
- [x] Performance: Optimize `BetterSQLiteService` query execution for large libraries.
- [x] AI: Implement Flash models and caching for high-volume analysis.
- [x] **Virtualization**: Implement `react-virtuoso` across all library views (60fps scrolling).
- [x] **Modularization**: Refactor `DatabaseService` into specialized repositories and migrate to `better-sqlite3`. (v0.4.0)
- [x] **Tech Stack Modernization**: Upgrade to React 19, TypeScript 6, and Electron 41. (v0.4.0)

## Phase 3: Feature Expansion (Complete)
- [x] Unified library search with AI tool-use.
- [x] Media server providers (Plex, Jellyfin, Emby, Kodi).
- [x] Completeness tracking via TMDB and MusicBrainz.
- [x] **Storage Debt Analysis**: Implement BPP efficiency scoring and GB waste calculations.
- [x] **Wishlist Dashboard**: Centralized view for quality upgrades and missing collection items.
- [x] **Hybrid Monitoring**: Event-driven OS watching + focus-triggered lazy checks.
- [x] **Stability & Resilience**: Fix DB schema integrity (NOT NULL constraints) and handle metadata provider 404s.
- [x] **Architectural Consolidation**: Refactor providers and services for DRY/SOLID (v0.4.0).
- [x] **Log Standardization**: Comprehensive transition from `console.log` to structured `LoggingService`.

## Phase 4: Efficiency & Architectural Consolidation (Complete)
- [x] **v0.4.0 Migration**: Full port of upstream features (MediaMonkey 5, Mood Sync) to Repository Pattern.
- [x] **N+1 Optimization**: Eliminate nested database queries in background completeness services.
- [x] **Cleanup Radar**: Dashboard component ranking items by Storage Debt (GB waste).
- [x] **Trash Indicator**: UI badges for redundant/dubbed audio tracks.
- [x] **Upgrades UI Refinement**: Consolidate Cleanup functionality into Upgrades column and add Efficiency sorting.
- [x] **Actionable Recommendations**: Show tailored conversion parameters (AV1 preference) for wasteful files.
- [x] **Dependency Injection**: Harden services against global mocks and monkeypatching for testing.

## Phase 5: Active Optimization & Reporting (Complete)
- [x] **Test Coverage Expansion**: Implement "No Mocks" integration testing architecture with real in-memory databases and local servers. (v0.4.3)
- [x] **Transcoding Engine**: Implement `TranscodingService` using Handbrake/MKVToolNix with Gemini-driven (3.1 flash lite) optimized parameters. (v0.4.3)
- [x] **Intra-Provider Deduplication**: Identify and track duplicate files within the same provider via `DeduplicationService`. (v0.4.3)
- [x] **Deduplication UI**: Dedicated view for managing and resolving detected duplicates. (v0.4.3)
- [x] **Protected Libraries**: Sensitive library protection via SHA-256 PIN lock and secure session state. (v0.4.3)
- [x] **AI Upgrade Recommendations**: Retention scoring engine suggesting high-quality version preservation during deduplication. (v0.4.3)

