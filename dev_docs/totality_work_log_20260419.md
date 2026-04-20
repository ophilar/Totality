# Totality Work Log - 2026-04-19

## Summary
Resolved "database table is locked" errors occurring during media scans by implementing SQLite concurrency optimizations and refactoring scan state management.

## Changes

### Database / Concurrency
- **SQLite Optimization:** Added `PRAGMA busy_timeout = 5000` to `BetterSQLiteService.ts`. This allows SQLite to wait for up to 5 seconds for a lock to be released instead of immediately failing with a "database table is locked" error.
- **Non-blocking Checkpoints:** Changed `forceSave` in `BetterSQLiteService.ts` to use `PRAGMA wal_checkpoint(PASSIVE)` instead of `TRUNCATE`. `PASSIVE` is non-blocking and doesn't require an exclusive lock, allowing it to run concurrently with other readers and writers.
- **Refactored Scan State:** Refactored `SourceManager.ts` to use an `activeScans` counter instead of a boolean `isScanning` flag. This ensures that the scanning state correctly reflects the presence of any active scan, preventing premature resumption of background services like `LiveMonitoringService`.

### Provider / Stability
- **Plex Logging Fix:** Fixed template literal interpolation in `PlexProvider.ts` logging calls by changing single quotes to backticks.
- **Scan Concurrency:** Standardized `SourceManager.scanLibrary` and `SourceManager.scanAllSources` to correctly increment and decrement the `activeScans` counter, ensuring robust coordination with other background tasks.

## Results
- **Improved Concurrency:** The application now handles overlapping scans and background tasks much more gracefully.
- **Reduced Failures:** "Database table is locked" errors during Plex scans have been eliminated by letting SQLite handle contention internally via `busy_timeout`.
- **Accurate Monitoring:** `LiveMonitoringService` now correctly stays paused as long as at least one manual scan is running, further reducing database contention.

## Next Steps
- Monitor application logs for any recurring lock issues under extreme load.
- Continue with planned feature development.
