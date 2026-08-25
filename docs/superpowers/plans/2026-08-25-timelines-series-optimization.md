# Timelines UI, Series Disambiguation & Infill, and Real Dry Run Calculations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a responsive two-column master-detail Timelines view, rich series match disambiguation indicators, automated non-destructive metadata infill during series analysis, verified real-math dry run optimization calculations, and file-aware audio language detection with provider defaults.

**Architecture:** 
- UI layer splits `TimelinesView.tsx` into a searchable master column and focused detail pane with live Plex playlist sync.
- Disambiguation flow enhances `MatchFixModal.tsx` with air dates, networks, countries, status, external ID links, and expandable synopses.
- Backend engine in `SeriesCompletenessService.ts` backfills missing episode titles, air dates, overviews, season art, and external IDs into SQLite.
- `ShowOptimizationMetricsService.ts` and `optimization.ts` compute exact byte savings using FFprobe stream bitrates and durations.
- Preload and UI query embedded audio tags to populate language options, defaulting to provider original language.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Lucide React, Electron IPC, Better-SQLite3, Drizzle ORM, Vitest.

## Global Constraints
- Target branch is `master`.
- No mocks, cheats, fakes, or silent error suppression. All calculations must use exact math against actual media stream data.
- Maintain documentation integrity and additive logs in `dev_docs/`.
- Adhere strictly to Universal Project Constitution: zero Linux-only commands in Windows pwsh.

---

### Task 1: Timelines Split Two-Column Master-Detail Layout

**Files:**
- Modify: `src/renderer/src/components/timelines/TimelinesView.tsx`
- Test: `tests/unit/components/TimelinesViewLayout.test.tsx`

**Interfaces:**
- Consumes: `electronAPI.timelinesListRecipes`, `electronAPI.timelinesResolveTimeline`, `electronAPI.timelinesSyncPlexPlaylist`
- Produces: Two-column master-detail layout (`flex flex-row h-full overflow-hidden`) with searchable recipe sidebar and focused timeline details.

- [ ] **Step 1: Write the failing layout and interaction test**

```tsx
// tests/unit/components/TimelinesViewLayout.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TimelinesView } from '@/components/timelines/TimelinesView'
import { SourceContext } from '@/contexts/SourceContext'
import { ToastContext } from '@/contexts/ToastContext'

describe('TimelinesView Master-Detail Layout', () => {
  it('renders sidebar recipe list and switches active timeline on item click', async () => {
    // Test assertion for master-detail structure and sidebar recipe selection
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/TimelinesViewLayout.test.tsx`
Expected: FAIL (sidebar selector elements not found in old grid layout)

- [ ] **Step 3: Refactor TimelinesView.tsx to Two-Column Split Pane**

Refactor `src/renderer/src/components/timelines/TimelinesView.tsx`:
- Container: `flex flex-row h-full overflow-hidden bg-background text-foreground`.
- Left Sidebar (`w-80 sm:w-88 border-r border-border flex flex-col shrink-0 bg-card/30`):
  - Top header with search input filtering recipes by franchise and title.
  - Scrollable recipe list with franchise badge, title, item count, and active ring indicator.
  - Universal Importer form at the bottom/top.
- Right Detail Area (`flex-1 flex flex-col h-full overflow-y-auto`):
  - Focused active timeline title, description, source link, and live web refresh button.
  - Completeness progress bar.
  - Plex playlist selector and 1-click sync control.
  - Filter mode pills (`All`, `Matched`, `Missing`) and search bar.
  - Chronological items table.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/TimelinesViewLayout.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/components/timelines/TimelinesView.tsx tests/unit/components/TimelinesViewLayout.test.tsx
git commit -m "feat(timelines): implement master-detail two-column layout"
```

---

### Task 2: Series Match Disambiguation Indicators in `MatchFixModal`

**Files:**
- Modify: `src/renderer/src/components/library/MatchFixModal.tsx`
- Modify: `src/main/services/metadata/CompositeMetadataProvider.ts`
- Test: `tests/unit/components/MatchFixModalDisambiguation.test.tsx`

**Interfaces:**
- Consumes: `MetadataSearchResult` with network, status, externalIds, country, and overview fields.
- Produces: Enhanced candidate cards showing air year, broadcaster, country, status badge, external IDs (TMDB, TVDB, IMDb), and full plot overview.

- [ ] **Step 1: Write the failing disambiguation rendering test**

```tsx
// tests/unit/components/MatchFixModalDisambiguation.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MatchFixModal } from '@/components/library/MatchFixModal'

describe('MatchFixModal Disambiguation', () => {
  it('renders network, country, status and external IDs for tv show results', () => {
    // Assert presence of network badges and external ID chips
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/MatchFixModalDisambiguation.test.tsx`
Expected: FAIL

- [ ] **Step 3: Update MatchFixModal and Metadata Types with Disambiguation Details**

In `MatchFixModal.tsx`:
- Extend `MetadataSearchResult` with optional `network`, `status`, `country`, `externalIds` (`tmdbId`, `tvdbId`, `imdbId`).
- Render status pill (`Ended`, `Returning Series`), network tag, and external ID chips.
- Add expandable/full synopsis view to candidate items.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/MatchFixModalDisambiguation.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/components/library/MatchFixModal.tsx tests/unit/components/MatchFixModalDisambiguation.test.tsx
git commit -m "feat(library): add rich series disambiguation details in MatchFixModal"
```

---

### Task 3: Automated Missing Metadata Infill During Series Analysis

**Files:**
- Modify: `src/main/services/SeriesCompletenessService.ts`
- Modify: `src/main/database/repositories/TVShowRepository.ts`
- Test: `tests/unit/services/SeriesMetadataInfill.test.ts`

**Interfaces:**
- Consumes: `SeriesCompletenessService.analyzeSeries`, `MetadataRegistryService`, `TMDBService`
- Produces: Database records populated with missing external IDs (`tmdb_id`, `tvdb_id`, `imdb_id`), episode titles, air dates, overviews, and season posters.

- [ ] **Step 1: Write the failing metadata infill unit test**

```typescript
// tests/unit/services/SeriesMetadataInfill.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SeriesCompletenessService } from '@main/services/SeriesCompletenessService'

describe('SeriesCompletenessService Metadata Infill', () => {
  it('backfills missing episode titles, air dates and external IDs without overwriting user locks', async () => {
    // Test that null episode fields get updated from provider response
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/SeriesMetadataInfill.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Non-Destructive Infill in SeriesCompletenessService**

In `SeriesCompletenessService.ts`:
- Check for missing `tmdb_id` or `tvdb_id` in `series_completeness` / `identities` and backfill from provider.
- Inspect local episodes for `title IS NULL`, `air_date IS NULL`, or `overview IS NULL`.
- Batch update incomplete episode records using metadata fetched from TMDB/TVDB.
- Preserve entries with `user_fixed_match = 1` or manual identity locks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/SeriesMetadataInfill.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/main/services/SeriesCompletenessService.ts src/main/database/repositories/TVShowRepository.ts tests/unit/services/SeriesMetadataInfill.test.ts
git commit -m "feat(series): backfill missing episode metadata and external IDs during analysis"
```

---

### Task 4: Real Dry Run Optimization Calculations

**Files:**
- Modify: `src/main/services/ShowOptimizationMetricsService.ts`
- Modify: `src/main/services/LanguageDecisionService.ts`
- Modify: `src/main/ipc/optimization.ts`
- Test: `tests/unit/services/RealDryRunOptimizationCalculations.test.ts`

**Interfaces:**
- Consumes: FFprobe stream metadata (`bit_rate`, `duration`, `tags.NUMBER_OF_BYTES`, `channels`, `codec_name`)
- Produces: `DryRunResult` with verified calculated byte savings, percentage reduction, scored vs unscored breakdown, and stream decision roster.

- [ ] **Step 1: Write failing mathematical calculation test**

```typescript
// tests/unit/services/RealDryRunOptimizationCalculations.test.ts
import { describe, it, expect } from 'vitest'
import { calculateTrackByteSize, aggregateShowOptimizationMetrics } from '@main/services/ShowOptimizationMetricsService'

describe('Real Dry Run Optimization Math', () => {
  it('calculates exact track bytes from stream tags or bitrate * duration', () => {
    // Verify track byte calculation without mocks or heuristics
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/RealDryRunOptimizationCalculations.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Exact Bitrate & Duration Math in ShowOptimizationMetricsService**

In `ShowOptimizationMetricsService.ts` and `optimization.ts`:
- Extract `stream.tags.NUMBER_OF_BYTES` if present.
- Otherwise calculate exact bytes via `(stream.bit_rate * duration) / 8`.
- Sum unwanted stream sizes classified as `remove` by `LanguageDecisionService`.
- Compute total size, recoverable size, percentage savings, and return itemized track decisions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/RealDryRunOptimizationCalculations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/main/services/ShowOptimizationMetricsService.ts src/main/services/LanguageDecisionService.ts src/main/ipc/optimization.ts tests/unit/services/RealDryRunOptimizationCalculations.test.ts
git commit -m "feat(optimization): implement verified real-math dry run calculations"
```

---

### Task 5: File-Aware Audio Language Detection with Provider Defaults

**Files:**
- Modify: `src/main/ipc/media.ts`
- Modify: `src/renderer/src/components/library/ShowTranscodeModal.tsx`
- Modify: `src/renderer/src/components/library/tv/TVShowDetails.tsx`
- Test: `tests/unit/components/FileAwareLanguageSelector.test.tsx`

**Interfaces:**
- Consumes: `electronAPI.mediaGetAudioStreams(mediaItemId)` or episode audio tags.
- Produces: Populated language selector listing actual in-file audio languages, with canonical provider original language pre-selected as `"(Provider Default)"`.

- [ ] **Step 1: Write failing file-aware language selector test**

```tsx
// tests/unit/components/FileAwareLanguageSelector.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ShowTranscodeModal } from '@/components/library/ShowTranscodeModal'

describe('FileAwareLanguageSelector', () => {
  it('displays available audio languages from media files and marks provider default', () => {
    // Assert in-file languages and provider default badge
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/FileAwareLanguageSelector.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement In-File Language Extraction and Provider Default Marking**

- Extract audio languages from episode/show media records in database.
- Format options using `Intl.DisplayNames` (`formatLanguage`).
- Pre-select provider original language (e.g. `ja` for Japanese) labeled with `(Provider Default: Japanese)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/FileAwareLanguageSelector.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/main/ipc/media.ts src/renderer/src/components/library/ShowTranscodeModal.tsx src/renderer/src/components/library/tv/TVShowDetails.tsx tests/unit/components/FileAwareLanguageSelector.test.tsx
git commit -m "feat(language): dynamically populate file audio languages with provider default"
```

---

### Task 6: Full Suite Integration Verification & Typecheck

**Files:**
- Modify: `dev_docs/totality_work_log_20260825.md`
- Test: All tests

- [ ] **Step 1: Run TypeScript compiler across the entire project**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run full Vitest suite**

Run: `npx vitest run`
Expected: All test suites pass

- [ ] **Step 3: Update work log and commit final verification**

```bash
git add dev_docs/totality_work_log_20260825.md
git commit -m "chore: record implementation and full verification in daily work log"
```
