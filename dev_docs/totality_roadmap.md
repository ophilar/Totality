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

## Phase 6: Standardization & Real-Time Scanning (Complete)
- [x] **IPC Standardization**: Transition all IPC channels to colon-separated resource naming (`db:media:list`, `db:media:getItem`).
- [x] **1:1 UI Update Mandate**: Notify the renderer for every single item scanned/processed to provide fluid real-time feedback.
- [x] **Reactive Analysis**: Automatically trigger background TMDB/Gemini analysis upon configuration updates (API key additions).
- [x] **Provider Resilience**: Refactor all providers (Plex, Jellyfin, Emby, Kodi) for consistent progress reporting and failure handling.
- [x] **Integration Integrity**: Establish permanent suite-wide integration tests for library scanning and IPC registration. (v0.4.4)
- [x] **Database Concurrency**: Resolve "database table is locked" errors via SQLite `busy_timeout` and counter-based scan state management. (v0.4.4)

## Phase 7: Reliability & UX Refinement (Complete)
- [x] **First-Run Stability**: Resolve "database not initialized" errors on fresh installations by deferring path resolution and adding initialization mutexes. (v0.4.5)
- [x] **Configuration SSOT**: Migrate all hardcoded constants, quality thresholds, and AI prompts to centralized JSON files (`defaults.json`, `ai_prompts.json`). (v0.4.5)
- [x] **Type SSOT**: Establish robust Enums for all core domain types (Provider, Media, Task) to eliminate magic strings. (v0.4.5)
- [x] **Show-Aware Scanning**: Eliminate the "Empty Library" UX by capturing series-level metadata during the primary provider scan. (v0.4.6)
- [x] **Robust Virtualization**: Harden `react-virtuoso` implementation with height propagation and 1:1 pixel accuracy for large libraries (10k+ items). (v0.4.6)
- [x] **Scroll Restoration**: Implement "Scroll Memory" to preserve user position across library tab switching. (v0.4.6)
- [x] **Global Error Boundaries**: Compartmentalize library view failures using Section Error Boundaries. (v0.4.6)
- [x] **Onboarding Experience**: Implement a "First Run Wizard" for initial provider configuration and API key setup. (v0.4.6)

## Phase 8: Scaling & Advanced Management (In Progress)
- [x] **Service Orchestration Blitz**: Implement a "No Mocks" integration suite covering SourceManager, LiveMonitoring, Deduplication, and Gemini AI. (v0.4.7)
- [x] **IPC Layer Consolidation**: Standardize library management channels and harden Zod-validated handlers. (v0.4.7)
- [x] **LiveMonitoring Hardening**: Resolve file event propagation delays and standardize media type resolution across providers. (v0.4.7)
- [x] **CI Stabilization**: Resolve systemic test failures and unblock pull request pipeline. (v0.4.7)
- [x] **Security Hardening**: Fixed command injection vulnerabilities in Transcoding and Kodi discovery.
- [x] **Performance Optimization**: Implemented async fs checks and Plex fetching optimizations.
- [x] **Logging Standardization**: Centralized console logging across all specialized library views.
- [x] **Build Stabilization**: Resolved 84 compilation errors and structural corruption across 20 files. (v0.4.8)
- [x] **Security & Logic Hardening**: Mitigated command/prompt injection in Transcoding, hardened PIN cryptography using PBKDF2, fixed custom protocol Local File Inclusion (LFI), prevented Kodi MySQL SQL injection, resolved CSV formula injection, fixed Rate Limiter loop recursion, resolved Deduplication policy bypass, fixed LiveMonitoring unhandled rejections, and configured TMDB API rate-limiting rules in defaults.json. (v0.4.9)
- [ ] **Multi-Select Batching**: Implement "Selection Mode" for bulk library operations (Bulk Dismiss, Bulk Transcode). (v0.4.8)
- [x] **Deep Media Analysis**: Integrate `ffmpeg` for frame-accurate bitrate analysis and peak volume detection. (v0.4.8)
- [ ] **Database Partitioning**: Research partitioning strategies for extreme library sizes (100k+ items).
- [ ] **Cross-Platform Hardening**: Audit and fix Windows/macOS/Linux path-separator and shell-command inconsistencies.
 
## Indefinitely Postponed Features
- **Multi-Select Batching**: Indefinitely postponed. The renderer-side selection states, context handlers, highlight classes, check overlays, and the BatchActionBar have been completely removed from the codebase. There is no need for batch processing at this time.
- **Database Partitioning**: Indefinitely postponed. Deferred research and design for SQLite partitioning as scaling for extreme library sizes (100k+ items) is not currently required.
