# Franchise Timelines & Media Subsystem Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Franchise Timelines & Plex Playlist Synchronization subsystem (Phase 4) and fix the TV show deduplication / false-conflict bugs and silent video metadata warnings.

**Architecture:** Strategy pattern for timeline recipe providers (`ITimelineRecipeProvider`), a dedicated `TimelineResolutionEngine` enforcing strict ID-only matching, a safe `PlexPlaylistSyncService` using Plex playlist CRUD endpoints without touching view states, and an interactive desktop UI roadmap view connected to existing `ArrIntegrationService`.

**Tech Stack:** TypeScript, Electron, React, Drizzle ORM / SQLite, Tailwind CSS, Plex Media Server HTTP API, Sonarr / Radarr API.

## Global Constraints
- Strict ID matching only (`tmdbId`, `tvdbId`, `imdbId`). No fuzzy title/year guessing.
- Never modify Plex play counts, last viewed timestamps, resume offsets, or watched status.
- Fail-fast with explicit errors; no silent try/catch suppression or defensive try-catch-rethrow boilerplate.
- Reuse existing Totality services (`PlexProvider`, `ArrIntegrationService`, `BetterSQLiteService`).

---

### Task 1: Fix TV Show Deduplication & Match Status Bugs

**Files:**
- Modify: `src/main/database/repositories/TVShowRepository.ts:186-204`
- Modify: `src/main/services/SeriesIdentityService.ts:17-21`

**Interfaces:**
- `getMediaMatchStatus(input: { locked: boolean; canonicalIds: string[]; conflictingEntityIds: number[] }): MediaMatchStatus`

- [ ] **Step 1: Fix TVShowRepository `upsertCompleteness` cleanup delete query**
In `src/main/database/repositories/TVShowRepository.ts`, update the cleanup logic so that when a show is resolved with `tmdb:` or `tvdb:` identity, it purges the prior `unresolved:%` row by matching `seriesTitle`, `sourceId`, and `libraryId` without requiring exact matches on `totalSeasons` / `totalEpisodes` (which differ between initial local count and TMDB full series count).

- [ ] **Step 2: Fix `getMediaMatchStatus` in SeriesIdentityService.ts**
In `src/main/services/SeriesIdentityService.ts`, fix `getMediaMatchStatus` so that possessing both TMDB and TVDB canonical IDs does not trigger `'conflicting'`. Only return `'conflicting'` when `conflictingEntityIds.length > 0` or when canonical IDs contain conflicting IDs from the same provider type.

- [ ] **Step 3: Verify deduplication logic**
Verify `TVShowRepository` correctly returns single deduplicated series summaries with `'verified'` status when both TMDB and TVDB are matched.

---

### Task 2: Support Silent Video Streams in Media Transformer & Mapper

**Files:**
- Modify: `src/main/providers/base/MediaTransformer.ts:151`
- Modify: `src/main/providers/base/MediaMapper.ts:117`

- [ ] **Step 1: Allow 0 audio streams for video versions**
In `MediaTransformer.ts` and `MediaMapper.ts`, change `if (!videoStream || audioStreams.length === 0) continue` to `if (!videoStream) continue`. If `audioStreams.length === 0`, set `audioTracks = []` and `bestAudioTrack = null`, allowing silent videos, extras (e.g. `MUET` concept videos), and silent shorts to be mapped as valid video versions without logging `missing_audio_stream` warnings.

- [ ] **Step 2: Verify silent video transformation**
Verify transforming items with 0 audio streams succeeds and correctly assigns `'None'` / empty audio track lists.

---

### Task 3: Implement `ITimelineRecipeProvider` Strategy & Implementations

**Files:**
- Create: `src/main/services/timelines/ITimelineRecipeProvider.ts`
- Create: `src/main/services/timelines/RemoteRegistryRecipeProvider.ts`
- Create: `src/main/services/timelines/TraktRecipeProvider.ts`

- [ ] **Step 1: Define `ITimelineRecipeProvider` and `TimelineDefinition` schemas**
Create `src/main/services/timelines/ITimelineRecipeProvider.ts` defining `TimelineDefinition`, `TimelineItem`, and the provider strategy interface.

- [ ] **Step 2: Implement `RemoteRegistryRecipeProvider`**
Create `src/main/services/timelines/RemoteRegistryRecipeProvider.ts` to fetch versioned franchise recipes (Star Trek Chronology, Star Trek Release Order, MCU, Star Wars Canon) from upstream CDN/repository with local bundled fallback.

- [ ] **Step 3: Implement `TraktRecipeProvider`**
Create `src/main/services/timelines/TraktRecipeProvider.ts` to parse and extract `TimelineDefinition` from public Trakt list URLs using TMDB/TVDB identifiers.

---

### Task 4: Implement `TimelineResolutionEngine`

**Files:**
- Create: `src/main/services/timelines/TimelineResolutionEngine.ts`

- [ ] **Step 1: Implement Strict ID Resolution**
Create `TimelineResolutionEngine` to iterate through `TimelineItem[]` and resolve against `BetterSQLiteService.media` strictly via `tmdbId` for movies and `tmdbId`/`tvdbId` + season/episode numbers for TV episodes.

- [ ] **Step 2: Attach Media Quality & Plex IDs**
For each resolved item, extract Plex `ratingKey`, video resolution, HDR format, audio codec, and bitrate score. Mark unresolved items explicitly as `isOwned: false` with missing identifiers for acquisition.

---

### Task 5: Implement `PlexPlaylistSyncService`

**Files:**
- Create: `src/main/services/timelines/PlexPlaylistSyncService.ts`

- [ ] **Step 1: Implement Plex Playlist CRUD Methods**
Implement `createOrUpdatePlaylist(serverUri: string, token: string, title: string, ratingKeys: string[])` using Plex HTTP API endpoints (`POST /playlists`, `PUT /playlists/{id}/items`, `DELETE /playlists/{id}`).

- [ ] **Step 2: Ensure Zero Mutation of Watch States**
Ensure requests strictly address playlist endpoints and never scrobble or alter item metadata.

---

### Task 6: Implement IPC Handlers & Renderer Stores

**Files:**
- Create: `src/main/ipc/timelinesIpc.ts`
- Modify: `src/main/ipc/index.ts`
- Create: `src/renderer/src/stores/useTimelinesStore.ts`

- [ ] **Step 1: Register IPC Channels**
Register `timelines:list-recipes`, `timelines:get-timeline`, `timelines:sync-plex`, and `timelines:import-custom` in `src/main/ipc/timelinesIpc.ts`.

- [ ] **Step 2: Create Renderer Store**
Create `useTimelinesStore.ts` to manage active franchise selection, timeline resolution state, syncing progress, and auto-sync preferences.

---

### Task 7: Build Desktop GUI for Franchise Timelines & Storyline View

**Files:**
- Create: `src/renderer/src/components/timelines/TimelinesView.tsx`
- Create: `src/renderer/src/components/timelines/TimelineStorylineList.tsx`
- Create: `src/renderer/src/components/timelines/TimelineItemRow.tsx`
- Modify: `src/renderer/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add Timelines Navigation**
Add "Timelines" icon and route to `Sidebar.tsx`.

- [ ] **Step 2: Build Franchise Hub & Storyline List**
Build `TimelinesView.tsx` with franchise selector cards (Star Trek Chronological, Star Trek Air-Date, MCU, Star Wars), custom list import modal, completeness stats, and **[ Sync to Plex ]** button.

- [ ] **Step 3: Connect Missing Item Search to Sonarr/Radarr**
Add 1-click **[ Search in Sonarr/Radarr ]** button for missing items in `TimelineItemRow.tsx` using `ArrIntegrationService`.
