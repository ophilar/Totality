# Test, dependency, and log maintenance

## User stories
- Users can filter TV shows by initial letter without a database error.
- Maintainers run distinct tests once and use current compatible stable dependencies.

## Functional requirements
- Qualify joined filter columns through the existing schema.
- Consolidate duplicate stream-selection tests while retaining missing-language coverage.
- Upgrade dependencies within verified peer constraints; report incompatible newer majors.
- Distinguish external provider/hardware warnings from application defects in the supplied log.

## Success criteria
- Real database tests cover letter and nonletter filters in joined summaries and counts.
- Final typecheck, complete tests, and packaged build pass.
- No user media, database, or playlists are modified during validation.
