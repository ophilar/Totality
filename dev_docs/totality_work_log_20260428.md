# Totality Work Log - 2026-04-28

## Summary
Resolved a critical "database not initialized" error on fresh installations, established a robust Enum-based Single Source of Truth (SSOT) system, and migrated all hardcoded configuration and AI prompts to centralized JSON files.

## Changes

### Database Service Resilience
- **Deferred Path Resolution:** Modified `BetterSQLiteService` to resolve `app.getPath('userData')` during `initialize()` instead of in the constructor.
- **Initialization Mutex:** Implemented an `_initPromise` pattern to prevent concurrent database initialization attempts.
- **Improved Error Handling:** Refactored database getters with a `checkInitialized()` method for better diagnostics.

### Enum-based SSOT Implementation
- **Shared Enums:** Established comprehensive Enums for `ProviderType`, `MediaItemType`, `AlbumType`, `Wishlist`, `Tasks`, and `Notifications`.
- **Service Refactoring:** Refactored `TaskQueueService.ts` and `BetterSQLiteService.ts` to use shared Enums, significantly reducing file sizes and magic strings.
- **Schema Alignment:** Updated `src/main/database/schema.ts` `CHECK` constraints to align with the new Enum values.

### Centralized JSON Configuration
- **Externalized Defaults:** Created `src/main/config/defaults.json` and `src/main/config/ai_prompts.json` to store all application constants, thresholds, and system prompts.
- **Unified Config Access:** Implemented `src/main/config/index.ts` (`APP_CONFIG`) as the single entry point for all non-database settings.
- **Service Decoupling:** Refactored multiple services to remove hardcoded values:
    - `QualityAnalyzer`: Bitrate thresholds, efficiency targets, and weights are now JSON-configured.
    - `TMDBService`: API base URLs, concurrency limits, and cache durations moved to JSON.
    - `AudioCodecRanker`: Audio tier rankings and codec patterns moved to JSON.
    - `FFprobeWorkerPool`: Worker limits and queue depths moved to JSON.
    - `LoggingService`: Buffer sizes and flush intervals moved to JSON.
    - `GeminiService`: Default/Fast models and cache limits moved to JSON.
    - `GeminiAnalysisService` & `TranscodingService`: All AI system prompts migrated to JSON.
- **Cleanup:** Deleted redundant TypeScript constants files (`src/main/services/ai-system-prompts.ts`, `src/main/constants/quality.ts`).

### Test Concurrency & Isolation
- **Unique Database Paths:** Refactored `BetterSQLiteService.ts` to support dependency injection of the database path via `initialize(overridePath?: string)`.
- **Test Utility Standard:** Updated `tests/TestUtils.ts` to generate a unique random database file for every test suite, preventing "database is locked" errors during parallel execution.
- **Mock Remediation:** Standardized all "Real DB" tests on `setupTestDb`, ensuring clean state and total isolation.
- **Fixed Mocks:** Resolved a broken `fs` mock in `TranscodingService.test.ts` by using `importOriginal`, restoring `mkdirSync` functionality required for initialization.

## Results
- **Zero-Failure CI:** Achieved 100% test pass rate (713/713) by resolving long-standing concurrency and state leakage issues.
- **Architectural Integrity:** Established a Single Source of Truth for both types (Enums) and configuration (JSON), while removing environment-specific hacks from production code.
- **Maintenance Efficiency:** Non-code contributors can now adjust AI behavior or quality thresholds via JSON without modifying logic.
- **Clean Code:** Removed hundreds of lines of hardcoded strings and redundant interfaces.
- **Startup Reliability:** Eliminated race conditions and path resolution errors during first-run setup.
