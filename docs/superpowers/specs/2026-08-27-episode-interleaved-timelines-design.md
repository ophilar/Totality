# Episode-Interleaved Timelines & Chronological Viewing Orders Design

**Date**: 2026-08-27  
**Status**: Approved  

---

## 1. Overview & Vision
All franchise timelines in Totality operate at **fine-resolution episode level**, fully interleaving TV episodes and movies in their canonical chronological viewing sequence. Macro/show-level abstractions are replaced with exact item-by-item ordering so users can watch or sync end-to-end playlists without manual episode sorting.

---

## 2. Core Components

### 2.1 Fine-Resolution Bundled Recipes (`src/main/services/timelines/bundledRecipes.ts`)
- **Star Trek (The Chronology Project Order)**:
  - Full sequence covering Enterprise, Discovery (23rd century), Short Treks, Strange New Worlds, The Original Series, The Animated Series, Films I–VI.
  - Complete 24th Century interleaving: TNG (Seasons 1–5), TNG S6 / DS9 S1 concurrent episodes, TNG S7 / DS9 S2, *Star Trek: Generations*, DS9 S3 / Voyager S1 launch, DS9 S4–S5 / *Star Trek: First Contact* / Voyager S2–S3, DS9 S6–S7 / *Star Trek: Insurrection* / Voyager S4–S7, *Star Trek: Nemesis*.
  - 24th–25th & 32nd Century: Lower Decks, Prodigy, Picard (Seasons 1–3), Discovery (Seasons 3–5), *Section 31*.
- **Star Wars (Canon Chronological Order)**:
  - Prequels (Episodes I & II).
  - *The Clone Wars* canon chronological episode order (Season 1–7 episodes interleaved with the *The Clone Wars* theatrical film).
  - *Episode III: Revenge of the Sith*, *The Bad Batch*, *Solo*, *Obi-Wan Kenobi*, *Andor*, *Rebels*, *Rogue One*, Original Trilogy (IV, V, VI).
  - New Republic Era: *The Mandalorian* S1–S2 → *The Book of Boba Fett* → *The Mandalorian* S3 → *Ahsoka* → *Skeleton Crew*.
  - Sequel Trilogy & *Resistance*.
- **Marvel Cinematic Universe (MCU Chronology)**:
  - Complete phase-by-phase chronological order with Marvel TV & Disney+ episodes interleaved directly with theatrical releases.

### 2.2 Live Web & AI Viewing Guide Ingestion (`src/main/services/timelines/WebGuideRecipeProvider.ts`)
- AI & web parsers extract directly to `type: 'episode'` (with `seasonNumber` and `episodeNumber`) and `type: 'movie'` items.
- Eliminates whole-show collapsing during ingestion.

### 2.3 Timeline Resolution Engine (`src/main/services/timelines/TimelineResolutionEngine.ts`)
- Evaluates each individual episode and movie against the local library using:
  1. Canonical Provider IDs (TMDB, TVDB, IMDb episode IDs).
  2. Series Title + Season + Episode matching with token-based normalization.
  3. Fuzzy title normalization and fallback.

### 2.4 Plex Playlist Sync Service (`src/main/services/timelines/PlexPlaylistSyncService.ts`)
- Creates or updates Plex playlists where every item is added in the exact 1-to-1 interleaved sequence.
- Preserves all playback states, scrobbles, and bookmarks.

---

## 3. Verification & Testing
- Unit tests validating episode-level resolution and matching for interleaved series and films.
- Tests ensuring Plex playlist syncing retains exact mixed-item ordering.
- Verification across existing test suites (`npm test`).
