# Totality — Architectural Reference & Invariants Projection

> [!NOTE]
> **Operational Authority**: Mutable operational status and active project tracking reside exclusively in **Command Center**. This document is an implementation-local architectural reference and invariant projection.

## Implementation Reference & Core Invariants Enforced
- **Single TV Show Identity Invariant (TOT-BUG-03)**: Every TV show within a given library scope (`source_id`, `library_id`) maps to exactly one canonical `series_completeness` record. Unique indexes on `series_identity_key`, `tvdb_id`, and `tmdb_id` guarantee no duplicate stubs or split episode records.
- **Safe Operational Vertical Slice (Track A)**: Strict 6-stage lifecycle (`ReadOnlyInventory` -> `ProposedAction` -> `DryRun` -> `RecoverabilityProof` -> `BoundedOptimization` -> `AuditLog`) with zero software/GPU fallbacks.
- **Dolby Vision & Codec Ranking**: Transcoder pipelines prioritize hardware-accelerated NVENC/QSV zero-copy encode strategies with Dolby Vision Profile 5 MKV container preservation.
- **Relational Integrity**: Locked matches in `media_identities` and `media_aliases` are maintained during metadata refresh and deduplication merges.
- **Additive History**: All development logs in `dev_docs/` are strictly additive.
