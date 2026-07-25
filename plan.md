1. **Remove unused state variables**: `scanningLibrary`, `scanningLibraryType`, `scanPhase` and `analysisProgress`.
   - Remove lines where they are initialized using `useState`.
   - Remove comments about them being reserved for future use.

2. **Remove usages of `scanningLibraryId`, `scanPhase`, and `analysisProgress` in `SourceItem`**.
   - These are passed down from `Sidebar` to `SourceItem`, but they are derived from the dead state variables.
   - `getScanningLibraryId` becomes obsolete and can be removed.
   - We will remove `scanningLibraryId`, `scanPhase`, and `analysisProgress` props from `SourceItemProps` and `SourceItem` component.

3. **Update `handleStopScan`**:
   - `scanningLibrary` and `scanningLibraryType` were used to check if the scan was a music scan to call `musicCancelScan`. But they are always null. Wait, how do we stop a music scan?
   - Wait, `onStopScan` is called from the UI, but because we are removing `scanningLibrary`, this condition `if (scanningLibrary && scanningLibraryType === 'music')` is always false, which it already was.
   - Wait, `onStopScan` in `SourceItem` UI is only rendered when `!isQueueScanning && isScanning`.
   - Is `isScanning` ever true without `scanningLibraryId`?
   - Let's check: `const isScanning = scanningLibraryId === library.id`. If `scanningLibraryId` is removed, then `isScanning` would always be false.
   - Thus, the block `{isScanning && !isQueueScanning && ( ... )}` would never be rendered.
   - This entire block `942-999` is dead code! It corresponds to manual scans.
   - Let's check `isScanning` usage. It's used in `const showScanningUI = isScanning || isQueueScanning`. If `isScanning` is removed, then `showScanningUI = isQueueScanning`.

4. **Verify if `isScanning` (manual scans) logic can be entirely removed**:
   - Yes, the code comment says: `Show scanning UI for manual scans (original code)`. The new way seems to be Task Queue scans! Wait, is that true?
   - Look at `const showScanningUI = isScanning || isQueueScanning`. The task queue replaced the older manual scan state tracking, which is why those variables were set as "reserved for future use" (they probably got decoupled when `taskQueueState` was introduced, or their usage was moved to global state `scanProgress` and `musicScanProgress`).
   - Wait, `progress` comes from `scanProgress.get(source.source_id) || musicScanProgress.get(source.source_id)`.
   - `progress` is still passed to `SourceItem`!

Let's look at `SourceItem` again:
