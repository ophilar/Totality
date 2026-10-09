# Totality Project Roadmap

## Phase Overview & Status

| Phase | Description | Status | Commit / Milestone |
|---|---|---|---|
| **Baseline** | Upstream 0.4.0 baseline validation & test verification | Completed | `2f6f045` |
| **Phase 1** | Schema migration (`deep_analysis`), SQLite concurrency hardening (`BEGIN IMMEDIATE`), cross-platform path resolution, incremental analysis fingerprint caching | Completed | `7a66ed7` |
| **Phase 2** | Hardware Transcoding Pipeline (NVIDIA RTX 5070 Ti, Intel QSV, AMD, Apple), Dolby Vision Profile 5 MKV $\rightarrow$ MP4 remuxing, stream pruning, IPC wiring, Quality Settings hardware card, and Timelines view | Completed | `c3e35e5` |
| **Phase 3** | Storage Debt & Waste Optimization Model (bitrate threshold calculation, compact space recovery indicators, waste analysis) | Completed | `9e192ad` |
| **Phase 4** | Side-by-Side Duplicates View (comparative stream resolution, bitrate inspection, and resolution actions) | Planned | — |
| **Phase 5** | Playback Compatibility Profiles (client target profiles, direct-play validation) | Planned | — |
| **Phase 6** | End-to-End Verification, full regression testing, and `v0.5.0-clean` release tagging | Planned | — |

## Constraints & Scope Principles
- **UI Preservation:** Maintain 100% of 0.4.0 UI spirit, Bento Box dashboard, scrims, Watchlist sync, and Tag sync.
- **Strict Exclusions:** No adult content providers, no protected folder PIN modals, no Arr services.
- **Database Driver:** Maintain current database driver and service without third-party swaps.
- **Media Preservation:** Adhere to constitutional preference for Dolby Vision Profile 5 MKV to MP4 conversion with `+faststart`.
- **Documentation:** All entries in `dev_docs/` are strictly additive.

## Phase Completion Updates (2026-10-07)

| Phase | Description | Status | Milestone Verification |
|---|---|---|---|
| **Phase 4** | Side-by-Side Duplicates View (`DuplicatesView.tsx`), comparative media item analysis, and safe keep/delete/quarantine resolution | Completed | Verified in build and test suite |
| **Phase 5** | Playback Compatibility Profiles (`PlaybackCompatibilityService.ts`, `PlaybackTargetProfileRepository.ts`, `PlaybackTargetProfilesTab.tsx`), client device profiles (`plex-webos-4-lg-b8.json`), and direct-play evaluation | Completed | Verified with 0 type errors |
| **Phase 6** | TV Show Optimization flow (`ShowTranscodeModal.tsx`), track pruning UI, task queue integration (`TaskQueueService.ts`), full test suite pass (928/928), and Windows Electron packaging (`Totality-Setup-0.4.0.exe`) | Completed | Verified via `npm run build` |

## Final Verification & Release Readiness (2026-10-07)

| Component | Status | Notes |
|---|---|---|
| **Git Diff Whitespace Check** | Pass | `git diff --check` and `git diff --cached --check` return code 0 |
| **TypeScript Typecheck** | Pass | `npm run typecheck` (`tsc --noEmit`) passes with 0 errors |
| **Automated Test Suite** | Pass | 43 test files, 939 tests passing cleanly |
| **Electron Build & Packaging** | Pass | `npm run build` completed, signed NSIS installer generated |
| **TV Show Optimization & Task Queue** | Complete | Season/episode order, preflight expiration TTL, protected tracks preserved |
| **Duplicates Comparison & Resolution** | Complete | Side-by-side view, policy checks, safe outcomes (`kept`, `deleted`, `policy-blocked`) |
| **Playback Compatibility** | Complete | Bundled target profiles, direct-play evaluation, device selector |
| **Option B SQLite Invariants** | Complete | Native `better-sqlite3` transactions, mock-safe `getDatabase` imports |

## Release 0.5.0 Completion & TV Identity Migration (2026-10-08)

| Component | Status | Notes |
|---|---|---|
| **TV Identity Migration** | Complete | Historical series and episodes backfilled (`SeriesIdentityMigration.ts`); title-based fallback eliminated |
| **Identity Constraints & Triggers** | Complete | Unique indexes on `(series_identity_key, source_id, library_id)`; triggers enforce non-null keys |
| **Savings Persistence Policy** | Complete | Grounded in raw evidence; `storage_debt_bytes` maintained without fabricated legacy component fields |
| **Version 0.5.0 Bump** | Complete | `package.json` bumped to 0.5.0 |
| **Full Regression Suite** | Pass | 46 test files, 956 tests passing (100% pass rate) |
| **Real Database Testing** | Pass | `tests/unit/database/SeriesIdentityMigrationRealDb.test.ts` verified via `sql.js` SQLite Wasm |
| **Renderer Caller Modernization** | Complete | `useTVShowPagination`, `useAnalysisManager`, `TVShowsView`, `ShowTranscodeModal` route identity-first |
| **Production Packaging** | Pass | Signed `release/Totality-Setup-0.5.0.exe` and `release/win-unpacked/Totality.exe` produced cleanly |

## Runtime Title Path Elimination & Final Verification (2026-10-08)

| Component | Status | Notes |
|---|---|---|
| **Runtime Identity Enforcement** | Complete | Title-based runtime lookups completely eliminated across Service, IPC, Preload, and Renderer |
| **Same-Title Collision Immunity** | Complete | Same-titled shows across libraries/providers are strictly isolated via canonical keys |
| **Comprehensive Test Suite** | Pass | 47 test files, 959 tests passing cleanly |
| **TypeScript Typecheck** | Pass | `npm run typecheck` (`tsc --noEmit`) passes with 0 errors |
| **Whitespace Hygiene** | Pass | `git diff --check` passes cleanly with 0 errors |

## Hotfix: SQLite String Literal Quotes & Plex Metadata JSON Negotiation (2026-10-09)

| Component | Status | Notes |
|---|---|---|
| **SQLite Literal Quoting** | Complete | Replaced illegal double-quoted empty strings `""` with ANSI/SQLite single quotes `''` in `BetterSQLiteService.ts` (`upsertSeriesCompleteness`, `getEpisodesForSeries`); eliminates `SqliteError: no such column: ""` |
| **Plex Metadata JSON Negotiation** | Complete | Added `defaultHeaders` (including `Accept: application/json` and client identifiers) to `getAlbumMetadata`, `getArtistMetadata`, and `getUserInfo` in `PlexProvider.ts`; eliminates `SyntaxError: Unexpected token '<', "<?xml vers"... is not valid JSON` |
| **Targeted Unit Tests** | Pass | Added `BetterSQLiteServiceQuotes.test.ts` and `PlexProviderMetadata.test.ts` |
| **Full Regression Suite** | Pass | 50 test files, 966 tests passing (100% pass rate) |
| **TypeScript Typecheck** | Pass | `npm run typecheck` (`tsc --noEmit`) passes with 0 errors |
