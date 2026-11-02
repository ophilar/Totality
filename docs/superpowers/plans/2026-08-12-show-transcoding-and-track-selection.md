# Show Transcoding and Track Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user queue every local episode in a TV show with one reviewed transcoding configuration, while retaining explicitly selected audio and subtitle streams and setting one subtitle stream as the output default.

**Architecture:** Make `StreamSelectionPlan` the single authoritative mapping contract used by all FFmpeg builders. The main process derives and validates that plan from FFprobe stream indices, exposes the same inventory in the modal, and enqueues one existing `TaskType.Transcode` task per episode through `TaskQueueService`; it does not create a parallel batch worker.

**Tech Stack:** TypeScript, Electron IPC, React, Zod, FFmpeg, Drizzle/libSQL, Vitest.

## Global Constraints

- The default is lossless track treatment: copy every detected audio and subtitle stream.
- Stream selection is by FFprobe stream index, never by array position or a language guess.
- A requested stream that is absent, duplicated, or not of the requested type is a validation error; it is never silently substituted.
- “No default subtitle” clears all subtitle default dispositions; “preserve” leaves dispositions untouched; a selected source stream becomes the sole output default.
- Dynamic HDR formats (HDR10+, Dolby Vision, HLG) remain blocked for video re-encoding; HDR10 preserves validated static metadata; output labels describe the source format only.
- Use CFR, reflecting the verified VLC/TV playback result; the older passthrough documentation is historical and must not be reintroduced.
- Batch operations only target authorized, local episode paths and use the existing serialized durable task queue.

---

### Task 1: Authoritative stream-selection planner

**Files:**
- Create: `src/main/services/transcoding/StreamSelectionPlan.ts`
- Modify: `src/main/services/TranscodingService.ts`
- Modify: `src/main/services/transcoding/NvidiaCommandBuilder.ts`
- Modify: `src/main/services/transcoding/IntelCommandBuilder.ts`
- Modify: `src/main/services/transcoding/SoftwareCommandBuilder.ts`
- Test: `tests/unit/services/StreamSelectionPlan.test.ts`
- Test: `tests/unit/services/TranscodingBuilders.test.ts`

**Interfaces:**
- Produces `buildStreamSelectionPlan(analysis, options): StreamSelectionPlan`.
- `StreamSelectionPlan` contains `audioStreamIndexes`, `subtitleStreamIndexes`, and `defaultSubtitle: 'preserve' | 'none' | number`.
- `TranscodeOptions` adds optional `audioStreamIndexes`, `subtitleStreamIndexes`, and `defaultSubtitleStreamIndex` where `undefined` preserves the corresponding full source inventory and `null` clears the subtitle default.

- [ ] **Step 1: Write failing planner tests**

```ts
it('copies every detected audio and subtitle stream by default', () => {
  expect(buildStreamSelectionPlan(analysis, {})).toEqual({
    audioStreamIndexes: [1, 2], subtitleStreamIndexes: [3, 4], defaultSubtitle: 'preserve'
  })
})

it('sets one selected subtitle as the sole output default', () => {
  expect(buildStreamSelectionPlan(analysis, { subtitleStreamIndexes: [3, 4], defaultSubtitleStreamIndex: 4 }).defaultSubtitle).toBe(4)
})

it('rejects a requested stream that does not exist in the analyzed inventory', () => {
  expect(() => buildStreamSelectionPlan(analysis, { audioStreamIndexes: [99] })).toThrow('Audio stream 99 is not available')
})
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run tests/unit/services/StreamSelectionPlan.test.ts`

Expected: FAIL because `StreamSelectionPlan` does not exist.

- [ ] **Step 3: Implement the planner and builder integration**

```ts
export function buildStreamSelectionPlan(analysis: FileAnalysisResult, options: TranscodeOptions): StreamSelectionPlan {
  const audioStreamIndexes = selectIndexes(analysis.audioTracks, options.audioStreamIndexes, 'Audio')
  const subtitleStreamIndexes = selectIndexes(analysis.subtitleTracks, options.subtitleStreamIndexes, 'Subtitle')
  const defaultSubtitle = resolveDefaultSubtitle(subtitleStreamIndexes, options.defaultSubtitleStreamIndex)
  return { audioStreamIndexes, subtitleStreamIndexes, defaultSubtitle }
}
```

Every builder appends `-map 0:v:<first-video-index>`, `-map 0:<stream-index>` for each planned audio/subtitle stream, `-c:a copy`, and `-c:s copy`. When a default is selected, clear every output subtitle disposition and set `-disposition:s:<output-index> default`; for `null`, clear every output subtitle default disposition.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/unit/services/StreamSelectionPlan.test.ts tests/unit/services/TranscodingBuilders.test.ts; npx tsc --noEmit`

Expected: PASS.

### Task 2: Validated IPC and parameter inventory

**Files:**
- Modify: `src/main/validation/schemas.ts`
- Modify: `src/main/ipc/transcoding.ts`
- Modify: `src/preload/api/transcoding.ts`
- Modify: `src/main/services/TranscodingService.ts`
- Modify: `src/renderer/src/components/library/transcoding/types.ts`
- Test: `tests/unit/services/TranscodingService.test.ts`

**Interfaces:**
- `TranscodingParams` adds `audioTracks`, `subtitleTracks`, and `sourceHdrFormat` for the modal preview.
- `TranscodeOptionsSchema` accepts only non-negative unique stream indices and a nullable default subtitle index.

- [ ] **Step 1: Write failing validation/service tests**

```ts
expect(() => TranscodeOptionsSchema.parse({ audioStreamIndexes: [1, 1] })).toThrow('unique')
await expect(service.getTranscodeParameters(file, { subtitleStreamIndexes: [2], defaultSubtitleStreamIndex: 3 })).rejects.toThrow('Subtitle stream 3 is not selected')
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run tests/unit/services/TranscodingService.test.ts`

Expected: FAIL because the schema and parameter inventory are absent.

- [ ] **Step 3: Implement the boundary contract**

Expose only FFprobe-derived stream descriptors `{ index, language, title, codec, isDefault, isForced }`, pass validated options unchanged to the service, and return the source HDR label through `hdrLabel(analysis)`. Do not parse renderer-supplied language names into stream maps.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/unit/services/TranscodingService.test.ts; npx tsc --noEmit`

Expected: PASS.

### Task 3: Track-selection and subtitle-default controls

**Files:**
- Modify: `src/renderer/src/components/library/TranscodeModal.tsx`
- Modify: `src/renderer/src/components/library/transcoding/AdvancedTab.tsx`
- Modify: `src/renderer/src/components/library/transcoding/types.ts`
- Test: `tests/unit/TranscodeModal.test.tsx` (or the existing renderer test location if one is present)

**Interfaces:**
- `AdvancedTab` consumes preview track inventories and updates stream-index options.
- Default UI state leaves index arrays undefined, meaning “copy all”; changing a checkbox makes an explicit selection.

- [ ] **Step 1: Write a failing renderer test**

```tsx
render(<AdvancedTab {...props} params={{ ...params, subtitleTracks: [english, hebrew] }} />)
expect(screen.getByRole('option', { name: /Hebrew.*default/i })).toBeInTheDocument()
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/unit/TranscodeModal.test.tsx`

Expected: FAIL because no default-subtitle selector exists.

- [ ] **Step 3: Implement the controls**

Show compact audio and subtitle checklists populated from `TranscodingParams`. Include “Copy all detected tracks” reset controls and a subtitle-default select with “Preserve source flags”, “No default subtitle”, and selected subtitle streams. Disable a default option for an unchecked subtitle stream and clear a now-invalid selected default when a subtitle is deselected.

- [ ] **Step 4: Run renderer test and typecheck**

Run: `npx vitest run tests/unit/TranscodeModal.test.tsx; npx tsc --noEmit`

Expected: PASS.

### Task 4: Show-level queue API

**Files:**
- Modify: `src/main/services/TranscodingService.ts`
- Modify: `src/main/ipc/transcoding.ts`
- Modify: `src/main/validation/schemas.ts`
- Modify: `src/preload/api/transcoding.ts`
- Test: `tests/unit/services/TranscodingService.test.ts`

**Interfaces:**
- Produces `queueShowTranscode(seriesTitle: string, sourceId: string, options): Promise<{ queuedMediaItemIds: number[] }>`.
- Adds `transcoding:queueShow` IPC with tuple input `[seriesTitle, sourceId, options]`.

- [ ] **Step 1: Write a failing show-queue test**

```ts
await expect(service.queueShowTranscode('Example', 'source-1', options)).resolves.toEqual({ queuedMediaItemIds: [11, 12] })
expect(queue.addTasks).toHaveBeenCalledWith(expect.arrayContaining([
  expect.objectContaining({ type: TaskType.Transcode, mediaItemId: 11 })
]))
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/unit/services/TranscodingService.test.ts`

Expected: FAIL because show queueing does not exist.

- [ ] **Step 3: Implement authorized queue creation**

Load ordered episodes using `TVShowRepository.getEpisodes(seriesTitle, sourceId)`. Reject an empty show and validate every episode path with the same `MediaPathAuthorization` logic used by single-item IPC before calling `TaskQueueService.addTasks`. Build tasks in season/episode order with labels including show, season, and episode. Return all IDs only after `addTasks` succeeds.

- [ ] **Step 4: Run service tests and typecheck**

Run: `npx vitest run tests/unit/services/TranscodingService.test.ts; npx tsc --noEmit`

Expected: PASS.

### Task 5: TV-show action and end-to-end verification

**Files:**
- Modify: `src/renderer/src/components/library/TVShowsView.tsx`
- Modify: `src/renderer/src/components/library/tv/ShowCard.tsx`
- Modify: `src/renderer/src/components/library/TranscodeModal.tsx`
- Test: relevant renderer test(s)

- [ ] **Step 1: Write a failing UI test**

```tsx
render(<ShowCard show={show} onQueueTranscode={() => {}} {...props} />)
expect(screen.getByText('Transcode full show')).toBeInTheDocument()
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/unit/ShowCard.test.tsx`

Expected: FAIL because the show menu has no full-show action.

- [ ] **Step 3: Implement the reviewed batch entry point**

Add “Transcode full show” to the show action menu. Open the existing modal in show mode, display episode count, queue all episodes through `queueShow`, and make the completion toast state that tasks were queued (not completed). Keep single-item start behavior unchanged.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/services/StreamSelectionPlan.test.ts tests/unit/services/TranscodingBuilders.test.ts tests/unit/services/TranscodingService.test.ts; npx tsc --noEmit; npm run build`

Expected: focused tests and TypeScript pass. Packaging is only complete if Electron runtime acquisition is available; otherwise report the exact network failure separately.

