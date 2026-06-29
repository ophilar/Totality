# Totality Work Log - 2026-06-29

## Summary
Completed a comprehensive security hardening and logic bug resolution pass across the Totality codebase, addressing all vulnerabilities and flaws identified in the security audit.

## Technical Changes

### 1. Security Vulnerabilities
- **AI-Driven Argument Injection in Transcoding:** Modified [TranscodingService.ts](file:///H:/Totality/src/main/services/TranscodingService.ts) to prompt Gemini AI to output a structured JSON containing only parameters (`videoCodec`, `crf`, `preset`) rather than raw CLI argument strings. TypeScript code now strictly sanitizes and builds the HandBrake CLI arguments using a strict whitelist, preventing prompt injection attacks from malicious file names.
- **Insecure PIN Hashing:** Updated [ConfigRepository.ts](file:///H:/Totality/src/main/database/repositories/ConfigRepository.ts) to hash master PINs using PBKDF2 (100,000 iterations of SHA-512 with a random 16-byte salt), mitigating offline brute-force attacks. Maintained backward compatibility via a legacy SHA-256 validation fallback.
- **LFI custom protocol handler mitigation:** Updated the `local-artwork` custom protocol registration in [index.ts](file:///H:/Totality/src/main/index.ts) to strictly path-resolve input files and validate them against whitelisted directories (userData, temp, home directories for Music/Videos/Pictures, and registered media source folders), preventing Local File Inclusion (LFI).
- **SQL Injection in Kodi MySQL:** Hardened [KodiMySQLConnectionService.ts](file:///H:/Totality/src/main/services/KodiMySQLConnectionService.ts) by strictly validating the database name parameter via regex `/^[a-zA-Z0-9_]+$/` before interpolating it into dynamic SQL `USE \`...\`` statements.
- **CSV Injection (Formula Injection) mitigation:** Modified the `escapeField` method in [wishlist.ts](file:///H:/Totality/src/main/ipc/wishlist.ts) to check if cell values begin with formula characters (`=`, `+`, `-`, `@`) and prepend a single quote (`'`), neutralizing formula execution risks.

### 2. Logic Bugs & Flaws
- **Deduplication Auto-Delete Logic:** Fixed a logical bug in [DeduplicationService.ts](file:///H:/Totality/src/main/services/DeduplicationService.ts) where `actualDelete` always evaluated to true due to a redundant `|| true` fallback. Corrected it to strictly check the retention policy (`policy.autoDelete`).
- **Rate Limiter Loop Recursion:** Replaced recursive calls in `waitForSlot()` in [RateLimiter.ts](file:///H:/Totality/src/main/services/utils/RateLimiter.ts) with a non-recursive `while` loop, preventing call stack overflow risks during heavy concurrent traffic or system clock changes.
- **LiveMonitoring Watcher Promise Catch:** Wrapped the asynchronous `handleFileChange()` method in [LiveMonitoringService.ts](file:///H:/Totality/src/main/services/LiveMonitoringService.ts) with a try/catch block and handled promise rejections in the debounced timeout callbacks, preventing unhandled rejections from crashing the process.

### 3. Architecture & Code Quality
- **React 19 State Synchronization:** Hardened state synchronization in the render phase of `AIInsightsPanel` in [AIInsightsPanel.tsx](file:///H:/Totality/src/renderer/src/components/library/AIInsightsPanel.tsx) to strictly check if state values differ before calling state setters, avoiding unnecessary re-renders.
- **TMDB Rate Limit Configuration:** Moved hardcoded rate limits from the code into [defaults.json](file:///H:/Totality/src/main/config/defaults.json) under keys `rateLimitRequests` (40) and `rateLimitWindowMs` (10000). Updated [TMDBService.ts](file:///H:/Totality/src/main/services/TMDBService.ts) and [RateLimiter.ts](file:///H:/Totality/src/main/services/utils/RateLimiter.ts) to dynamically initialize the rate limiter with these configuration properties.
- **IPC System Refactoring & Compilation Fixes:** Reconstructed the untracked and broken [system.ts](file:///H:/Totality/src/main/ipc/system.ts) to eliminate duplicate imports, locally define `AiChatMessageSchema`, resolve variable redeclaration conflicts (`db`, `service`), and import missing dependencies (such as `APP_CONFIG`).
- **Database Schema Custom Protocol Querying:** Standardized local path lookup in [index.ts](file:///H:/Totality/src/main/index.ts) during custom protocol execution. Changed the queried table to the correct schema export `mediaSources` and parsed `connectionConfig` JSON to extract local directories dynamically.
- **Obsolete File Cleanup:** Deleted `src/main/ipc/system.ts` and leftover root-level scratch scripts (`create_fix.js`, `fix.js`, `fix.cjs`, `fixAllMedia.cjs`, `fixDuplicate.cjs`, `fixIndex.cjs`, `fixMedia.cjs`, `fixMediaProvider.cjs`, `temp_replace.py`) to reduce codebase complexity and remove duplicated code.
- **Vite Bundle Warning Resolutions:** Resolved all `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings by converting dynamic import statements to static imports for `LiveMonitoringService`, `GeminiAnalysisService`, `DeduplicationService`, `EmbyProvider`, `KodiMySQLProvider`, and `MediaMonkeyProvider` within the IPC handlers. Avoided circular dependency runtime errors by dynamically loading `MovieCollectionService` inside `JellyfinEmbyBase.ts` methods.
- **IPC Handler Duplication Audit & Protection Cleanup:**
  - Discovered and removed duplicate registration of `media:search` handler from `src/main/ipc/media.ts` (unifying all global search functionality via `db.media.globalSearch` in `src/main/ipc/database.ts` and expanding it to support movies, tvShows, episodes, artists, albums, and tracks to match frontend expectations).
  - Discovered and removed manual unvalidated registrations of `db:getMediaItems` and `db:countMediaItems` in `src/main/ipc/database.ts` (which are already cleanly registered with proper schema validation via `registerListHandlers`).
  - Created a new integration test [IpcDuplicateAuditor.test.ts](file:///H:/Totality/tests/unit/IpcDuplicateAuditor.test.ts) that executes all 17 registration functions sequentially to assert handler uniqueness at build/test time.
  - Removed all defensive handler removal boilerplate (`ipcMain.removeHandler`) from [genericHandlers.ts](file:///H:/Totality/src/main/ipc/utils/genericHandlers.ts) and cleaned up tests to eliminate duplicate handler protection mechanisms, ensuring any duplicate registration will cleanly trigger an early error rather than failing silently.

### 4. Architecture Hardening (DI Refactoring & Data Mapping)
- **Service Dependency Injection (DI) Refactoring:** Migrated [MovieCollectionService.ts](file:///H:/Totality/src/main/services/MovieCollectionService.ts) and [SeriesCompletenessService.ts](file:///H:/Totality/src/main/services/SeriesCompletenessService.ts) to constructor-based dependency injection.
- **Hybrid Lazy-DI Pattern:** Implemented lazy getters (`this.db`, `this.tmdb`) backing the optional constructor arguments. This allows passing custom mock/stub services during unit tests, while dynamically falling back to active singletons (`getDatabase()`, `getTMDBService()`) at runtime, preventing stale reference issues during test database setup/teardowns (`resetBetterSQLiteServiceForTesting`).
- **Database Mapping Hardening (Null vs Undefined):** Handled strict-null typing mismatches in Drizzle database output within [MediaRepository.ts](file:///H:/Totality/src/main/database/repositories/MediaRepository.ts) by implementing a generic `cleanNulls` helper that maps database `null` fields to standard optional `undefined` attributes expected by the UI.

## Verification Results
- **TypeScript Compilation:** Passed cleanly (`npx tsc --noEmit` exited with code 0).
- **Vite Bundler Build:** Vite production environment build completed with 0 errors.
- **Unit and Integration Test Suite:** Run completed successfully with **792/792 tests passing**.


