# Repair Database Summaries, Analysis, and Individual Optimization

## User stories

- As a library owner, I can see accurate analysis progress and errors, and the app preserves completed work when one media file fails.
- As a movie or episode owner, I can open optimization controls regardless of the recommendation and review measured, source-specific operations before the app changes a file.
- As a library owner, I can trust that series summaries reflect the current scanned episode identities, with user-locked matches preserved.

## Functional requirements

1. Parse FFprobe packet output by named fields, with explicit handling for section delimiters, absent sizes, chunk boundaries, malformed values, and integer overflow.
2. Use canonical video codec normalization when applying configured efficiency coefficients. Unsupported codecs remain unscored.
3. Persist measured stream byte evidence and its evidence/savings basis through the existing quality score authority. Keep estimates distinct from measurements.
4. Expose failed/partial task counts, item, stage, and diagnostic to users. Successful independent stages must not mask a failed stage.
5. Scope TV filtering and aggregation to the selected source and library, qualify joined columns, and reconcile stale unlocked series summaries only after a complete successful scan.
6. Back up the live SQLite database through app-owned SQLite backup behavior before transactional reconciliation. Re-evaluate current source/library/identity candidates at repair time. Preserve locked matches and identity ownership.
7. Make per-item Optimize available for media with a file path. Route item and show requests through one typed preflight, review/approval, and queue contract. Require measured candidate review for video encoding; validate explicit stream selection; reject no-op plans.
8. Refresh obsolete movie-only TMDB timeline recipes from their authoritative provider without guessing order or deleting unrelated caches.
9. Surface provider and hardware limitations as item-scoped outcomes without fabricating matches or successful results.

## Success criteria

- Production FFprobe packet examples with trailing delimiters parse correctly; malformed values fail with a precise diagnostic.
- Complete analyses and scores preceding a failed file remain readable after restart. The task reports partial/failed status with correct counts.
- H.264 media receives a configured score; unconfigured codecs stay explicitly unknown.
- TV list, count, and aggregates return correctly for each library and initial letter. Reconciliation removes only verified unlocked orphan summaries and preserves locked or ambiguous records.
- Movies and episodes open Optimize when assessed actionable, sample-required, already optimized, or insufficient; execution still passes measured review, source freshness, compatibility, output verification, and activation checks.
- Collection 404, missing track metadata, unsupported encoder, and exhausted MusicBrainz requests remain visible and never appear as successful completeness results.
- Full tests and Windows package build pass; live database changes occur only via the application after SQLite backup and verified scan.

## Constraints

- Preserve the existing uncommitted dependency changes.
- Work on `fix/analysis-optimization-db`.
- Do not invent codec coefficients, merge by title alone, infer timeline ordering, or add compatibility routes and duplicate storage.
- Keep `dev_docs/` history additive.
