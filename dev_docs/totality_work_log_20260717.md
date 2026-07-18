# Totality Work Log - 2026-07-17

## Tasks Accomplished
* **Resolved Empty Transcode File Failure**: Fixed HandBrake CLI transcoding failure where using NVIDIA AV1 GPU acceleration generated an empty file.
  * Corrected NVIDIA AV1 hardware encoder name from `av1_nvenc` to the expected HandBrake CLI argument `nvenc_av1` in [TranscodingService.ts](file:///H:/Totality/src/main/services/TranscodingService.ts) and [TranscodeModal.tsx](file:///H:/Totality/src/renderer/src/components/library/TranscodeModal.tsx).
  * Added fallback normalization to map `av1_nvenc` inputs to `nvenc_av1` in `TranscodingService.ts` for backward-compatibility.
  * Expanded `allowedVideoCodecs` to include 10-bit encoder options (`nvenc_av1_10bit`, `nvenc_h265_10bit`, `qsv_h265_10bit`) and verified validation checks pass.
  * Added 10-bit encoding options (`nvenc_av1_10bit`, `nvenc_h265_10bit`, `qsv_h265_10bit`) directly to the Video Encoder dropdown selector in `TranscodeModal.tsx` to improve UX.
* **Implemented GPU & Handbrake CLI Caching**: Optimized startup and check performance by avoiding redundant system/process executions:
  * Modified [GpuDetector.ts](file:///H:/Totality/src/main/services/utils/GpuDetector.ts) to cache the list of detected GPUs in a private static field so the hardware query (`wmic`, `system_profiler`, or `lspci`) is only run once during the application's runtime.
  * Integrated **persistent database caching** for GPU detection. When first detected, the GPU list is saved in the SQLite `settings` table (under `detected_gpus`). Subsequent launches check the persistent setting first to eliminate hardware command invocations completely.
  * Modified [TranscodingService.ts](file:///H:/Totality/src/main/services/TranscodingService.ts) to cache HandBrake CLI availability and version information internally, avoiding redundant process spawn calls to `HandBrakeCLI --version` on every check.
  * Ensured caches are safely reset when `invalidate()` is invoked in the transcoding service.
* **Implemented FFmpeg Fallback Transcoding**: Added support to perform transcode optimizations using the pre-existing FFmpeg installation if HandBrake CLI is not available or configured.
  * Modified `TranscodingService.ts` to return both HandBrake CLI and FFmpeg availability states via `checkAvailability()`.
  * Implemented `runFFmpeg()` in `TranscodingService.ts` to transcode files using mapped arguments:
    * Mapped HandBrake video encoder identifiers to their corresponding FFmpeg encoders (e.g. `nvenc_av1` -> `av1_nvenc`, `svt_av1` -> `libsvtav1`).
    * Configured pixel format options for 10-bit output (`-pix_fmt yuv420p10le`), and rate control modes (`-rc constqp -cq` for NVENC, `-global_quality` for QSV, and `-crf` for software encoders).
    * Set audio mapping to preserve all audio tracks natively via bitstream copy (`-c:a copy`) or isolate the first track.
    * Added full cancellation listener (`AbortSignal`) to clean up output files upon termination.
  * Updated [TranscodeModal.tsx](file:///H:/Totality/src/renderer/src/components/library/TranscodeModal.tsx) to allow parameter generation and optimization starts if either HandBrake or FFmpeg is present, and added an informative blue notice banner when falling back to the FFmpeg engine.
  * Corrected test assertions in `TranscodingService.test.ts` to cleanly decouple them from the system-specific FFmpeg availability state.
* **Resolved Build Compilation Errors**:
  * Added `transcodingEngine` directly to the backend `TranscodeOptions` interface declaration to solve TS2339 properties lookup error.
  * Added null/undefined type narrowing checks in `TranscodingService.runFFmpeg` to resolve TS2538 (Type undefined cannot be used as index) and TS18048 (possibly undefined) errors.
  * Added `ffmpegArgs?: string[]` parameter to the local `TranscodingParams` interface declaration inside [TranscodeModal.tsx](file:///H:/Totality/src/renderer/src/components/library/TranscodeModal.tsx).
  * Provided explicit string typing to map callback arguments (`(arg: string) =>`) in UI clipboard handlers.
* **Fixed TV Shows Sorting & Filtering (Efficiency & Waste)**:
  * Aligned all UI-provided `sortBy` parameters (`'storage_debt'`, `'size'`, `'season_count'`, `'episode_count'`) within `sortMap` in [TVShowRepository.ts](file:///H:/Totality/src/main/database/repositories/TVShowRepository.ts) to eliminate default fallback to title sorting.
  * Added metric aggregation logic (for `total_size`, `storage_debt_bytes`, and `efficiency_score` average) in [SeriesCompletenessService.ts](file:///H:/Totality/src/main/services/SeriesCompletenessService.ts) and wired them to `upsertCompleteness` in the repository, resolving the issue where these columns were permanently empty/NULL in the database.
  * Added `'year'` and `'completed_at'` to the `sortMap` of [WishlistRepository.ts](file:///H:/Totality/src/main/database/repositories/WishlistRepository.ts) to address similar fallback-to-addedAt anomalies.
* **Resolved MusicBrainz API "Invalid URL" Failures**:
  * Added explicit initialization call (`getMusicBrainzService().initialize()`) during app launch in [index.ts](file:///H:/Totality/src/main/index.ts) to ensure default/configured base URL is loaded onto the Axios instance, resolving log warnings where API queries failed due to lacking domains.
* **Implemented MusicBrainz Settings UI & Wired IPC Handlers**:
  * Created a dedicated **MusicBrainz API ServiceCard** in [ServicesTab.tsx](file:///H:/Totality/src/renderer/src/components/settings/tabs/ServicesTab.tsx) that allows displaying, editing, resetting, and testing the `musicbrainz_base_url` setting.
  * Discovered and wired up several missing/unregistered MusicBrainz and match-fixing IPC handlers in [music.ts](file:///H:/Totality/src/main/ipc/music.ts) (including `SEARCH_MB_ARTIST`, `SEARCH_MB_RELEASE`, `GET_ARTIST_COMPLETENESS`, `ANALYZE_ARTIST_COMPLETENESS`, `ANALYZE_ALBUM_TRACK_COMPLETENESS`, `FIX_ARTIST_MATCH`, and `fixAlbumMatch`).
  * Created target `fixArtistMatch` and `fixAlbumMatch` methods in [MusicRepository.ts](file:///H:/Totality/src/main/database/repositories/MusicRepository.ts) to support explicit user-fixed match flags (`user_fixed_match = 1`) on artists/albums.


