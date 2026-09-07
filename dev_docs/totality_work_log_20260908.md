# Totality work log — 2026-09-08

## Remaining UI integrity and optimization cleanup

- Traced duplicate movie/music library items to offset pagination ordered only by non-unique user-selected fields. Added stable entity-ID tie-breakers in the owning repositories; no renderer-side deduplication was added. TV summary pagination already had a stable ID tie-breaker.
- Added real-SQLite regressions for deterministic movie, artist, album, and track pagination.
- Removed the legacy startup migration that guessed missing track-to-album relationships from artist/title strings with `LIMIT 1`.
- Added conservative startup repair for persisted music relationships that provably contradict stored identity: dangling, cross-source, or denormalized-name conflicts are unlinked, never guessed, merged, or deleted. Same-source cross-library relationships remain valid.
- Verified the existing whole-series optimization flow, stale preview sequencing, live progress throttling, and TV detail scrolling were already implemented and retained.
- Aligned the series optimizer with the established modal contract: dialog semantics, focus trap, Escape close when idle, correct modal layer, and bounded viewport.
- Changed the preview action from `Queue All Episodes` to `Queue Eligible Episodes`; backend preflight remains the single source of truth for eligibility.
- No LocalFolderProvider or `MusicRepository.buildAlbumConditions` changes were made because the investigation did not establish them as causes of the reported corruption.
