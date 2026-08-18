# Architecture Decision Records (ADRs)

## ADR-001: TV Show Canonical Single-Identity & Deduplication Invariant (TOT-BUG-03)

### Status
Accepted & Test-Verified

### Context & Problem
Previously, local and remote media scans could generate duplicate `series_completeness` records and split episode trees for the same physical television series. This was caused by:
1. Directory path variations where season folders (`Season 1`, `Season 02`, `Staffel 1`, `Specials`) or scene release tags (`[1080p BluRay x265-GROUP]`, `1080p.Web-DL`) were parsed as separate show titles.
2. Lack of scoped database uniqueness constraints on external IDs (`tvdb_id`, `tmdb_id`) and identity keys (`series_identity_key`) within a `(source_id, library_id)` scope.
3. Multiple scanning passes inserting distinct unresolved stubs (`unresolved:<sourceId>:<libraryId>:<title>`) that were never merged once external IDs were resolved.

### Invariants & Architectural Rules
1. **Canonical Path & Title Normalization**:
   - `FileNameParser.isSeasonOrExtrasFolder`: Season directories (`Season \d+`, `S\d+`, `Staffel \d+`, `Saison \d+`, `Temporada \d+`, `Series \d+`) and extras folders (`Specials`, `Extras`, `Featurettes`, `Behind the Scenes`, `Deleted Scenes`) are stripped from series title paths.
   - `FileNameParser.stripReleaseTags` and `cleanSeriesTitleAndYear`: Codec, resolution, audio formats, scene group suffixes, and bracketed tags are stripped to extract canonical title and year.
   - Unresolved identity keys are formatted as `unresolved:<sourceId>:<libraryId>:<canonical-slug>` to guarantee that episodes in `Season 1/` and `Season 2/` share the exact same key.

2. **Scoped Database Uniqueness Constraints**:
   - `idx_series_completeness_unique`: `UNIQUE(series_identity_key, source_id, library_id)`
   - `idx_series_completeness_tvdb`: `UNIQUE(source_id, library_id, tvdb_id) WHERE tvdb_id IS NOT NULL AND tvdb_id != ""`
   - `idx_series_completeness_tmdb`: `UNIQUE(source_id, library_id, tmdb_id) WHERE tmdb_id IS NOT NULL AND tmdb_id != ""`

3. **In-Place Upsert Conflict Resolution**:
   - `TVShowRepository.upsertCompleteness` checks for existing matching records by `series_identity_key`, `tvdb_id`, or `tmdb_id` within the scoped library and updates in place, preserving locked user matches (`user_fixed_match = 1`) and updating episode/season counts without throwing uniqueness violations.

4. **Migration & Cluster Merging**:
   - `mergeDuplicateSeriesCompleteness` clusters legacy duplicate records by matching `tvdb_id`, `tmdb_id`, `series_identity_key`, or normalized title + year.
   - It repoints all associated `media_items`, `media_identities`, and `media_aliases` to the canonical record.
   - It recalculates aggregate stats (`owned_seasons`, `owned_episodes`, `total_size`, `storage_debt_bytes`, `efficiency_score`) directly from `media_items` and safely deletes secondary rows.

### Verification & Testing
- Automated regression suite: `tests/test_tv_deduplication.py` (Python `unittest` / `sqlite3`).
- Unit & integration suite: `tests/unit/TVShowDeduplication.test.ts` (Vitest).

---

## ADR-003: Architectural Refactoring Plan — SOLID Principles, SSOT, and Redundancy Elimination

### Status
Accepted & Implemented

### Context & Goals
An architectural audit of media ingestion, identity resolution, repository access, and completeness analysis identified opportunities to enforce strict Single Source of Truth (SSOT), eliminate duplicate heuristics, and optimize algorithmic complexity while adhering strictly to SOLID design patterns.

### Architectural Improvements & Design Patterns
1. **SSOT for Extras & Media Classification (Strategy / Parser Pattern)**:
   - **Problem:** `LocalFolderProvider` and `FileNameParser` maintain separate regular expression arrays for featurettes, extras, BTS, deleted scenes, and commentary.
   - **Solution:** Make `FileNameParser` the sole SSOT for media categorization by exposing `isExtrasContent(pathOrName)`. `LocalFolderProvider` delegates directly to this parser, ensuring consistent classification across all provider scanners.

2. **Batch Querying & Performance in Identity Resolution (Repository Pattern)**:
   - **Problem:** `TVShowRepository.getSummaries()` triggers $N$ parallel async database round-trips via `Promise.all` to query `IdentityRepository.getConflictingEntityIds()`.
   - **Solution:** Add `IdentityRepository.getBatchConflictingEntityIds('series', entityIds, identitiesList)` using SQL `IN (...)` batch lookups, reducing database query overhead from $O(N)$ round-trips to $O(1)$.

3. **$O(1)$ Set-Based Analysis in `SeriesCompletenessService` (SRP & Clean Domain Logic)**:
   - **Problem:** `SeriesCompletenessService.analyzeAllSeries()` uses $O(N \times M)$ linear searches (`showsToAnalyze.some(...)`) and indexes `completenessMap` strictly by raw title string.
   - **Solution:** Refactor membership lookups to use `Set<string>` and index `completenessMap` primarily by `series_identity_key` (with fallback to `series_title`), guaranteeing deterministic $O(1)$ lookups.

4. **Consolidated Startup Migrations (Template Method & Idempotence)**:
   - **Problem:** Redundant index checks exist between `migrateSeriesIdentity` and `mergeDuplicateSeriesCompleteness`.
   - **Solution:** Deprecate legacy table renames and establish `mergeDuplicateSeriesCompleteness` as the unified authority for deduplication, column backfills, and unique index enforcement on startup.

5. **Schema SSOT Alignment**:
   - **Problem:** Table schemas and index constraints are defined in both raw SQL strings (`schema.ts`) and Drizzle ORM definitions (`drizzleSchema.ts`).
   - **Solution:** Maintain Drizzle ORM definitions in `drizzleSchema.ts` as the primary SSOT for database contracts.

---

## ADR-004: Movie Collection Direct Resolution, Music Filter Query Builders, and Metadata Candidate Inverted Indexing

### Status
Accepted & Implemented

### Context & Goals
Further architectural review identified opportunities to eliminate redundant network queries, optimize search candidate fusion, and consolidate database filter building across music repositories and movie collection analyzers.

### Architectural Improvements
1. **Direct Collection ID Resolution (`MovieCollectionService`)**:
   - Instead of performing text-based search queries by collection name when the `tmdb_collection_id` is already stored, `MovieCollectionService.analyzeCollection()` accepts an optional `tmdbCollectionId` and directly calls `tmdb.getCollectionDetails(id)`, falling back to name search only when the ID is missing.

2. **Consolidated Filter Builders (`MusicRepository`)**:
   - Extract `buildAlbumFilterConditions()` and `buildTrackFilterConditions()` in `MusicRepository` to eliminate duplicated condition arrays between retrieval and count queries, following the single-responsibility query pattern from `TVShowRepository`.

3. **Inverted Index Candidate Deduplication (`MetadataMatchingService`)**:
   - In `MetadataMatchingService.matchMediaItem()`, replace $O(K \times I)$ linear scans over existing candidate entries with an inverted index `Map<string, string>` mapping `externalId -> candidateKey`, achieving deterministic $O(1)$ candidate deduplication across providers.

---

## ADR-005: Transcoding Architecture, Dolby Vision Profile 5 MKV-to-MP4 Remuxing, and HandBrake Integration

### Status
Accepted / Planned

### Context & Goals
Totality provides high-efficiency media transcoding and audio/video optimization. Two specific user requirements dictate this architectural expansion:
1. **Dolby Vision Profile 5 MKV to MP4 Remuxing:** Profile 5 uses proprietary ICtCp (IPT-C2) color space with dynamic RPU metadata stored in NAL units. Standard video re-encoding corrupts colors and strips RPUs. A zero-loss remuxing pipeline is required to repoint streams into Apple TV / Plex compatible MP4 containers with `-tag:v dvh1`, while copying or converting audio tracks into MP4-compliant streams (E-AC3 with Atmos, AAC).
2. **Re-encoding & External Tooling Strategy (dovi_tool & HandBrake):**
   - **Zero-Loss Remuxing vs Re-encoding:** Fast MKV to MP4 remuxing should be executed directly via native FFmpeg bitstream copying (`-c:v copy -tag:v dvh1 -movflags +faststart`).
   - **`dovi_tool` Hybrid Workflow:** When downsizing or re-encoding a DV file is explicitly requested, `dovi_tool` extracts RPU before re-encoding and injects it into the NVENC-encoded stream (`dovi_tool extract-rpu` $\rightarrow$ NVENC 10-bit encode $\rightarrow$ `dovi_tool inject-rpu`).
   - **HandBrake Presets & Engine:** While HandBrake does not perform fast zero-loss remuxing (it re-encodes every frame), Totality can export standard HandBrake JSON presets matching its hardware-tuned RTX 5070 Ti NVENC profiles and optionally delegate batch re-encoding to `HandBrakeCLI` when present.

### Architectural Decisions
1. **`DolbyVisionRemuxService`**:
   - Encapsulate Profile 5 MKV to MP4 stream copying, audio compliance conversion, subtitle conversion (`mov_text`), and fast-start moov-atom relocation.
2. **Update `HdrTranscodingPolicy`**:
   - Differentiate between destructive video re-encoding (which continues to guard against stripping dynamic HDR) and non-destructive Profile 5 container remuxing.
3. **Restore `HandBrakeCLI` Backend (from Git History)**:
   - Restore the `HandBrakeCLI` execution worker from git history (`commit 1707241` / `fafb9f4`) as an alternate engine strategy (`ITranscodeCommandBuilder`) selectable in the UI alongside FFmpeg.
4. **Exportable HandBrake Presets**:
   - Provide a preset generation utility creating official HandBrake `.json` presets tuned for hardware-accelerated 10-bit AV1/HEVC encoding on modern NVIDIA GPUs.

---

## ADR-006: SSOT Audio Bitrate Modeling, Formal DOVI Parsing, Responsive Viewport Architecture, and Unified Task Queue Observation

### Status
Accepted / Planned

### Directives & Architecture Principles Enforced
- **Zero Fallbacks / Fakes / Silent Errors:** Exact error surfacing via toast and status banners; explicit codec specifications rather than magic numbers; no silent fallthroughs.
- **Single Source of Truth (SSOT):** Centralize all audio codec quality rankings, nominal bitrate profiles, and uncompressed stream calculation formulas in `AudioCodecRanker`.
- **No Prepending Underscores:** All variables, enum identifiers, properties, and constants strictly use clean descriptive camelCase or PascalCase (no `__custom__`, `_var`, or leading underscores).
- **SOLID Component & Strategy Architecture:** Transcoding operations unify under the `TaskQueueService` and `useTaskQueue` observer architecture; UI elements use isolated CSS stacking contexts (`isolate`, `z-index`).
- **Reuse Existing APIs:** Reuse `useToast()`, `AudioCodecRanker`, `detectHdrFormat()`, `useTaskQueue()`, and `LanguageDecisionService`.

### Architectural Decisions
1. **Mathematical & Specification-Based Audio Bitrate Modeling (`AudioCodecRanker`)**:
   - For uncompressed PCM/LPCM streams: compute exact uncompressed bitrates mathematically via `channels * sampleRate * bitDepth`.
   - For compressed streams missing container-level bitrate tags: provide formal broadcast/Blu-ray specification nominal bitrates (Dolby Digital AC-3 640k, E-AC3 768k, DTS 1509k, DTS-HD MA 3500k, TrueHD 4000k, AAC 256k) centrally in `AudioCodecRanker`.
   - Eliminate duplicated zero-bitrate fallbacks in `OptimizationDecisionService`.

2. **Formal DOVI Metadata Matching (`detectHdrFormat` & `MediaFileAnalyzer`)**:
   - Inspect FFprobe side-data structures for `"DOVI configuration record"` and `"dovi"`, identifying Dolby Vision Profile 5, Profile 7, and Profile 8.1 streams authoritatively without mistaking them for baseline HDR10.

3. **Unified Scroll Viewport & Playlist Sync (`TimelinesView`)**:
   - Replace the static multi-row fixed header with a responsive, horizontally-scrollable recipe strip and a single root scroll container (`h-full overflow-y-auto`).
   - Clean identifier naming: use `custom-playlist-mode` for custom playlist selection.
   - Distinct presentation for `episode` items (season/episode number, title, air date, quality badge) and `movie` items.

4. **Unified Transcoding Queue Visibility (`ShowTranscodeModal` & `TaskQueueDrawer`)**:
   - When a series is submitted for batch optimization, transition directly to the live task queue observer, displaying real-time stream progression, encoding FPS, ETA, and queue controls (pause, resume, cancel).

5. **3-Dot Menu Stacking & Action Parity (`EpisodeRow`)**:
   - Isolate row stacking contexts (`relative z-50` when active) to prevent adjacent rows from clipping dropdown menus.
   - Synchronize actions with `MediaDetails` controller methods.

6. **Transparent *arr Diagnostics (`ServicesTab`)**:
   - Surface exact server responses, connected version numbers, and HTTP status/network error diagnostics via `useToast()`.





