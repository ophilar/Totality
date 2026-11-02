# TV optimization and online viewing orders

Approved implementation plan, 2026-09-30.

## User stories
- Review measured samples for every eligible episode before approving show optimization.
- Reclaim disk space with the selected replacement mode and accurate quarantine accounting.
- View publisher-maintained orders and sync the reviewed snapshot to the selected Plex server.

## Requirements
- Freeze executable per-episode plans and invalidate approval when their inputs change.
- Preserve frame cadence, channel count, object audio, and protected stream semantics.
- Measure three 30-second sections; verify complete output before activation.
- Persist complete output analysis and owned artifact paths; scope show controls by batch.
- Refresh online guides on opening; expose stale snapshots and require explicit stale sync authorization.
- Match within the selected source and publish verified staged playlists before removing originals.

## Acceptance
Real FFmpeg, database/IPC, filesystem failure, online guide, and disposable Plex validation. Report unsupported or unverified encoder/HDR combinations; never operate on the user's media or playlists during validation.
