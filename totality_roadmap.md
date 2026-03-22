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
- [x] **Modularization**: Refactor `DatabaseService` into specialized repositories and migrate to `better-sqlite3`.

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

## Phase 4: Efficiency & UI Refinement (Current)
- [x] **Cleanup Radar**: Dashboard component ranking items by Storage Debt (GB waste).
- [x] **Trash Indicator**: UI badges for redundant/dubbed audio tracks.
- [ ] **Actionable Optimization**: Initiate local FFmpeg transcodes to pay off storage debt.
- [ ] **Library Audit Export**: Generate CSV/PDF reports of quality and efficiency metrics.
- [ ] **Multi-user profiles** and permissions.
- [ ] **AI Upgrade Recommendations**: Suggest higher quality versions based on availability.
