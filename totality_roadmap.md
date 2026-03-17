# Totality Roadmap

## Phase 1: Security & Stability (Current)
- [x] **Critical:** Upgrade Electron to latest stable (v41.0.2) for security patches.
- [x] **Major:** Resolve suspicious dependency versions (`axios`, `mysql2`).
- [ ] **Major:** Fix `FilePathSchema` to prevent path traversal/probing.
- [x] Implement `safeStorage` for OS-level credential encryption.
- [x] Harden IPC bridge with `contextBridge` and Zod validation.
- [x] Sanitize all database inputs with parameterized queries.

## Phase 2: Performance Optimization
- [x] Optimization: Move `PRAGMA integrity_check` to an optional or maintenance-only task.
- [x] Performance: Optimize `BetterSQLiteService` query execution for large libraries.
- [x] AI: Implement Flash models and caching for high-volume analysis.

## Phase 3: Feature Expansion
- [x] Unified library search with AI tool-use.
- [x] Media server providers (Plex, Jellyfin, Emby, Kodi).
- [x] Completeness tracking via TMDB and MusicBrainz.
- [ ] Multi-user profiles and permissions.
- [ ] Advanced transcode analysis and recommendations.
