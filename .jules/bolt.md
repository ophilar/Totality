## 2024-04-05 - N+1 Music Track Queries Fixed
**Learning:** The BetterSQLiteService acts as a facade, and repository methods must be explicitly exposed. A duck-typing check (`in db`) for `getMusicTracksByAlbumIds` failed silently because it was not exposed on the facade, resulting in a fallback to N+1 queries.
**Action:** Always ensure repository methods intended for batch operations are explicitly added to the `BetterSQLiteService` facade.
