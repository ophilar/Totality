# Totality Design Guidelines

## Transcoding Architecture
- **Strategy Pattern:** `ITranscodeCommandBuilder` with `NvidiaCommandBuilder`, `IntelCommandBuilder`, and `SoftwareCommandBuilder`.
- **Zero-Copy Pipeline:** Keep frame surfaces in VRAM (`-hwaccel cuda -hwaccel_output_format cuda` for NVIDIA, `-hwaccel qsv -hwaccel_output_format qsv` for Intel).
- **Anti-Stutter & Timing:** Enforce `-fps_mode passthrough` and maintain container timestamps.
- **Quality & Storage:** Dynamic `-rc vbr` with `-cq <value>` (16-24), spatial/temporal AQ, B-ref frames (`-b_ref_mode middle`), and 10-bit color (`p010le`).
- **UI Architecture:** 3-tab wizard (`QuickPresetsTab`, `AdvancedTab`, `LiveEncodingTab`) in `TranscodeModal.tsx`.

## Franchise Timelines & Plex Playlist Sync Architecture
- **Strategy Pattern:** `ITimelineRecipeProvider` with `RemoteRegistryRecipeProvider`, `TraktRecipeProvider`, `TMDBRecipeProvider`, and `WebGuideRecipeProvider`.
- **Bundled Offline Presets:** Comprehensive curated built-in recipes (Star Trek Chronological & Release, Star Wars Canon, MCU Chronological, DCEU Chronological, Alien & Predator) that work instantly without remote network dependency.
- **Universal Web Guide & AI Ingestion:** Parse any internet viewing order guide (IGN, startrekviewingguide.com, Rotten Tomatoes, fandom wikis, etc.) and AI prompts using Gemini AI structured extraction and heuristic DOM/TMDB fallback.
- **Strict & Resilient Resolution:** Match media strictly via `tmdbId`, `tvdbId`, or `imdbId` with normalized title/era fallback.
- **View State Preservation:** Playlist mutations strictly use Plex playlist CRUD endpoints (`POST /playlists`, `PUT /playlists/{id}/items`, `DELETE /playlists/{id}`); never touch scrobbles, play counts, or resume offsets.
- **Fail-Fast & Lean Logic:** No defensive try-catch-rethrow wrappers or impossible checks. Let native errors propagate naturally.
- **Acquisition Synergy:** Reuse existing `ArrIntegrationService` for 1-click missing item searches.

## TV Show Single-Identity & Deduplication Architecture (TOT-BUG-03)
- **Path Sanitization & Tag Stripping:** `FileNameParser.isSeasonOrExtrasFolder` and `stripReleaseTags` sanitize all season directories (`Season \d+`, `S\d+`, `Staffel \d+`, `Specials`, `Behind the Scenes`) and release metadata before series title resolution.
- **Hyphenated Unresolved Keys:** Unresolved show stubs use `unresolved:<sourceId>:<libraryId>:<canonical-slug>` to guarantee shared keys regardless of episode season folder structure.
- **Scoped DB Constraints:** Scoped unique indexes on `(series_identity_key, source_id, library_id)`, `tvdb_id`, and `tmdb_id` in `series_completeness`.
- **In-Place Upsert Resolution:** `TVShowRepository.upsertCompleteness` matches existing records and updates in place, aggregating season and episode counts without violating uniqueness.
- **Data Migration & Healing:** `mergeDuplicateSeriesCompleteness` clusters legacy duplicate show rows, repoints `media_items` foreign keys, recalculates aggregate stats, and purges duplicate rows safely.

## SSOT, SOLID & Clean Code Guidelines (ADR-003 & ADR-004)
- **Single Source of Truth (SSOT):** Media heuristics, regex patterns, and naming conventions must live in exactly one service module (e.g. `FileNameParser` for all bonus/extras/season detection).
- **Batch Data Access over N+1 Queries:** Repositories must provide batch lookup methods (`getBatchConflictingEntityIds`) rather than dispatching $N$ separate asynchronous queries in loops.
- **Hash-Set & Inverted Index Algorithmic Efficiency:** Data analysis and candidate fusion services must use $O(1)$ maps and inverted indexes rather than iterative linear scans.
- **Direct Identifier Lookup:** External API clients and completeness services must resolve directly by authoritative entity ID when known, avoiding ambiguous text search round-trips.
- **Single-Responsibility Query Builders:** Database repositories must encapsulate SQL `WHERE` condition assembly in dedicated builder helpers to guarantee parity between data retrieval and count operations.

## Dolby Vision Profile 5 & High-Performance Transcoding Architecture (ADR-005)
- **Zero-Loss MKV-to-MP4 Remuxing:** Profile 5 HEVC streams are stream-copied directly (`-c:v copy -tag:v dvh1 -movflags +faststart`) to preserve 100% of the dynamic RPU metadata without quality degradation or color corruption.
- **Audio/Subtitle Compatibility:** Converts incompatible audio streams into MP4-compliant formats (E-AC3 with Atmos passthrough or AAC) and converts soft subtitles into Timed Text (`mov_text`).
- **Hybrid `dovi_tool` Integration:** When downsizing/re-encoding is requested, `dovi_tool` extracts the RPU binary prior to NVENC encoding and injects it back into the compressed bitstream.
- **Restored `HandBrakeCLI` Backend:** Restored from git history (`commit 1707241` / `fafb9f4`) as an engine strategy alongside native FFmpeg, providing dual transcoding engine selection.
- **Hardware-Tuned NVENC & HandBrake Presets:** NVENC zero-copy 10-bit color pipelines (`scale_cuda=format=p010le`, `-rc vbr -cq 18`, spatial/temporal AQ) are mirrored as exportable HandBrake JSON presets for external batch encoding workflows.

## UI Responsiveness, Viewport Isolation & Transcoding Visibility (ADR-006)
- **Directives Strict Enforcement:** Zero fallbacks, failsafes, silent errors, mocks, fakes, bypasses, cheats, duplicates, redundancies, defaults, hardcodes, thin wrappers.
- **Identifier Standards:** No prepending underscores across variables, enum values, properties, or keys.
- **SSOT Audio Bitrate Modeling:** `AudioCodecRanker` provides mathematical bit calculations (`channels * sampleRate * bitDepth`) for uncompressed streams and broadcast-standard nominal bitrates for compressed formats.
- **DOVI Side Data Recognition:** `detectHdrFormat` explicitly matches `"dovi"` in FFprobe `side_data_type` strings to prevent Dolby Vision streams falling through to HDR10.
- **Root Scroll Isolation:** Franchise timeline views must use unified scroll containers rather than locking multi-row recipe selectors in fixed, non-scrolling headers.
- **Z-Index Stacking Isolation:** List row components must dynamically manage stacking contexts (`relative z-50` when menus are open) to prevent clipping under adjacent rows.
- **Unified Task Queue Observation:** Batch transcoding triggers direct transition to the `TaskQueueDrawer` observer rather than silent background task dispatching.










## Title-to-ID Matching and Direct ID Precedence (ADR-007)
- **Direct Authoritative ID Precedence (Strategy Pattern):** When external IDs (`imdbId`, `tmdbId`, `tvdbId`, `anilistId`, `musicBrainzId`) are provided by upstream libraries (Plex, Kodi, Jellyfin, or NFO files), `MetadataMatchingService` executes direct provider lookup first (Strategy 1) and `selectAutomaticMatch` returns matching candidates immediately without fuzzy text ambiguity.
- **SSOT Numeric Title Preservation (`TitleMatching`):** `normalizeTitleForMatching` preserves leading and standalone 4-digit numeric tokens (*1984*, *2001: A Space Odyssey*, *1917*, *300*), while stripping trailing release years (*Inception 2010* -> *inception*).
- **Alternate Titles Scoring Parity:** Candidate sorting evaluates the maximum score across `[title, ...(alternateTitles || [])]`, ensuring foreign, transliterated, and localized media are accurately matched.
- **Resilient Multi-Provider Manual Fix Match:** Removes the hard dependency on `tmdbId` in `database.ts` and `series.ts`, allowing media items to be matched and locked via IMDb, TVDB, or AniList identities when TMDB records do not exist.

## Comparative Architectural Analysis: Totality vs. Open-Source Media Matchers (ADR-008)
- **Totality vs. Jellyfin/Emby:**
  - *Jellyfin*: Uses a sequential provider pipeline (`IMetadataProvider<T>`) where the first matching provider populates the item and secondary providers only backfill empty fields.
  - *Totality*: Uses a concurrent **Composite Pattern** that queries all configured providers simultaneously, deduplicating via an in-memory $O(1)$ inverted index (`keyByExternalId`) and fusing identities into a single rich candidate pool.
- **Totality vs. The \*arr Suite (Sonarr / Radarr / Lidarr):**
  - *The \*arr Suite*: Delegates matching to a centralized remote cloud proxy (**SkyHook** / **RadarrAPI**). Each application is strictly coupled to a single upstream database (Radarr $\to$ TMDB; Sonarr $\to$ TVDB/TVmaze; Lidarr $\to$ MusicBrainz). To comply with cloud CDN/hosting terms, official \*arr proxies filter `adult: true` entries from search indexes (prompting community forks like *Whisperr* for specialized content).
  - *Totality*: Fully decentralized and provider-agnostic. Operates directly against upstream APIs and supports pure IMDb/TVDB/AniList identities without requiring TMDB IDs.
- **Totality vs. Kodi:**
  - *Kodi*: Employs a single active scraper plugin per library (e.g. TMDB Python, Universal Movie Scraper) and regex-based `cleanstrings`.
  - *Totality*: Combines exact external ID resolution, multi-provider concurrent search, position-aware numeric title preservation, and alternate titles scoring in a unified engine.
- **Totality vs. Plex (Modern Cloud Agent):**
  - *Plex*: Aggregates metadata in proprietary cloud servers before sending unified records to the local PMS instance.
  - *Totality*: Runs provider matching locally with persistent identity locks and offline/local media support.

## Boundary Contract Integrity, Anti-Regression & Strict Typing (ADR-009)
- **Problem & Root Cause Analysis:**
  - Recurring "NaN releases", missing counts, and arithmetic degradation bugs (e.g. `undefined + 0 === NaN`) occurred due to ORM/DTO impedance mismatches: Drizzle ORM model schemas define `camelCase` properties (`totalAlbums`, `ownedAlbums`, `totalEps`, `totalSingles`), while SQLite database schemas and renderer UI contracts expect `snake_case` DTOs (`total_albums`, `owned_albums`, `total_eps`, `total_singles`).
  - When raw or partially-spread Drizzle rows (`{ ...a, artist_name: a.artistName }`) bypassed mapping at repository boundaries, required contract properties were omitted as `undefined`, causing UI calculations to evaluate to `NaN` or crash.
- **Prohibition of Failsafes, Silent Fallbacks & UI Masking:**
  - In accordance with the **Universal Project Constitution**, masking bugs at the UI layer using defensive fallbacks, failsafes, silent errors, cheats, or scattered `?? 0` checks is strictly prohibited. UI fallbacks treat symptoms rather than root causes, allowing broken contracts to persist and recur across queries.
- **Architectural Enforcement Standards:**
  1. **Mandatory Centralized Mappers (SSOT):** All repository methods emitting data across IPC MUST route Drizzle models through centralized, typed mappers in `src/main/database/utils/mappers.ts` (`toSnakeCaseArtistCompleteness`, `toSnakeCaseSeriesCompleteness`, `toSnakeCaseMediaItem`, `toSnakeCaseQualityScore`).
  2. **Zero Leaky Object Spreading:** Banned raw object spreading (`{ ...drizzleRow }`) on ORM entities across repository IPC endpoints. Every field must be explicitly transformed or mapped.
  3. **Compile-Time Contract Guarantees:** Mappers must return exact TypeScript interface types (never cast via `as unknown as Type`), ensuring the compiler fails immediately if an interface field is omitted, renamed, or mis-typed.
  4. **Schema Constraint Guarantees:** Database migration definitions must declare `NOT NULL DEFAULT 0` on numerical counting and completeness columns, guaranteeing non-nullable primitives from the storage engine to the view layer.

## MusicBrainz Request Throttling and Match Selection (ADR-010)
- **Problem & Root Cause Analysis:**
  - MusicBrainz enforces a strict 1 req/sec rate limit per IP. Under concurrent background operations (e.g. `pLimit(5)` during vinyl checking or multi-task operations), `SimpleDelayRateLimiter` experienced race conditions where concurrent calls checked elapsed time simultaneously and fired overlapping bursts, triggering `503 Service Unavailable`, connection timeouts, and network bans.
  - Untagged music files resulted in repetitive MusicBrainz searches for fallback strings (`[Unknown Album]`, `Unknown Artist`, `title`, `????`), wasting rate limits and causing cascaded 60s timeout loops.
- **Architectural Enforcement Standards:**
  1. **Monotonic Leaky Bucket Scheduling:** `SimpleDelayRateLimiter` queues slots sequentially via monotonic timestamp reservation (`scheduledTime = Math.max(now, lastScheduledTime + delayMs)`), guaranteeing strict sequential spacing (1.5s) even across concurrent asynchronous callers.
  2. **Placeholder Pre-Validation:** `isPlaceholderMusicTitle` intercepts and rejects fallback / untagged music strings before API dispatch, preventing unnecessary network queries.
  3. **Circuit Breaker Fault Tolerance:** `MusicBrainzService.analyzeAllMusic` trips after 5 consecutive hard network failures, logging informative diagnostics and preserving partial results without hanging background worker queues.
  4. **Multi-Strategy Automatic Matching (`selectAutomaticMatch`):** Evaluates candidate selection through prioritized strategies:
     - *Strategy 1:* Direct Authoritative External ID Resolution (100% confidence).
     - *Strategy 2:* Exact Normalized Title + Exact/Fuzzy (+/- 1 year) Year Match.
     - *Strategy 3:* Top Exact Title (resolves multiple candidate entries when year is unspecified).
     - *Strategy 4:* High Confidence Score Match (score $\ge 75$ with $\ge 15$ pt separation or score $\ge 90$).

## Hardware-Accelerated Batch TV Show Transcoding Architecture (ADR-011)
- **Problem & Root Cause Analysis:**
  - When triggering batch TV show optimization from `ShowTranscodeModal`, the request payload omitted `useGpu` and `gpuId`. Consequently, `TranscodeCommandFactory` fell back to `SoftwareCommandBuilder`, constructing CPU-bound `libx265` encoding commands running at only ~21 FPS instead of leveraging the host's dedicated NVIDIA GPU (e.g. RTX 5070 Ti NVENC running at 300–500+ FPS).
- **Architectural Enforcement Standards:**
  1. **Mandatory User Device Selection (Always):** The user MUST always have full, explicit control over the transcoding hardware and target device. Every transcoding modal/wizard (`TranscodeModal`, `ShowTranscodeModal`, `OptimizationTab`) must provide:
     - Direct toggle for GPU Hardware Engine vs. Software CPU.
     - Device dropdown selector explicitly exposing all detected GPU hardware devices (`name`, `vendor`, `id`).
     - Real-time synchronization of chosen device to the backend via `setSelectedGpu(id)` and options payload.
  2. **Zero-Omission Transcoding Option Contracts:** All transcoding ingress points MUST query `window.electronAPI.getCapabilities()` upon initialization, detect verified hardware encoders, and explicitly propagate user-selected `useGpu` and `gpuId` down to `preflightShow` and the underlying task queue.
  3. **NVENC Hardware Pipeline Guarantee & Surface Buffer Optimization:** When GPU acceleration is selected for an NVIDIA device, transcoding commands strictly enforce zero-copy hardware pipelines (`hevc_nvenc` / `av1_nvenc` with dynamic `p6`/`p5` presets and `p010le` 10-bit depth). In addition, `NvidiaCommandBuilder` allocates hardware decode frame surfaces (`-extra_hw_frames 8`) to eliminate NVDEC/NVENC PCIe synchronization bubbles on modern RTX hardware.
  4. **Component Memoization & Zero Re-render UI:** Reusable transcoding controls (`TranscodingDeviceSelector`) must be wrapped with `React.memo` and bound to stable callbacks (`useCallback`) to maintain high UI responsiveness during heavy background encoding.

## Timelines Master-Detail UI, Series Disambiguation, Auto-Infill & Real Dry Run Calculations (ADR-012)
- **Problem & Root Cause Analysis:**
  - Franchise Timelines view displayed all recipes in a top-heavy card grid, cluttering the screen and distracting from the selected timeline's details and Plex sync controls.
  - Multi-match series searches in `MatchFixModal` lacked sufficient context (broadcasters, countries, status, external IDs, full synopsis) to reliably distinguish distinct shows sharing names or remakes.
  - Series analysis did not systematically backfill missing episode metadata and external IDs into the local SQLite database.
  - Dry run optimization must compute verifiable, non-mocked storage savings and stream action rosters derived directly from FFprobe stream bitrates and durations.
  - Original language configuration must display the audio languages actually embedded in local files, defaulting to the provider's authoritative original language.
- **Architectural Enforcement Standards:**
  1. **Two-Column Master-Detail Timelines View:** Split container with scrollable, searchable recipe sidebar on the left and dedicated active timeline detail pane with live Plex sync and filtering on the right.
  2. **Rich Series Disambiguation Indicators:** Prominently display first air date, network, country, status, external ID chips (TMDB, TVDB, IMDb), and full plot overview in match candidate cards.
  3. **Non-Destructive Metadata Infill:** Backfill missing episode titles, air dates, overviews, season art, and external IDs during analysis while preserving all user-locked matches.
  4. **True Dry Run Optimization Math:** Compute recoverable storage from exact track bitrates, packet statistics, and duration without synthetic heuristics or mocks.
  5. **File-Aware Language Detection:** Inspect embedded audio stream tags from media files, map to localized names via `Intl.DisplayNames`, and pre-select the provider's canonical original language as the default.

## Unified Notification & Task Failure Logging Architecture (ADR-013)
- **Problem & Root Cause Analysis:**
  - When background queue tasks failed or created notifications (e.g. `Task failed`, `Scan completed with errors`, `Update available`), notifications were persisted to the database but did not appear in diagnostic/file logs.
- **Architectural Enforcement Standards:**
  1. **SSOT Notification Log Emission:** `NotificationRepository.addNotification` automatically emits structured log entries to `LoggingService` matching the notification's severity (`error`/`task_failed` $\to$ `log.error`, `warning` $\to$ `log.warn`, `info`/`success` $\to$ `log.info`).
  2. **Consistent Diagnostic Traceability:** All notification records are visible in real-time logs, log exports, and file logs under the `[Notification]` logging source tag.

## Language Decision & Analysis Diagnostics Architecture (ADR-014)
- **Problem & Root Cause Analysis:**
  - When media files had missing original language metadata, unlabelled audio streams (`und`/`unk`), or metadata conflicting with embedded audio tags, language evaluation fell back silently without diagnostic trace logs.
  - Media collection and series completeness analysis operations suppressed intermediate item errors silently in arrays without logging warning traces to `LoggingService`.
- **Architectural Enforcement Standards:**
  1. **Transparent Language Decision Diagnostics:** `LanguageDecisionService` emits detailed warning logs under `[LanguageDecision]` whenever original language metadata is unknown, stream language tags are missing/unreliable, or audio tags conflict with provider metadata.
  2. **Analysis Resiliency & Error Logging:** Collection and series analysis engines log informative warning traces to `LoggingService` on individual item errors while continuing execution, ensuring full diagnostic observability in logs.
  3. **Extras Disambiguation & Scraping Defense:** `FileNameParser.isExtrasContent` catches bonus disc extras and raw camera clips to prevent invalid scraper queries against remote APIs.

## Fine-Resolution Episode-Interleaved Franchise Timelines Architecture (ADR-015)
- **Problem & Root Cause Analysis:**
  - TV series and films in large franchises (Star Trek 24th century TNG/DS9/VOY/Films, Star Wars The Clone Wars, MCU) run concurrently and interleave at the individual episode level.
  - Coarse show-level entries (`type: 'show'`) collapsed series into contiguous chunks, preventing accurate chronological playback and playlist construction.
- **Architectural Enforcement Standards:**
  1. **Fine-Resolution SSOT:** All franchise timeline recipes in Totality strictly define viewing orders down to the individual episode (`type: 'episode'`, `seasonNumber`, `episodeNumber`) and movie (`type: 'movie'`) level.
  2. **Canonical 1-to-1 Interleaving:** TV show episodes and films are sequenced in exact chronological air/in-universe order.
  3. **Unfragmented Resolution & Sync:** `TimelineResolutionEngine` and `PlexPlaylistSyncService` resolve and sync items in exact 1-to-1 order to create seamless Plex watch-through playlists.

## Home TV Completeness, Green CI Gate & Process Resilience Architecture (ADR-016)
- **Problem & Root Cause Analysis:**
  - Home TV completeness suffered from contract breakdown: `SourceContext` ignored `Mixed` library types and collapsed library type detection to empty sets when live discovery timed out, while automatically forcing single-source focus instead of default aggregated view (`activeSourceId: null`).
  - Unscoped series analysis runs (`series:analyzeAll`) persisted blank `source_id` attributes, hiding incomplete shows from dashboard queries.
  - Dashboard item dismissal wrote mismatched exclusion keys (`missing_episode` / `missing_album` instead of `series_episode` / `artist_album`), failing to suppress dismissed items.
  - Tests had platform-specific assumptions (hardcoded Windows backslashes and drive letters), causing CI failures on Linux.
  - Main process shutdown prematurely closed SQLite connections before persisting interrupted tasks, and global hardware acceleration was disabled.
- **Architectural Enforcement Standards:**
  1. **Resilient Type Detection & Aggregated Default:** `SourceContext` inspects mixed libraries and falls back to cached SQLite stats (`getLibraryStats` / `musicGetStats`) on network discovery timeouts, keeping `activeSourceId = null` by default for unified multi-source visibility.
  2. **Authoritative Exclusion Contract:** UI dismissals strictly write canonical exclusion entity keys (`series_episode`, `artist_album`, `collection_movie`).
  3. **Scoped Entity Inheritance:** Series analysis runs derive `source_id` and `library_id` from existing constituent episode items when executed without explicit scope parameters.
  4. **Strict IPC Sender Authorization:** `validateSenderFrame` verifies incoming IPC messages originate strictly from authorized local frame URLs (`file://`, `app://`, `http://localhost:`).
  5. **Ordered Graceful Shutdown:** Electron `before-quit` awaits `persistInterruptedTasks()` before closing database connections, preventing corrupted task queue states across restarts.

## Quality Metrics SSOT, Automated Currency & UI Convergence Architecture (ADR-017)
- **Problem & Root Cause Analysis:**
  - Parallel and competing metric systems existed across `QualityAnalyzer`, renderer-side calculations (`getQualityTier`), TV dry-run aggregation, and repository fallbacks.
  - Video analysis was setting `storage_debt_bytes = null`, and music analysis was setting both `efficiency_score = null` and `storage_debt_bytes = null`, causing downstream components to manufacture synthetic values or fall back to stale copies.
  - `ShowCard.tsx` had a fragile custom memo comparator that checked title and episode count but ignored `weighted_efficiency`, `total_recoverable_bytes`, and `evidence_status`, causing stale React rendering when metrics updated.
  - Global sort controls in the Music view presented misleading "Efficiency" and "Recoverable" headers that sorted artists but not the album/track collections displayed beneath.
- **Architectural Enforcement Standards:**
  1. **QualityAnalyzer as Sole Producer (SSOT):**
     - Retains existing persisted column names (`storage_debt_bytes`, `efficiency_score`) without schema/name churn.
     - `storage_debt_bytes` is defined strictly as defensible recoverable bytes: removable non-original language audio stream bytes (`audio_pruning_bytes`) plus video stream bloat bytes over the tier target (`video_bloat_bytes`).
     - Never manufacture values: when duration or stream evidence is missing, `storage_debt_bytes` and `efficiency_score` evaluate to `null` ("Unknown"), never `0`.
  2. **Music Metric Simplification:**
     - Music items are evaluated strictly on audio fidelity (`quality_tier`, `tier_quality`, `tier_score`, `codec_score`, `bitrate_score`), completeness, and size.
     - `efficiency_score` and `storage_debt_bytes` are omitted (kept `null`) for music; never forced into video storage debt metrics.
     - Delete renderer-side `getQualityTier()` implementations across `mediaUtils.ts`, `MusicView.tsx`, `TrackListItem.tsx`, and `MusicAlbumDetails.tsx`.
     - Remove misleading "Efficiency" and "Recoverable" headers and sort keys from `MusicView.tsx`.
     - Never default an unanalyzed music item to `LOSSY_MID`.
  3. **Automated Currency & Pure Derived Aggregates:**
     - Recalculation triggers automatically on scan/rescan, metadata edits, transcode completion, and quality settings updates.
     - Manual library scans coerce analysis on existing unchanged files by including `TaskType.QualityAnalysis` in the post-scan pipeline.
     - TV Show aggregate metrics (`total_size`, `total_recoverable_bytes`, `weighted_efficiency`) are derived strictly from child episode records upon episode analysis completion.
     - Eliminate the fallback chain and in-memory sort array hack in `TVShowRepository`; queries sort directly on canonical columns in SQLite.
  4. **React Re-render Fix:**
     - Remove the custom memo comparator in `ShowCard.tsx` to ensure cards immediately reflect updated metrics via standard shallow equality.

## Audio Track Protection SSOT & Normalization Architecture (ADR-018)
- **Problem & Root Cause Analysis:**
  - Duplicate audio track protection logic and regex evaluations were scattered across `LanguageDecisionService.ts`, `QualityAnalyzer.ts`, and `StreamSelectionPlan.ts`.
  - Divergence risks: differences in title regexes (such as commentary, narration, descriptive, accessibility) and disposition flag handling (`comment`, `visual_impaired`, `hearing_impaired`) across services could lead to inconsistent decisions between stream analysis, transcode planning, and quality scoring.
  - Previous refactoring attempts risked violating media metadata absence and type contracts established in PR #155 by omitting validation checks before track property evaluation.
- **Architectural Enforcement Standards:**
  1. **Centralized SSOT (`audioTrackUtils.ts`):**
     - Single source of truth for audio track protection detection and regex patterns (`COMMENTARY_TITLE_REGEX`, `AUDIO_DESCRIPTION_TITLE_REGEX`, `ACCESSIBILITY_TITLE_REGEX`, `PROTECTED_TITLE_REGEX`).
     - Standardized helper functions: `isCommentaryTrack()`, `isAudioDescriptionTrack()`, `isAccessibilityTrack()`, and composite `isProtectedAudioTrack()`.
  2. **Strict Metadata Validation Contract Preservation:**
     - `QualityAnalyzer.ts` strictly validates track title via `metadataString(track.title, 'audio track title')` prior to invoking protection helpers, maintaining PR #155 fail-closed contract.
  3. **Zero Policy Mutation During Refactoring:**
     - Pure extraction preserving existing audio protection semantics across all consumers. Any behavioral or policy changes must be explicitly separated.

## Electron Packaging Formats and Minification (ADR-019)
- Keep Electron library entries explicitly CommonJS and rely on each entry's `build.lib.entry`; do not also set the plugin's shortcut `entry`, which adds the package's ESM format during Vite config merging and duplicates output at `.cjs` paths.
- Use Vite 8's Oxc minifier for Electron bundles; esbuild minification is deprecated in Vite 8.

## Dependency maintenance decision - 2026-10-02
Use the registry's newest stable versions within declared peer contracts. Keep ESLint 9 and TypeScript 6 until the existing plugins support their next majors. Drizzle insert calls use the canonical SQLiteInsertValue type under TypeScript 6. Joined TV filters reuse BaseRepository.buildAlphabetFilter. Lifecycle test resources follow ownership: UI unmount before database closure, and each directly constructed service is closed by its creating suite.

## TV summary reconciliation ownership - 2026-10-02
`SeriesCompletenessService.analyzeAllSeries` is the single owner of post-analysis TV summary cleanup. On a completed run, it backs up SQLite once and transactionally reconciles every affected source/library scope, including source-wide runs with no explicit library filter. The task queue forwards reconciliation evidence; it does not own a second cleanup path. Partial, failed, and cancelled analyses do not prune summaries.

## Analysis evidence, summary repair, and individual optimization - 2026-10-02
- Packet byte accounting consumes FFprobe's named compact packet fields and treats missing packet sizes as incomplete measurements. Unknown/malformed byte evidence cannot become zero-byte evidence.
- Quality scores use `MediaNormalizer` for video codec identity. Persisted savings values carry an allowed basis distinguishing measurements, estimates, and mixed evidence; the migration rebuilds the constrained table transactionally and preserves its rows.
- Individual media optimization and show optimization share the existing preflight result, source freshness checks, measured candidate sample gate, approval fingerprint, and task queue. Full media analysis and its quality score are refreshed by the app before an individual plan is built.
- TV summary reconciliation is app-owned: a completed source/library scan is followed by a SQLite backup and one transaction that deletes only identity-verified, unlocked orphan rows. Title similarity is not a deletion or merge key.

## Unified scoped analysis jobs - 2026-10-02
Analysis requests share the persisted task queue. A typed scope is the identity for duplicate detection; display labels are not. The main process selects source/library-specific stages, and scan follow-up submits the same canonical work after a successful scan. Analysis progress and outcomes are read from queue state. Optimization continues to use preflight, measured review where encoding is required, approval, and queued execution; renderer code does not perform file changes directly.

The existing `AnalysisTaskPlanner.planAnalysisStages` defines ordered scoped stages for item, show, collection, album, artist, library, and all-enabled-library jobs. Queue acceptance serializes duplicate and capacity checks and propagates persistence errors before acknowledgment. Running cancellation remains visible as `cancelling` until the executor stops. Series cleanup stays in `SeriesCompletenessService`, with no cleanup from unconditional finalization. Artist completeness rows use artist/source/library ownership; the schema update preserves old name-only rows as unassigned rather than attaching ambiguous rows to an owner. Individual optimization requires persisted file evidence, uses explicit retained streams for remux, and returns to the user for review after queued analysis.
- The TV repository propagates the scoped batch transaction into its owned identity repository; reconciliation aborts when any scoped episode lacks an identity key.
- Current verification: 208 test files and 1,626 tests passed (7 opt-in skips); production renderer/Electron bundles and Windows installer built. Live packaged UI launch and app-driven migration against isolated/live data are unverified.
# 2026-10-03 — UI refresh and operation cancellation decisions

- Paginated list refresh stays owned by `usePaginatedData`; library events update statistics/details without triggering parallel list reloads. Request generations guard views where the data source cannot cancel an executing read.
- Draft TMDB credentials are tested through the existing service endpoint without replacing the active stored key; only authentication rejection represents invalid credentials.
- Direct operation cancellation uses renderer-owned request IDs and main-process abort controllers. Queued operations remain owned by `TaskQueueService`; cancellation does not imply rollback of committed changes.
- Playback profile editing preserves raw drafts and persisted profile units, and copies built-ins through the repository duplication API.

2026-10-03: TMDBService owns automatic saved-credential validation and publishes revisioned session status via its existing IPC boundary. Reinitialization for ordinary reads does not schedule another check; superseded controllers are aborted and their results discarded.

## Foreground metadata search cancellation — 2026-10-04
Match Fix searches use renderer-owned request IDs registered with the existing main-process `OperationRequestRegistry`, without Activity metadata. The request signal passes through metadata fusion and provider search methods; user close/cancel aborts the shared read, and results arriving after cancellation are discarded. Match persistence remains a separate explicit write boundary.

## Plex playlist publication cancellation — 2026-10-04

Plex playlist sync is registered as a background Activity operation. Cancellation propagates through validation, staging, and sequence verification. Before publication, cancellation removes the staged playlist and local publication record; if remote cleanup cannot be confirmed, the operation reports partial work and preserves the recovery record. The title publication and replacement deletion sequence is the commit boundary and reports Finishing until it settles. The timeline panel has a status/Open Activity affordance, with cancellation centralized in Activity.

## Foreground network discovery cancellation — 2026-10-04

Jellyfin/Emby local UDP discovery remains owned by the setup dialog. Its request ID uses the existing owner-scoped operation registry without background Activity metadata. Closing or leaving the dialog cancels the request; the discovery service clears its wait timer and closes the active UDP socket. No additional UI control or Activity row is introduced for this automatic discovery.

## UI interaction ownership and duplicate outcomes — 2026-10-05

Global search has one renderer owner in TopBar and uses the existing registered `mediaSearch` contract. Search requests are debounced and generation-scoped so superseded responses cannot update visible state. Queued optimization controls remain in Activity; the originating modal reports progress and links to Activity. Persisted analysis notifications remain the only analysis outcome feed.

Duplicate resolution returns a discriminated outcome (`kept`, `deleted`, `policy-blocked`, `partial`, or `failed`) with committed counts and per-item errors. The existing retention policy is authoritative. Filesystem deletion is asynchronous; a group is resolved only after its requested action and record updates complete. Partial outcomes remain pending for review, and the UI confirms disk deletion before entering the non-cancellable commit phase.

Primary navigation uses navigation semantics; media actions support keyboard activation and expose visible focus. Modal focus traps are stack-aware so nested overlays do not steal focus from the active child and restore focus to their opener on close. Errors remain announced until dismissed, and reduced-motion preferences are honored.

## Exact stream metrics and scan follow-up outcomes — 2026-10-05

Complete media analysis now gathers per-stream packet bytes and target-video sliding-window bitrate statistics in one FFprobe packet pass, while retaining exact full-stream audio volume decoding. Scoped scans report post-scan analysis queue failures as partial scan outcomes, and cancellation during analysis does not generate error notifications. Activity can clear all completed task history while preserving queued/running work. Transcoding Settings lists only verified encoders.

Verification: focused regression checks passed (6 files, 41 tests); `npm test` passed (210 files, 1,616 passed, 7 skipped); `npm run build` passed and produced the Windows installer. Live library timing, packaged UI behavior, cancellation acceptance, and stored-cache interpretation remain unverified. Legacy timeline cache rows were retained because their intended ordering cannot be inferred safely.

## TV Show Optimization & Track Pruning Pipeline Architecture (2026-10-07)

- **Show-Level Optimization Preflight (`TranscodingService`):**
  - Show optimization operates through an atomic preflight review before queuing.
  - Episodes are queried by canonical `(series_title, source_id, series_identity_key, library_id)` tuple.
  - Preflight generates a unique batch ID and preflight ID with an expiration TTL, ensuring reviewed tracks, bitrates, and client profiles match at execution time.
- **Ordered Task Queue Execution (`TaskQueueService`):**
  - Authorized episodes are mapped to `TaskType.Transcode` background tasks and queued sequentially in natural season/episode order.
  - Active and queued tasks maintain a dedup set (`queuedMediaIds`) to prevent duplicate encoding runs for identical media IDs.
  - Cancellation requests cascade from `TaskQueueService.cancelCurrentTask()` directly to `TranscodingService.cancel(mediaItemId)`.
- **Protected Audio & Subtitle Safeguards:**
  - Automated stream selection plans strictly protect original language tracks, director/audio commentary, audio descriptions, and spatial/object audio (Dolby Atmos, DTS:X).
  - Subtitle track extraction preserves default and forced flags across container formats.
- **Option B Architecture Enforcement (Pure Native SQLite):**
  - Database access adheres to `BetterSQLiteService.ts` using synchronous transactions (`withBatch`) and WAL mode auto-persistence.
  - Direct repository access methods (`getItemVersionsForMediaIds`, `upsertQualityScores`, `updateVersionQuality`, `updateBestVersion`) avoid ORM overhead while preserving SQL concurrency invariants (`BEGIN IMMEDIATE`).

## Duplicate Resolution and TV Queue Ordering Safeguards (2026-10-07)

- **Deduplication Resolution Lifecycle (`DeduplicationService`):**
  - Scanning groups movies by `source_id:tmdb_id` (or `global:tmdb_id`) and episodes by `seriesKey:S<season>E<episode>`.
  - Abort signals are checked cooperatively during iteration and immediately before committing duplicate records.
  - Resolution policies evaluate candidates using a composite score: resolution height, original language audio match (+15 bonus), and video bitrate.
  - Deletion of non-canonical files requires explicit `dup_policy_auto_delete === 'true'`. If disabled, the service returns `policy-blocked` without disk unlinks.
  - Filesystem deletion via `fs.unlink` occurs before deleting the database record, ensuring that failure to delete a physical file does not orphan library state. Missing records return `failed` or `partial`.
- **Show Optimization Preflight Invariants (`TranscodingService`):**
  - Preflights expire after a 30-minute TTL. Attempting to queue an expired preflight discards the stored configuration and throws an expiration error requiring a fresh preflight.
  - Episodes are queued into `TaskQueueService` strictly in season and episode order, retaining all preflight batch identifiers, target profiles, and stream selection parameters.

## TV Series Identity Key Migration & Grounded Savings Architecture (2026-10-08)

- **Canonical Series Identity Format & Precedence:**
  - Standardized series identity keys follow strict canonical precedence:
    1. TMDB ID: `tmdb:<id>`
    2. TVDB ID: `tvdb:<id>`
    3. Unresolved Slug: `unresolved:<sourceId>:<libraryId>:<normalized-slug>`
  - Ambiguous titles or records without authoritative external identifiers are explicitly scoped to their library without guessing external IDs.
  - Title-based database queries and fallbacks have been completely eliminated (`getEpisodes` requires `seriesIdentityKey`; `getTVShows` groups by `series_identity_key, source_id, library_id`).
- **Database Identity Integrity Triggers:**
  - `series_completeness` table enforces identity keys at schema level via SQLite `BEFORE INSERT` and `BEFORE UPDATE` triggers aborting any write with null or whitespace-only keys.
  - Unique composite index `(series_identity_key, source_id, library_id)` prevents show collisions across or within sources.
- **Grounded Savings Persistence Policy:**
  - Persisted debt in `quality_scores` remains canonical `storage_debt_bytes`.
  - Component breakdowns (`videoTranscode`, `trackRemoval`, `audioTranscode`) are computed dynamically from verified FFprobe audio and video streams via `OptimizationSavingsService.ts`.
  - Legacy records are not artificially partitioned into fabricated sub-fields, preserving absolute data fidelity.

## Deterministic Summary Deduplication & Real SQLite Verification (2026-10-08)

- **Deterministic Summary Winner Selection:**
  - When resolving duplicate rows for `(series_identity_key, source_id, library_id)`, records are deterministically ranked by:
    1. Highest completeness percentage (`completeness_percentage DESC`)
    2. Most owned episodes (`owned_episodes DESC`)
    3. Non-empty TMDB ID presence (`tmdb_id DESC`)
    4. Non-empty poster artwork (`poster_url DESC`)
    5. Latest updated timestamp (`updated_at DESC`)
    6. Primary key ID tiebreaker (`id DESC`)
  - Surviving winner absorbs missing metadata fields (`tmdb_id`, `tvdb_id`, `poster_url`, `backdrop_url`, `status`) from losing duplicates before duplicate deletion.
- **Fail-Loud Constraint Verification:**
  - Unique index creation is not wrapped in permissive exception suppressions; duplicate remnants fail loudly.
  - Trigger-level write verification ensures zero empty or null `series_identity_key` entries can be written during runtime operations.
- **Real SQLite WebAssembly Engine Testing:**
  - Migration regression tests execute directly against `sql.js` in-memory SQLite instances to validate genuine SQL execution, transaction rollbacks, savepoints, and trigger abort behavior.

## SQLite Query Quoting Standards & External Provider HTTP Headers (2026-10-09)

- **SQL Literal Quoting vs Identifier Quoting:**
  - In SQL (and specifically SQLite with modern DQS restrictions or strict compilation), double quotes `"` designate identifiers (table and column names).
  - String literals must exclusively use ANSI single quotes `'` (e.g. `series_identity_key = ''` or `series_identity_key != ''`).
  - Double quotes around empty strings (`""`) trigger `SqliteError: no such column: ""` on statement preparation.
- **Provider HTTP Protocol Negotiation:**
  - Upstream Plex Media Server endpoints default to XML serialization unless clients explicitly negotiate JSON via headers.
  - All Plex API requests must uniformly supply `defaultHeaders` which include `'Accept': 'application/json'` along with client identifiers (`X-Plex-Client-Identifier`, `X-Plex-Product`, `X-Plex-Version`, `X-Plex-Platform`).
  - Omitting `Accept: application/json` causes XML responses (`<?xml version...`) to be returned to `fetchJSON`, triggering `SyntaxError: Unexpected token '<'` during JSON parsing.
