### Task 1: Optimization UI Performance & Stutter Reduction

**Files:**
- Modify: `src/renderer/src/components/library/TranscodeModal.tsx`
- Modify: `src/renderer/src/components/library/ConversionRecommendation.tsx`
- Modify: `src/renderer/src/components/library/transcoding/LiveEncodingTab.tsx`
- Test: `tests/unit/TranscodingServiceReal.test.ts`

**Interfaces:**
- `window.electronAPI.getParameters(mediaItemId, options)`
- `window.electronAPI.optimizationGetDecision(mediaItemId)`

**Global Constraints:**
- Adhere to the Universal Project Constitution.
- Prefer replace for surgical edits; avoid full rewrites.
- Ensure all tests pass.

- [ ] **Step 1: Add abort-token sequence tracking to TranscodeModal parameter previews**
In `src/renderer/src/components/library/TranscodeModal.tsx`, track in-flight parameter queries using an incremental request token ref to discard outdated asynchronous responses when options change rapidly.
- [ ] **Step 2: Throttle live progress log rendering in LiveEncodingTab**
In `src/renderer/src/components/library/transcoding/LiveEncodingTab.tsx`, throttle appending `[PROGRESS]` entries during fast encoding ticks (1Hz max frequency) while leaving real-time percent/FPS meters reactive.
- [ ] **Step 3: Add caching & deduplication to ConversionRecommendation**
In `src/renderer/src/components/library/ConversionRecommendation.tsx`, memoize active decision state and avoid re-requesting decisions for unchanged media item IDs.
- [ ] **Step 4: Run unit tests to verify parameter fetching integrity**
Run: `npx vitest run tests/unit/TranscodingServiceReal.test.ts`
Expected: PASS
