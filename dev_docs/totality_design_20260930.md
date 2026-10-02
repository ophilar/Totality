# TV optimization and viewing-order decisions — 2026-09-30

Extend the existing command-builder strategy and service APIs instead of adding a parallel optimization pipeline. An approved episode plan is the authority for streams, encoder settings, conversions, profile, source fingerprint and output mode. Actual sample evidence gates approval; full output verification gates journaled activation. Frame cadence remains the source cadence.

Reuse the canonical FFprobe parser for both worker and main-process analysis, including bounded frame side data for HDR10+ and actual Dolby Vision profiles. Materialize lossless transformed reference clips for hardware color conversion before metric comparison; inline multi-input hardware filters produced incorrect reference synchronization in real measurements.

Keep online provider selection explicit. A retrieved snapshot is the authority for resolution, preview and publication. Changing the selected library source re-resolves that snapshot. Failed refresh exposes the previous snapshot and its error; stale publication requires authorization for that snapshot. Canonical source ownership and unambiguous series identity govern resolution.

Extend existing activation jobs and settings publication records for recovery. A staged Plex sequence is verified before publication and previous-playlist deletion. A server that cannot reproduce deliberate repeats is rejected rather than silently changing the reviewed order. No watch-history mutation is needed.

## Unified analysis, database updates, and optimization — 2026-10-02

Keep analysis in one persisted task-queue workflow. `mediaAnalyze(scope)` acknowledges a durable typed scope; the main process validates ownership, plans ordered stages, aggregates required counts and diagnostics, and emits the terminal result. Queue acceptance is serialized across deduplication, capacity checks, and persistence. A successful library scan submits this same analysis job and waits for durable acceptance.

The analysis service owns file evidence and quality persistence for both item and bulk scopes. Music quality is a planned stage and all music reads are source/library scoped. Cancellation is task-specific and propagates between stages and items. Series reconciliation runs only after successful completeness, backs up once, and performs identity-scoped removal transactionally while preserving locked and ambiguous rows.

Optimization converges on preflight, review, approval, and the existing queue. Renderer code cannot invoke immediate local remux. Persisted file evidence is checked for missing or stale state; analysis completion requires an explicit preflight refresh and never auto-approves execution.

### Identity-only summary consolidation — 2026-10-03

Duplicate TV summaries consolidate only when persisted TMDB/TVDB identity evidence agrees within the same source and library. Scoped unresolved identity keys may consolidate only with the identical key and owner. Same-title rows without a shared identity remain separate; mismatched provider identities, user-fixed matches, and locked identity records are preserved and counted. Episode ownership is rechecked by exact source, library, and current identity inside the backup-backed cleanup transaction.
