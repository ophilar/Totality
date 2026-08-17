# Full TV Show Optimization & UI Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate sluggishness in the optimization UI, provide a prominent 1-click "Optimize Series" button in TV Show Details with a modern transcode modal, and fix UI/UX layout, overlap, and z-index issues.

**Architecture:** 
1. Throttled/debounced IPC parameter resolution and memoized recommendation fetching to keep the optimization UI instantaneous and stutter-free.
2. Direct integration of `preflightShow` + `queueShow` into `TVShowDetails` and `TVShowsView`, backed by a redesigned glassmorphic `ShowTranscodeModal`.
3. Standardized z-index layers (`z-250`), elevated dropdown containment (`z-30`), and streamlined scroll viewport layouts in `TVShowDetails`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Lucide Icons, React Virtuoso, Electron IPC, FFmpeg/AV1/HEVC Hardware Transcoding Subsystem, Vitest.

---

## Global Constraints
- Strictly adhere to the Universal Project Constitution (`H:\.standards\constitutions\universal.md`).
- Use `pwsh` on Windows 11; do not use forbidden Unix-only commands in shell scripts.
- Code changes must be surgical and verified by unit tests.
- Maintain additive documentation in `dev_docs/`.

---

### Task 1: Optimization UI Performance & Stutter Reduction

**Files:**
- Modify: `src/renderer/src/components/library/TranscodeModal.tsx`
- Modify: `src/renderer/src/components/library/ConversionRecommendation.tsx`
- Modify: `src/renderer/src/components/library/transcoding/LiveEncodingTab.tsx`
- Test: `tests/unit/TranscodingServiceReal.test.ts`

**Interfaces:**
- `window.electronAPI.getParameters(mediaItemId, options)`
- `window.electronAPI.optimizationGetDecision(mediaItemId)`

- [ ] **Step 1: Add abort-token sequence tracking to TranscodeModal parameter previews**
In `src/renderer/src/components/library/TranscodeModal.tsx`, track in-flight parameter queries using an incremental request token ref to discard outdated asynchronous responses when options change rapidly.

- [ ] **Step 2: Throttle live progress log rendering in LiveEncodingTab**
In `src/renderer/src/components/library/transcoding/LiveEncodingTab.tsx`, throttle appending `[PROGRESS]` entries during fast encoding ticks (1Hz max frequency) while leaving real-time percent/FPS meters reactive.

- [ ] **Step 3: Add caching & deduplication to ConversionRecommendation**
In `src/renderer/src/components/library/ConversionRecommendation.tsx`, memoize active decision state and avoid re-requesting decisions for unchanged media item IDs.

- [ ] **Step 4: Run unit tests to verify parameter fetching integrity**
Run: `npx vitest run tests/unit/TranscodingServiceReal.test.ts`
Expected: PASS

---

### Task 2: Visible "Optimize Series" Button in TV Show Details & Upgraded ShowTranscodeModal

**Files:**
- Modify: `src/renderer/src/components/library/tv/TVShowDetails.tsx`
- Modify: `src/renderer/src/components/library/TVShowsView.tsx`
- Modify: `src/renderer/src/components/library/ShowTranscodeModal.tsx`
- Create/Modify: `tests/unit/TVShowOptimizationFlow.test.tsx`

**Interfaces:**
- `onTranscodeShow?: (show: TVShowSummary) => void`
- `window.electronAPI.preflightShow(request: ShowTranscodeRequest)`
- `window.electronAPI.queueShow(preflightId: string)`

- [ ] **Step 1: Add "Optimize Series" action button to TVShowDetails header**
In `src/renderer/src/components/library/tv/TVShowDetails.tsx`:
Add an `onTranscodeShow?: () => void` prop and render a prominent button:
```tsx
<button
  onClick={onTranscodeShow}
  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 rounded-md font-semibold transition-colors cursor-pointer"
  title="Optimize entire TV series with hardware transcoding"
>
  <Zap className="w-3.5 h-3.5 text-primary fill-current" />
  Optimize Series
</button>
```

- [ ] **Step 2: Connect TVShowsView to handle onTranscodeShow in selectedShow view**
In `src/renderer/src/components/library/TVShowsView.tsx`:
Ensure `selectedShow` detail rendering passes `onTranscodeShow={() => selectedShowData && onTranscodeShow?.({ series_title: selectedShowData.title, source_id: selectedShowData.seasons.values().next().value?.episodes[0]?.source_id || '' } as TVShowSummary)}` and manages the `ShowTranscodeModal` visibility state.

- [ ] **Step 3: Modernize ShowTranscodeModal UI with glassmorphic cards and progress state**
In `src/renderer/src/components/library/ShowTranscodeModal.tsx`:
- Upgrade modal container to match Totality's `z-250` backdrop blur aesthetic.
- Add preset profile pills (e.g. Balanced AV1 / Lossless HEVC / High Efficiency).
- Add clear summary of target audio tracks and quarantine replacement mode.
- Render dynamic preflight progress and episode checklist before batch queuing.

- [ ] **Step 4: Write unit test for TVShowDetails optimize button rendering and click handler**
In `tests/unit/TVShowOptimizationFlow.test.tsx`, verify that the button renders and triggers `onTranscodeShow`.

- [ ] **Step 5: Run tests to verify implementation**
Run: `npx vitest run tests/unit/TVShowOptimizationFlow.test.tsx`
Expected: PASS

---

### Task 3: UI/UX Audit Fixes — Z-Index, Overlaps, and Scroll Layout

**Files:**
- Modify: `src/renderer/src/components/library/tv/EpisodeRow.tsx`
- Modify: `src/renderer/src/components/library/tv/TVShowDetails.tsx`
- Modify: `src/renderer/src/components/timelines/TimelinesView.tsx`

- [ ] **Step 1: Fix EpisodeRow dropdown clipping**
In `src/renderer/src/components/library/tv/EpisodeRow.tsx`:
Set dropdown menu wrapper to `z-30` with `relative` container positioning to ensure 3-dot menus open cleanly above adjacent rows and below modal overlays.

- [ ] **Step 2: Streamline TVShowDetails Virtuoso scroll container**
In `src/renderer/src/components/library/tv/TVShowDetails.tsx`:
Replace fixed height constraints on Virtuoso with flexible height handling (`useWindowScroll` or dedicated full-height flex container) to avoid double scrollbars.

- [ ] **Step 3: Standardize modal overlay z-indexes**
Ensure all application modals (`ShowTranscodeModal`, `TranscodeModal`, `CollectionModal`, `MatchFixModal`) consistently use `z-250`.

- [ ] **Step 4: Run full vitest suite to ensure no regressions**
Run: `npx vitest run`
Expected: All test files pass.

---

### Task 4: Documentation & Work Log Update

**Files:**
- Modify: `dev_docs/totality_work_log_20260817.md`
- Modify: `dev_docs/totality_roadmap.md`

- [ ] **Step 1: Append changes to work log and update roadmap**
Record all optimizations, TV show batch button additions, and UI/UX fixes in accordance with Universal Project Constitution.
