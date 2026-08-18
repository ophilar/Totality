# Totality — Active Project

## Project Status: Active & Maintained
- **Version**: `0.4.4`
- **Quality Gates**: Fully Typechecked & Test-Verified
- **TV Show Invariant (TOT-BUG-03)**: `[test-verified]`

### Core Invariants Enforced
- **Single TV Show Identity Invariant (TOT-BUG-03)**: Every TV show within a given library scope (`source_id`, `library_id`) maps to exactly one canonical `series_completeness` record. Unique indexes on `series_identity_key`, `tvdb_id`, and `tmdb_id` guarantee no duplicate stubs or split episode records.
- **Dolby Vision & Codec Ranking**: Transcoder pipelines prioritize hardware-accelerated NVENC/QSV zero-copy encode strategies with Dolby Vision Profile 5 MKV container preservation.
- **Relational Integrity**: Locked matches in `media_identities` and `media_aliases` are maintained during metadata refresh and deduplication merges.
- **Additive History**: All development logs in `dev_docs/` are strictly additive.
