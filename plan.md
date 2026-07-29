1. Add `upsertTracks` method to `MusicRepository` that batches multiple tracks in a single transaction/Promise.all.
2. Update `KodiProvider.ts` to use `upsertTracks` and resolve the N+1 query issue.
3. Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.
4. Verify the performance optimization and submit.
