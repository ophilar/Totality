# TRaSH Guides Alignment, Smart Advisory & Lossless Stream Remuxing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement TRaSH Guides-aligned source classification, smart optimization advisory, user-overridable lossless stream remuxing (`-c:v copy`), and independent subtitle language preferences to prevent file size inflation and eliminate container bloat.

**Architecture:** 
- A single source of truth `TrashSourceClassifier` to identify media release types (`Remux`, `BluRay`, `WEB-DL`, etc.).
- `QualityAnalyzer` generates TRaSH-aligned actionable optimization recommendations (`video_transcode`, `stream_pruning`, `already_optimized`).
- `StreamRemuxCommandBuilder` implements fast container stream copy (`-c:v copy`) dropping bloated secondary audio dubs and non-whitelisted subtitles without touching video frames.
- Global configurable subtitle language whitelist independent of audio language.
- Update Star Trek timeline with Strange New Worlds Seasons 3 & 4.

**Tech Stack:** TypeScript, Node.js, Electron, FFmpeg, Better-SQLite3, Vitest, React, TailwindCSS.

## Global Constraints
- Avoid fallbacks, failsafes, silent errors, mocks, fakes, bypasses, cheats, duplicates, redundancies, defaults, hardcodes, thin wrappers.
- Use design patterns for SOLID code; reuse existing code and APIs.
- Additive updates to `dev_docs/` work log, roadmap, and design per universal constitution.

---

### Task 1: Star Trek SNW Seasons 3 & 4 Timelines

**Files:**
- Modify: `src/main/services/timelines/bundledRecipes.ts`
- Test: `tests/unit/services/timelines/TimelineRecipeProviders.test.ts`

**Interfaces:**
- Produces: Updated Star Trek timeline items including Strange New Worlds Seasons 3 (10 eps) and 4 (10 eps).

- [ ] **Step 1: Write the failing test / updated test assertion**

```typescript
// tests/unit/services/timelines/TimelineRecipeProviders.test.ts
// Verify SNW Seasons 3 & 4 items exist in Star Trek chronology
const snwS3 = items.find(i => i.title.includes('Strange New Worlds') && i.seasonNumber === 3)
expect(snwS3).toBeDefined()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/timelines/TimelineRecipeProviders.test.ts`
Expected: FAIL (SNW S3 not found)

- [ ] **Step 3: Update `bundledRecipes.ts`**

Add SNW Seasons 3 and 4 ranges to `STAR_TREK_CHRONO_ITEMS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/timelines/TimelineRecipeProviders.test.ts`
Expected: PASS

---

### Task 2: TRaSH Source Classifier (`TrashSourceClassifier.ts`)

**Files:**
- Create: `src/main/services/transcoding/TrashSourceClassifier.ts`
- Test: `tests/unit/services/transcoding/TrashSourceClassifier.test.ts`

**Interfaces:**
- Produces: `export type MediaSourceTier = 'Remux' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'SDTV' | 'Unknown'`
- Produces: `export class TrashSourceClassifier { static classify(filePath: string, videoBitrateKbps?: number, codec?: string): MediaSourceTier }`

- [ ] **Step 1: Write the failing unit tests**

Create comprehensive test suite testing release tag parsing, bitrate patterns, and edge cases.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/transcoding/TrashSourceClassifier.test.ts`
Expected: FAIL (`TrashSourceClassifier` not found)

- [ ] **Step 3: Implement `TrashSourceClassifier.ts`**

Implement deterministic regex patterns and stream heuristic scoring matching TRaSH Guides specifications.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/transcoding/TrashSourceClassifier.test.ts`
Expected: PASS

---

### Task 3: Stream Remux Command Builder (`StreamRemuxCommandBuilder.ts`)

**Files:**
- Create: `src/main/services/transcoding/StreamRemuxCommandBuilder.ts`
- Modify: `src/main/services/transcoding/TranscodeCommandFactory.ts`
- Test: `tests/unit/services/transcoding/StreamRemuxCommandBuilder.test.ts`

**Interfaces:**
- Produces: `export class StreamRemuxCommandBuilder implements ITranscodeCommandBuilder`
- Generates FFmpeg arguments with `-c:v copy`, mapping selected audio streams and whitelisted subtitle streams.

- [ ] **Step 1: Write failing unit test for `StreamRemuxCommandBuilder`**

Test that video stream is mapped with `-c:v copy` and audio/subtitle tracks follow the stream selection plan without transcoding video.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/transcoding/StreamRemuxCommandBuilder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `StreamRemuxCommandBuilder.ts` and register in `TranscodeCommandFactory.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/transcoding/StreamRemuxCommandBuilder.test.ts`
Expected: PASS

---

### Task 4: Subtitle Whitelist & Stream Selection Policy Enhancement

**Files:**
- Modify: `src/main/services/transcoding/StreamSelectionPlan.ts`
- Test: `tests/unit/services/transcoding/StreamSelectionPlan.test.ts`

**Interfaces:**
- Consumes: `StreamSelectionPolicy.subtitleLanguageWhitelist?: string[]`
- Produces: Audio tracks mapped by original language/preference and subtitle tracks filtered strictly by the configured subtitle whitelist independent of audio track language.

- [ ] **Step 1: Write failing test for independent subtitle language whitelist**

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/transcoding/StreamSelectionPlan.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `StreamSelectionPlan.ts` to implement independent subtitle whitelist filtering**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/transcoding/StreamSelectionPlan.test.ts`
Expected: PASS

---

### Task 5: TRaSH-Aligned Quality Advisory in `QualityAnalyzer.ts`

**Files:**
- Modify: `src/main/services/QualityAnalyzer.ts`
- Test: `tests/unit/services/QualityAnalyzer.test.ts`

**Interfaces:**
- Produces: `OptimizationAdvice: { action: 'video_transcode' | 'stream_pruning' | 'already_optimized', reason: string, estimatedSavingsBytes: number }`

- [ ] **Step 1: Write failing tests for TRaSH quality advisory**

Test that low-bitrate WEB-DLs with dubs receive `stream_pruning`, already compact HEVC receives `already_optimized`, and high-bitrate AVC Remux receives `video_transcode`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/QualityAnalyzer.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `QualityAnalyzer.ts` with TRaSH optimization advisory logic**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/QualityAnalyzer.test.ts`
Expected: PASS

---

### Task 6: Transcoding Service & Preflight Optimization Modes

**Files:**
- Modify: `src/main/services/TranscodingService.ts`
- Test: `tests/unit/services/TranscodingService.test.ts`

**Interfaces:**
- Consumes: `TranscodeOptions.optimizationMode?: 'smart' | 'remux_only' | 'transcode'`
- Produces: Preflight checks returning recommended action, allowing explicit user override.

- [ ] **Step 1: Write failing tests for optimization modes and user override in `TranscodingService`**

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/TranscodingService.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `TranscodingService.ts` to route commands to `StreamRemuxCommandBuilder` or `NvidiaCommandBuilder` based on mode and override**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/TranscodingService.test.ts`
Expected: PASS

---

### Task 7: UI Controls for TRaSH Advice, Optimization Modes & Subtitle Whitelist

**Files:**
- Modify: `src/renderer/src/components/library/ShowTranscodeModal.tsx`
- Modify: `src/renderer/src/components/settings/SettingsGeneral.tsx` or Transcoding settings
- Test: Run typecheck and component checks

**Interfaces:**
- UI presents:
  1. TRaSH Advice Badge (`Transcode Recommended`, `Stream Pruning (Copy Video)`, `Already Optimized`).
  2. Optimization Mode radio selector (`Smart (TRaSH)`, `Audio/Subs Pruning Only`, `Full Transcode Override`).
  3. Subtitle language whitelist preference input.

- [ ] **Step 1: Update UI components with optimization mode selector and subtitle preferences**

- [ ] **Step 2: Typecheck with `tsc --noEmit`**

---

### Task 8: Full Regression Suite & Documentation

**Files:**
- Modify: `dev_docs/totality_work_log_20260827.md`
- Modify: `dev_docs/totality_roadmap.md`
- Modify: `dev_docs/totality_design.md`

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: 100% tests pass (144+ test files)

- [ ] **Step 2: Additive documentation updates per universal constitution**
