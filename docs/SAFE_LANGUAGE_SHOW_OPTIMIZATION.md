# Safe language cleanup and show-level optimization

Status: implemented on `agent/safe-language-show-optimization` (`0fac865`).

## Purpose

This workflow is opt-in and Arr-first. Totality measures recoverable storage, recommends the authoritative acquisition action, and only performs a local stream-copy cleanup when the file is proven eligible. Sonarr/Radarr remain responsible for language, quality, and acquisition decisions.

Arr-managed files are never remuxed during the execution that requests an Arr search. The request is persisted as `awaiting-rescan`; the file can only be reconsidered after a later Totality scan.

## Decisions and discussion outcomes

- Original-language cleanup requires agreement between matched original-language metadata and reliable embedded audio tags.
- Unknown, contradictory, or ambiguous language evidence always produces `review-required` and blocks automatic removal.
- Original-language main audio is retained.
- Commentary, audio-description, narration, hearing/accessibility, and other explicitly protected tracks are retained even when their language differs.
- Subtitles, chapters, metadata, and video are preserved by explicit stream mapping and stream copy.
- Plex is not used as a destructive source-cleanup mechanism.
- Quarantine is mandatory for automatic local cleanup. Quarantine expiry is a separate policy.
- Failed remux verification leaves the active source untouched.
- Database path/stat changes occur only after the verified output is activated.
- Show priority is recoverable bytes descending, not episode count or an unweighted average.

## Architecture

### Language decisions

`src/main/services/LanguageDecisionService.ts` exposes `LanguageDecision` and classifies each audio stream as `retain`, `remove`, or `review-required`.

ISO-639-2 and ISO-639-1 language aliases are normalized at the service boundary. A decision is approved only when every candidate audio stream has a reliable language tag and the metadata evidence agrees.

### Show metrics

`src/main/services/ShowOptimizationMetricsService.ts` exposes `ShowOptimizationMetrics`:

```text
show waste = sum(episode recoverable bytes)
weighted efficiency = sum(episode efficiency * episode size) / sum(episode size)
```

The result also includes total size, scored episode count, and unscored episode count. Zero-size and unscored episodes are handled explicitly.

### Arr integration

`ArrIntegrationService` reads Sonarr/Radarr language profiles and managed-series state. It can report whether a monitored item has a configured profile and can pursue an upgrade. Totality does not implement Arr-like profiles or download logic.

Pending requests are stored under `optimization.pending.*`. A repeated request returns the existing pending record instead of issuing another search.

### Local remux

`src/main/services/LanguageRemuxService.ts` is intentionally separate from `TranscodingService`.

The service:

1. Creates a same-volume temporary output.
2. Maps the first video stream, selected audio streams, subtitles, attachments, chapters, and metadata explicitly.
3. Uses `-c copy` only.
4. Verifies non-empty output, duration, and audio stream inventory with FFprobe.
5. Moves the original into the configured quarantine directory.
6. Activates the verified temporary output.
7. Updates media path, file size, and duration only after activation succeeds.

The IPC boundary refuses to run without verified FFmpeg and FFprobe paths.

## IPC and renderer interfaces

Added channels and preload methods:

- `optimization:dryRun`
- `optimization:decideLanguage`
- `optimization:requestArrSearch`
- `optimization:getPending`
- `optimization:localRemux`
- `arr:getLanguageProfiles`
- `arr:getManagedState`

TV show cards and list rows expose dry-run and request actions. Dry-run output reports recoverable bytes, scored/unscored coverage, and the recommended state. The request action requires opt-in Arr configuration when no application-level callback is supplied.

TV summaries expose total size, recoverable bytes, weighted efficiency, scored/unscored counts, and recommended action. The list supports recoverable-byte priority and displays recoverable storage and weighted efficiency.

## Test coverage

Focused tests cover:

- Agreeing original-language metadata and embedded tags.
- Unknown and conflicting language evidence.
- Protected commentary/accessibility tracks.
- Summed recoverable bytes.
- Size-weighted efficiency.
- Unscored and zero-size episodes.
- Arr-managed awaiting-rescan behavior.
- TV recoverable-byte sort direction.

Focused verification completed with 6 passing tests and TypeScript compilation passing. Production client/main/preload bundles also compiled successfully.

## Verification limits

The full repository suite reported 930 passing tests and one unrelated existing failure in `TranscodingBuilders.test.ts`: the dirty transcoding worktree expects `fps_mode=passthrough`, while the current implementation emits a different mode. Those unrelated transcoding changes were intentionally excluded from the feature commit.

Electron packaging reached the packaging stage but could not complete because the execution environment denied outbound dependency download access.

## Commit scope

Feature commit: `0fac865 Add safe language show optimization workflow`.

The repository contained unrelated transcoding, package, and renderer changes. They were intentionally left unstaged and are not represented by the feature commit.
