# Franchise Timelines & Plex Playlist Sync Engine Design Specification

## Overview
A native Totality subsystem for loading, matching, and synchronizing curated franchise timelines (e.g., *Star Trek: The Chronology Project*, *Star Trek: Release Order*, *MCU Timeline*, *Star Wars Canon*) into Plex playlists with cross-library support (movies and TV episodes interleaved).

---

## 1. System Goals & Constraints

### Goals
1. **Curated & Dynamic:** Pre-configured franchise recipes fetched remotely to incorporate newly aired episodes/movies automatically.
2. **Custom Extensible:** Ability to import custom Trakt List URLs or custom JSON recipes.
3. **Plex Synchronization:** Generate and maintain cross-library Plex playlists matching exact timeline order.
4. **Acquisition Integration:** Leverage `ArrIntegrationService` to query/trigger acquisition for missing timeline entries in Sonarr/Radarr.
5. **Quality & Completeness Alignment:** Display owned vs. missing items with video/audio quality badges directly on the storyline view.

### Constraints & Directives
* **Strict ID Matching Only:** Match media exclusively via explicit identifiers (`tmdbId`, `tvdbId`, `imdbId`). No fuzzy title/year heuristics or fallbacks.
* **Preserve Viewed Status:** Playlists must be managed strictly via Plex playlist CRUD endpoints (`POST /playlists`, `PUT /playlists/{id}/items`, `DELETE /playlists/{id}`). Never call playback, metadata editing, or scrobble/view-state endpoints.
* **Lean & Idiomatic Engineering:** No redundant try/catch re-throws, no useless defensive checks, no mocks/fakes in production paths, no thin wrappers. Follow SOLID principles and reuse existing Totality services.

---

## 2. Architecture & Data Model

### Strategy Pattern for Timeline Providers
```typescript
export interface TimelineDefinition {
  id: string
  franchise: string
  name: string
  description: string
  sourceUrl?: string
  version: number
  items: TimelineItem[]
}

export interface TimelineItem {
  order: number
  type: 'movie' | 'episode'
  title: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  airDate?: string
  timelineEra?: string
  identifiers: {
    tmdbId?: number
    tvdbId?: number
    imdbId?: string
  }
}

export interface ITimelineRecipeProvider {
  fetchTimeline(id: string): Promise<TimelineDefinition>
  listAvailableRecipes(): Promise<Array<{ id: string; name: string; franchise: string }>>
}
```

### Components

1. **`RemoteRegistryRecipeProvider` (`ITimelineRecipeProvider`)**:
   * Fetches validated JSON definitions from an upstream versioned repository/CDN for built-in recipes (Star Trek Chronology, Release Order, MCU, Star Wars).
   * Caches locally in SQLite table `franchise_timelines`.

2. **`TraktRecipeProvider` (`ITimelineRecipeProvider`)**:
   * Resolves Trakt public list URLs into `TimelineDefinition` using Trakt API list items, extracting TMDB/TVDB IDs and sequential index.

3. **`TimelineResolutionEngine`**:
   * Takes a `TimelineDefinition` and queries Totality's SQLite database for local Plex media items.
   * Resolves items strictly matching `tmdb_id` or `tvdb_id` + season/episode numbers.
   * Emits a `ResolvedTimeline` containing owned items (with Plex `ratingKey` & quality metrics) and missing items.

4. **`PlexPlaylistSyncService`**:
   * Resolves Plex server connection details from `PlexProvider`.
   * Checks if playlist exists via `GET /playlists`.
   * If creating: sends `POST /playlists` with the sequence of `ratingKey` URIs.
   * If updating: fetches current playlist items, calculates the minimal diff, and updates item order.

5. **`ArrIntegrationService` (Existing Service Reuse)**:
   * Provides 1-click search commands for missing items directly to Radarr (`lookupMovieByTmdbId` / `searchMovie`) or Sonarr (`lookupSeriesByTvdbId`).

---

## 3. Desktop UI Design

### Navigation & View
* **Location:** Accessible via a new **"Timelines"** navigation item in Totality's sidebar.
* **Franchise Hub:**
  * Preset cards: *Star Trek (Chronology Project)*, *Star Trek (Release Order)*, *Marvel Cinematic Universe*, *Star Wars Canon*.
  * Action: **"Import Custom List"** (Trakt URL / Recipe URL).

### Storyline Roadmap View
* **Header:** Franchise title, total items, completeness percentage, and **[ Sync to Plex ]** / **[ Auto-Sync on Scan Toggle ]** controls.
* **Timeline Item Row:**
  * Sequence Index `#`
  * Title, Series Name, Season/Episode, and Era/Stardate.
  * Status Chip:
    * Owned: Shows quality tier (e.g., `4K HDR HEVC`, `1080p DTS-HD`).
    * Missing: Red `Missing` badge with **[ Search in Sonarr/Radarr ]** button.

---

## 4. Verification & Testing

1. **Unit Tests (`vitest`):**
   * Validation of schema parsing for remote recipes.
   * Resolution engine tests: verify strict ID matching produces expected `ratingKey` sequences and marks missing items without title fallbacks.
   * Diffing logic: verify insertion/removal diffs without playlist corruption.
2. **Integration Verification:**
   * Validate Plex API playlist creation and item ordering on a test Plex instance.
   * Verify watched/unwatched statuses and resume offsets remain completely untouched.
