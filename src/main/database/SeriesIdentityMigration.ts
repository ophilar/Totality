import type Database from 'better-sqlite3'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'

interface SeriesCompletenessIdentityRow {
  id: number
  series_title: string
  source_id: string
  library_id: string
  tmdb_id: string | null
  tvdb_id: string | null
  series_identity_key: string | null
  completeness_percentage?: number
  owned_episodes?: number
  poster_url?: string | null
  backdrop_url?: string | null
  status?: string | null
  updated_at?: string | null
}

interface EpisodeIdentityRow {
  id: number
  series_title: string | null
  source_id: string
  library_id: string
  series_tmdb_id: string | null
  tmdb_id: string | null
  file_path: string
  series_identity_key: string | null
}

const SERIES_UNIQUENESS_INDEXES = [
  {
    name: 'idx_series_completeness_unique',
    create: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_unique ON series_completeness(series_identity_key, source_id, library_id)',
  },
  {
    name: 'idx_series_completeness_tvdb',
    create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_tvdb ON series_completeness(source_id, library_id, tvdb_id) WHERE tvdb_id IS NOT NULL AND tvdb_id != ''",
  },
  {
    name: 'idx_series_completeness_tmdb',
    create: "CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_tmdb ON series_completeness(source_id, library_id, tmdb_id) WHERE tmdb_id IS NOT NULL AND tmdb_id != ''",
  },
] as const

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some(existing => existing.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

/**
 * Backfill historical series identity keys across all media_items (episodes)
 * and series_completeness records, canonicalizing series across sources.
 */
export function backfillSeriesIdentityKeys(db: Database.Database): void {
  // Ensure tables and columns exist before proceeding
  addColumnIfMissing(db, 'series_completeness', 'series_identity_key', 'TEXT')
  addColumnIfMissing(db, 'series_completeness', 'tvdb_id', 'TEXT')
  addColumnIfMissing(db, 'media_items', 'series_identity_key', 'TEXT')

  // 1. Drop existing indexes so backfill updates do not cause transient conflicts
  for (const index of SERIES_UNIQUENESS_INDEXES) {
    db.exec(`DROP INDEX IF EXISTS ${index.name}`)
  }

  // 2. Discover all series distinct across (source_id, library_id, series_title)
  // Check both series_completeness and media_items
  const completenessRows = db.prepare(`
    SELECT id, series_title, source_id, library_id, tmdb_id, tvdb_id, series_identity_key
    FROM series_completeness
  `).all() as SeriesCompletenessIdentityRow[]

  const episodeRows = db.prepare(`
    SELECT id, series_title, source_id, library_id, series_tmdb_id, tmdb_id, file_path, series_identity_key
    FROM media_items
    WHERE type = 'episode'
  `).all() as EpisodeIdentityRow[]

  // Build a map of authoritative TMDB and TVDB IDs per (source_id, library_id, series_title)
  const seriesInfoMap = new Map<string, {
    sourceId: string
    libraryId: string
    seriesTitle: string
    tmdbId?: string
    tvdbId?: string
    filePath?: string
  }>()

  function getSeriesMapKey(sourceId: string, libraryId: string, seriesTitle: string): string {
    return `${sourceId || ''}\u001f${libraryId || ''}\u001f${(seriesTitle || '').trim().toLowerCase()}`
  }

  // Populate from completeness records first
  for (const sc of completenessRows) {
    const key = getSeriesMapKey(sc.source_id, sc.library_id, sc.series_title)
    const existing = seriesInfoMap.get(key)
    const tmdbId = sc.tmdb_id?.trim() || existing?.tmdbId
    const tvdbId = sc.tvdb_id?.trim() || existing?.tvdbId
    seriesInfoMap.set(key, {
      sourceId: sc.source_id,
      libraryId: sc.library_id,
      seriesTitle: sc.series_title,
      tmdbId: tmdbId || undefined,
      tvdbId: tvdbId || undefined,
    })
  }

  // Enrich with episode metadata (if an episode has series_tmdb_id or tmdb_id, canonicalize the whole series)
  for (const ep of episodeRows) {
    const epTitle = ep.series_title?.trim() || ''
    const key = getSeriesMapKey(ep.source_id, ep.library_id, epTitle)
    const existing = seriesInfoMap.get(key)
    const epTmdb = ep.series_tmdb_id?.trim() || ep.tmdb_id?.trim() || undefined
    const tmdbId = existing?.tmdbId || epTmdb
    seriesInfoMap.set(key, {
      sourceId: ep.source_id,
      libraryId: ep.library_id,
      seriesTitle: epTitle,
      tmdbId: tmdbId || undefined,
      tvdbId: existing?.tvdbId,
      filePath: ep.file_path,
    })
  }

  const updateCompleteness = db.prepare('UPDATE series_completeness SET series_identity_key = ? WHERE id = ?')
  const updateEpisode = db.prepare('UPDATE media_items SET series_identity_key = ? WHERE id = ?')

  const runBackfill = db.transaction(() => {
    // Backfill completeness rows
    for (const sc of completenessRows) {
      const key = getSeriesMapKey(sc.source_id, sc.library_id, sc.series_title)
      const info = seriesInfoMap.get(key)
      const canonicalKey = deriveSeriesIdentityKey({
        sourceId: sc.source_id,
        libraryId: sc.library_id,
        folderRelativePath: sc.series_title,
        tmdbId: info?.tmdbId || sc.tmdb_id,
        tvdbId: info?.tvdbId || sc.tvdb_id,
      })
      updateCompleteness.run(canonicalKey, sc.id)
    }

    // Backfill episode rows ensuring all episodes in a series share the exact same key
    for (const ep of episodeRows) {
      const epTitle = ep.series_title?.trim() || ''
      const key = getSeriesMapKey(ep.source_id, ep.library_id, epTitle)
      const info = seriesInfoMap.get(key)
      const canonicalKey = deriveSeriesIdentityKey({
        sourceId: ep.source_id,
        libraryId: ep.library_id,
        folderRelativePath: epTitle || ep.file_path,
        tmdbId: info?.tmdbId || ep.series_tmdb_id || ep.tmdb_id,
        tvdbId: info?.tvdbId,
      })
      updateEpisode.run(canonicalKey, ep.id)
    }
  })

  runBackfill()

  // 3. Verify episode canonicalization: ensure NO episode row remains unassigned
  const uncanonicalizedEpisodes = db.prepare(`
    SELECT id, title, file_path FROM media_items
    WHERE type = 'episode' AND (series_identity_key IS NULL OR TRIM(series_identity_key) = '')
    LIMIT 1
  `).get() as { id: number; title: string; file_path: string } | undefined

  if (uncanonicalizedEpisodes) {
    throw new Error(`Episode ${uncanonicalizedEpisodes.id} (${uncanonicalizedEpisodes.title}) was not assigned a canonical series_identity_key`)
  }

  // 4. Create performance index on media_items(series_identity_key)
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_items_series_identity ON media_items(series_identity_key) WHERE series_identity_key IS NOT NULL')

  // 5. Enforce constraints and deduplicate series_completeness
  enforceSeriesIdentityConstraints(db)
}

/**
 * Enforce database constraints and deduplicate series_completeness records.
 * When duplicates exist for the same (series_identity_key, source_id, library_id),
 * the record with highest completeness, most owned episodes, and authoritative TMDB ID survives.
 */
export function enforceSeriesIdentityConstraints(db: Database.Database): void {
  // Check for any invalid/empty keys
  const invalidIdentity = db.prepare(`
    SELECT id
    FROM series_completeness
    WHERE series_identity_key IS NULL OR TRIM(series_identity_key) = ''
    LIMIT 1
  `).get()
  if (invalidIdentity) {
    throw new Error('Series identity migration left a completeness row without a canonical identity')
  }

  // Discover duplicate groups
  const duplicateGroups = db.prepare(`
    SELECT series_identity_key, source_id, library_id, COUNT(*) as cnt
    FROM series_completeness
    GROUP BY series_identity_key, source_id, library_id
    HAVING COUNT(*) > 1
  `).all() as Array<{ series_identity_key: string; source_id: string; library_id: string; cnt: number }>

  if (duplicateGroups.length > 0) {
    const runDeduplication = db.transaction(() => {
      for (const group of duplicateGroups) {
        // Deterministically rank all duplicates in this group:
        // Highest completeness, most owned episodes, verified TMDB ID, verified poster, latest updated
        const candidates = db.prepare(`
          SELECT *
          FROM series_completeness
          WHERE series_identity_key = ? AND source_id = ? AND library_id = ?
          ORDER BY
            completeness_percentage DESC,
            owned_episodes DESC,
            (CASE WHEN tmdb_id IS NOT NULL AND TRIM(tmdb_id) != '' THEN 1 ELSE 0 END) DESC,
            (CASE WHEN poster_url IS NOT NULL AND TRIM(poster_url) != '' THEN 1 ELSE 0 END) DESC,
            updated_at DESC,
            id DESC
        `).all(group.series_identity_key, group.source_id, group.library_id) as Array<Record<string, any>>

        const winner = candidates[0]
        const losers = candidates.slice(1)

        // Merge any non-empty metadata fields from losers into the winner
        let needsUpdate = false
        const updates: Record<string, any> = {}

        for (const field of ['tmdb_id', 'tvdb_id', 'poster_url', 'backdrop_url', 'status'] as const) {
          if (!winner[field] || String(winner[field]).trim() === '') {
            const loserWithField = losers.find(l => l[field] && String(l[field]).trim() !== '')
            if (loserWithField) {
              winner[field] = loserWithField[field]
              updates[field] = loserWithField[field]
              needsUpdate = true
            }
          }
        }

        if (needsUpdate) {
          db.prepare(`
            UPDATE series_completeness SET
              tmdb_id = COALESCE(?, tmdb_id),
              tvdb_id = COALESCE(?, tvdb_id),
              poster_url = COALESCE(?, poster_url),
              backdrop_url = COALESCE(?, backdrop_url),
              status = COALESCE(?, status)
            WHERE id = ?
          `).run(
            updates.tmdb_id || null,
            updates.tvdb_id || null,
            updates.poster_url || null,
            updates.backdrop_url || null,
            updates.status || null,
            winner.id
          )
        }

        // Delete all duplicate rows
        const deleteStmt = db.prepare('DELETE FROM series_completeness WHERE id = ?')
        for (const loser of losers) {
          deleteStmt.run(loser.id)
        }
      }
    })

    runDeduplication()
  }

  // Re-create uniqueness indexes WITHOUT catching errors (if duplicates remain, fail loudly)
  for (const index of SERIES_UNIQUENESS_INDEXES) {
    db.exec(`DROP INDEX IF EXISTS ${index.name}`)
    db.exec(index.create)
  }

  // Create triggers enforcing that series_identity_key can never be inserted or updated to NULL/blank
  db.exec(`
    DROP TRIGGER IF EXISTS trg_series_completeness_identity_insert;
    CREATE TRIGGER trg_series_completeness_identity_insert
    BEFORE INSERT ON series_completeness
    FOR EACH ROW
    WHEN NEW.series_identity_key IS NULL OR TRIM(NEW.series_identity_key) = ''
    BEGIN
      SELECT RAISE(ABORT, 'series_identity_key is required');
    END;

    DROP TRIGGER IF EXISTS trg_series_completeness_identity_update;
    CREATE TRIGGER trg_series_completeness_identity_update
    BEFORE UPDATE OF series_identity_key ON series_completeness
    FOR EACH ROW
    WHEN NEW.series_identity_key IS NULL OR TRIM(NEW.series_identity_key) = ''
    BEGIN
      SELECT RAISE(ABORT, 'series_identity_key is required');
    END;

    DROP TRIGGER IF EXISTS trg_media_items_episode_identity_insert;
    CREATE TRIGGER trg_media_items_episode_identity_insert
    BEFORE INSERT ON media_items
    FOR EACH ROW
    WHEN NEW.type = 'episode' AND (
      NEW.series_identity_key IS NULL OR
      (
        NOT (NEW.series_identity_key GLOB 'tmdb:*') AND
        NOT (NEW.series_identity_key GLOB 'tvdb:*') AND
        NOT (NEW.series_identity_key GLOB 'unresolved:*')
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'series_identity_key must be a canonical key starting with tmdb:, tvdb:, or unresolved: for episode media items');
    END;

    DROP TRIGGER IF EXISTS trg_media_items_episode_identity_update;
    CREATE TRIGGER trg_media_items_episode_identity_update
    BEFORE UPDATE OF type, series_identity_key ON media_items
    FOR EACH ROW
    WHEN NEW.type = 'episode' AND (
      NEW.series_identity_key IS NULL OR
      (
        NOT (NEW.series_identity_key GLOB 'tmdb:*') AND
        NOT (NEW.series_identity_key GLOB 'tvdb:*') AND
        NOT (NEW.series_identity_key GLOB 'unresolved:*')
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'series_identity_key must be a canonical key starting with tmdb:, tvdb:, or unresolved: for episode media items');
    END;
  `)
}
