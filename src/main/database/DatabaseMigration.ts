/**
 * Database Migration Utility
 *
 * Handles transition to better-sqlite3 and schema updates.
 */

import type { Client } from '@libsql/client'
import { getLoggingService } from '@main/services/LoggingService'
import { DATABASE_SCHEMA } from '@main/database/schema'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'
import { getFileNameParser } from '@main/services/FileNameParser'

/**
 * Run database migrations and schema updates
 */
export async function runMigrations(db: Client): Promise<void> {
  getLoggingService().info('[DatabaseMigration]', 'Starting migrations...')

  // 1. Execute main schema
  try {
    const rawStatements = DATABASE_SCHEMA
      .replace(/--.*$/gm, '') // Remove comments
      .split(/;\s*(?=(?:[^']*'[^']*')*[^']*$)/) // Split by ; not in quotes
      .map(s => s.trim())
      .filter(s => s.length > 0)

    const statements: string[] = []
    let currentTrigger: string[] = []
    let inTrigger = false

    for (const sql of rawStatements) {
      if (sql.toUpperCase().includes('CREATE TRIGGER')) {
        inTrigger = true
        currentTrigger.push(sql)
      } else if (inTrigger) {
        currentTrigger.push(sql)
        if (sql.toUpperCase().endsWith('END')) {
          statements.push(currentTrigger.join('; '))
          currentTrigger = []
          inTrigger = false
        }
      } else {
        statements.push(sql)
      }
    }

    for (const sql of statements) {
      try {
        await db.execute(sql)
      } catch (err) {
        const msg = getErrorMessage(err)
        if (msg.includes('already exists')) continue
        getLoggingService().error('[DatabaseMigration]', `Schema statement failed: "${sql.substring(0, 100)}..." Error: ${msg}`)
      }
    }
    getLoggingService().debug('[DatabaseMigration]', 'Baseline schema applied/verified')
  } catch (error) {
    getLoggingService().error('[DatabaseMigration]', 'Baseline schema execution failed: ' + getErrorMessage(error))
  }

  // 2. Incremental column updates
  await ensureColumn(db, 'quality_scores', 'quality_tier', "TEXT NOT NULL DEFAULT 'SD'")
  await ensureColumn(db, 'quality_scores', 'tier_quality', "TEXT NOT NULL DEFAULT 'MEDIUM'")
  await ensureColumn(db, 'quality_scores', 'tier_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'quality_scores', 'bitrate_tier_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'quality_scores', 'audio_tier_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'quality_scores', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'quality_scores', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')

  // Media Items
  await ensureColumn(db, 'media_items', 'source_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'media_items', 'source_type', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'media_items', 'library_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'media_items', 'episode_thumb_url', 'TEXT')
  await ensureColumn(db, 'media_items', 'season_poster_url', 'TEXT')
  await ensureColumn(db, 'media_items', 'video_frame_rate', 'REAL')
  await ensureColumn(db, 'media_items', 'color_bit_depth', 'INTEGER')
  await ensureColumn(db, 'media_items', 'hdr_format', 'TEXT')
  await ensureColumn(db, 'media_items', 'color_space', 'TEXT')
  await ensureColumn(db, 'media_items', 'video_profile', 'TEXT')
  await ensureColumn(db, 'media_items', 'video_level', 'INTEGER')
  await ensureColumn(db, 'media_items', 'audio_profile', 'TEXT')
  await ensureColumn(db, 'media_items', 'audio_sample_rate', 'INTEGER')
  await ensureColumn(db, 'media_items', 'has_object_audio', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'media_items', 'container', 'TEXT')
  await ensureColumn(db, 'media_items', 'series_tmdb_id', 'TEXT')
  await ensureColumn(db, 'media_items', 'series_identity_key', 'TEXT')
  await ensureColumn(db, 'media_items', 'user_fixed_match', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'media_items', 'audio_tracks', 'TEXT')
  await ensureColumn(db, 'media_items', 'file_mtime', 'INTEGER')
  await ensureColumn(db, 'media_items', 'original_language', 'TEXT')
  await ensureColumn(db, 'media_items', 'audio_language', 'TEXT')
  await ensureColumn(db, 'media_items', 'subtitle_tracks', 'TEXT')
  await ensureColumn(db, 'media_items', 'sort_title', 'TEXT')
  await ensureColumn(db, 'media_items', 'version_count', 'INTEGER NOT NULL DEFAULT 1')
  await ensureColumn(db, 'media_items', 'summary', 'TEXT')

  // Series Completeness
  await ensureColumn(db, 'series_completeness', 'tmdb_id', 'TEXT')
  await ensureColumn(db, 'series_completeness', 'tvdb_id', 'TEXT')
  await ensureColumn(db, 'series_completeness', 'poster_url', 'TEXT')
  await ensureColumn(db, 'series_completeness', 'backdrop_url', 'TEXT')
  await ensureColumn(db, 'series_completeness', 'status', 'TEXT')
  await ensureColumn(db, 'series_completeness', 'user_fixed_match', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'series_completeness', 'source_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'series_completeness', 'library_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'series_completeness', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'series_completeness', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'series_completeness', 'total_size', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'series_completeness', 'series_identity_key', 'TEXT')

  // Movie Collections
  await ensureColumn(db, 'movie_collections', 'source_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'movie_collections', 'library_id', "TEXT NOT NULL DEFAULT ''")

  // Music Tables
  await ensureColumn(db, 'music_artists', 'library_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'music_artists', 'user_fixed_match', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'music_albums', 'library_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'music_albums', 'user_fixed_match', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'music_tracks', 'library_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'music_tracks', 'file_mtime', 'INTEGER')

  // Artist & Album Completeness
  await ensureColumn(db, 'artist_completeness', 'library_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'artist_completeness', 'total_size', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'artist_completeness', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'artist_completeness', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'album_completeness', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'album_completeness', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'album_completeness', 'total_size', 'INTEGER NOT NULL DEFAULT 0')

  // Music Quality Scores
  await ensureColumn(db, 'music_quality_scores', 'quality_tier', "TEXT NOT NULL DEFAULT 'LOSSY_MID'")
  await ensureColumn(db, 'music_quality_scores', 'tier_quality', "TEXT NOT NULL DEFAULT 'MEDIUM'")
  await ensureColumn(db, 'music_quality_scores', 'tier_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'music_quality_scores', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'music_quality_scores', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')

  // Per-version enhancements
  await ensureColumn(db, 'media_item_versions', 'original_language', 'TEXT')
  await ensureColumn(db, 'media_item_versions', 'audio_language', 'TEXT')
  await ensureColumn(db, 'media_item_versions', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'media_item_versions', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'media_item_versions', 'bitrate_tier_score', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'media_item_versions', 'audio_tier_score', 'INTEGER DEFAULT 0')

  // Wishlist
  await ensureColumn(db, 'wishlist_items', 'reason', "TEXT DEFAULT 'missing'")
  await ensureColumn(db, 'wishlist_items', 'current_quality_tier', 'TEXT')
  await ensureColumn(db, 'wishlist_items', 'current_quality_level', 'TEXT')
  await ensureColumn(db, 'wishlist_items', 'current_resolution', 'TEXT')
  await ensureColumn(db, 'wishlist_items', 'current_video_codec', 'TEXT')
  await ensureColumn(db, 'wishlist_items', 'current_audio_codec', 'TEXT')
  await ensureColumn(db, 'wishlist_items', 'media_item_id', 'INTEGER')
  await ensureColumn(db, 'wishlist_items', 'status', "TEXT DEFAULT 'active'")
  await ensureColumn(db, 'wishlist_items', 'completed_at', 'TEXT')

  // Library scans
  await ensureColumn(db, 'library_scans', 'is_enabled', 'INTEGER NOT NULL DEFAULT 1')
  await ensureColumn(db, 'library_scans', 'allow_expanded_matching', 'INTEGER NOT NULL DEFAULT 0')

  getLoggingService().debug('[DatabaseMigration]', 'Running complex migrations...')
  await migrateCheckConstraints(db)
  await createIndexes(db)
  await fixMusicTrackAlbumReferences(db)
  await migrateExistingItemsToVersions(db)
  await cleanupOrphanedRecords(db)
  await backfillMediaIdentities(db)
  await mergeDuplicateSeriesCompleteness(db)

  getLoggingService().info('[DatabaseMigration]', 'Migrations completed successfully')
}

async function backfillMediaIdentities(db: Client): Promise<void> {
  const statements = [
    `INSERT OR IGNORE INTO media_identities (entity_type, entity_id, provider, external_id, is_locked, lock_source)
     SELECT 'movie', id, 'tmdb', tmdb_id, COALESCE(user_fixed_match, 0), CASE WHEN COALESCE(user_fixed_match, 0) = 1 THEN 'legacy' END
     FROM media_items WHERE type = 'movie' AND tmdb_id IS NOT NULL AND tmdb_id <> ''`,
    `INSERT OR IGNORE INTO media_identities (entity_type, entity_id, provider, external_id, is_locked, lock_source)
     SELECT 'movie', id, 'imdb', imdb_id, COALESCE(user_fixed_match, 0), CASE WHEN COALESCE(user_fixed_match, 0) = 1 THEN 'legacy' END
     FROM media_items WHERE type = 'movie' AND imdb_id IS NOT NULL AND imdb_id <> ''`,
    `INSERT OR IGNORE INTO media_identities (entity_type, entity_id, provider, external_id, is_locked, lock_source)
     SELECT 'series', id, 'tmdb', tmdb_id, COALESCE(user_fixed_match, 0), CASE WHEN COALESCE(user_fixed_match, 0) = 1 THEN 'legacy' END
     FROM series_completeness WHERE tmdb_id IS NOT NULL AND tmdb_id <> ''`,
    `INSERT OR IGNORE INTO media_identities (entity_type, entity_id, provider, external_id, is_locked, lock_source)
     SELECT 'artist', id, 'musicbrainz', musicbrainz_id, COALESCE(user_fixed_match, 0), CASE WHEN COALESCE(user_fixed_match, 0) = 1 THEN 'legacy' END
     FROM music_artists WHERE musicbrainz_id IS NOT NULL AND musicbrainz_id <> ''`,
    `INSERT OR IGNORE INTO media_identities (entity_type, entity_id, provider, external_id, is_locked, lock_source)
     SELECT 'album', id, 'musicbrainz', musicbrainz_id, COALESCE(user_fixed_match, 0), CASE WHEN COALESCE(user_fixed_match, 0) = 1 THEN 'legacy' END
     FROM music_albums WHERE musicbrainz_id IS NOT NULL AND musicbrainz_id <> ''`
  ]
  for (const sql of statements) {
    try { await db.execute(sql) } catch (error) { getLoggingService().warn('[DatabaseMigration]', `Identity backfill skipped: ${getErrorMessage(error)}`) }
  }
}

/**
 * Ensures a column exists in a table, adding it if missing.
 */
async function ensureColumn(db: Client, table: string, column: string, definition: string): Promise<void> {
  try {
    const tableExists = await db.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?", args: [table] })
    if (tableExists.rows.length === 0) return

    const info = await db.execute(`PRAGMA table_info(${table})`)
    if (!info.rows.some(c => c.name === column)) {
      getLoggingService().info('[DatabaseMigration]', `Adding missing column ${column} to ${table}`)
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  } catch (error) {
    const msg = getErrorMessage(error)
    getLoggingService().error('[DatabaseMigration]', `Failed to ensure column ${table}.${column}: ${msg}`)
    if (!msg.includes('duplicate column name')) throw error
  }
}

async function migrateCheckConstraints(db: Client): Promise<void> {
  try {
    const res = await db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_sources'")
    const schemaRow = res.rows[0] as unknown as { sql: string } | undefined
    
    if (schemaRow?.sql && !schemaRow.sql.includes('kodi-mysql')) {
      const tableNames = ['media_sources', 'media_items', 'music_artists', 'music_albums', 'music_tracks']
      await db.execute('PRAGMA writable_schema = ON')
      try {
        for (const table of tableNames) {
          await db.execute({
            sql: `UPDATE sqlite_master SET sql = replace(sql, '''kodi-local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = ?`,
            args: [table]
          })
          await db.execute({
            sql: `UPDATE sqlite_master SET sql = replace(sql, '''kodi-local'', ''local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = ?`,
            args: [table]
          })
        }
      } finally {
        await db.execute('PRAGMA writable_schema = OFF')
      }
    }
  } catch (error) {
    getLoggingService().debug('[DatabaseMigration]', 'CHECK migration note: ' + getErrorMessage(error))
  }
}

async function createIndexes(db: Client): Promise<void> {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_media_items_tmdb_id ON media_items(tmdb_id) WHERE tmdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_media_items_imdb_id ON media_items(imdb_id) WHERE imdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_media_items_year ON media_items(year) WHERE year IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_series_completeness_tmdb_id ON series_completeness(tmdb_id) WHERE tmdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_music_albums_type ON music_albums(album_type) WHERE album_type IS NOT NULL'
  ]
  for (const idx of indexes) {
    try { await db.execute(idx) } 
    catch (e) { getLoggingService().debug('[DatabaseMigration]', 'Index creation note: ' + getErrorMessage(e)) }
  }
}

async function fixMusicTrackAlbumReferences(db: Client): Promise<void> {
  try {
    await db.execute(`
      UPDATE music_tracks SET album_id = (
        SELECT a.id FROM music_albums a
        WHERE a.title = music_tracks.album_name
          AND a.artist_name = music_tracks.artist_name
          AND a.source_id = music_tracks.source_id
        LIMIT 1
      )
      WHERE album_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM music_albums a WHERE a.id = music_tracks.album_id
      )
    `)
  } catch (error) {
    getLoggingService().debug('[DatabaseMigration]', 'Music track reference fix note: ' + getErrorMessage(error))
  }
}

async function migrateExistingItemsToVersions(db: Client): Promise<void> {
  try {
    const res = await db.execute('SELECT COUNT(*) as count FROM media_item_versions')
    if ((res.rows[0]?.count as number) > 0) return

    await db.execute(`
      INSERT INTO media_item_versions (
        media_item_id, version_source, file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate, is_best
      )
      SELECT id, 'primary', file_path, file_size, duration, resolution, width, height, video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate, 1
      FROM media_items
    `)
  } catch (error) {
    getLoggingService().debug('[DatabaseMigration]', 'Version migration note: ' + getErrorMessage(error))
  }
}

async function cleanupOrphanedRecords(db: Client): Promise<void> {
  try {
    await db.execute('BEGIN IMMEDIATE')
    try {
        await db.execute('DELETE FROM quality_scores WHERE media_item_id NOT IN (SELECT id FROM media_items)')
        await db.execute('DELETE FROM media_item_versions WHERE media_item_id NOT IN (SELECT id FROM media_items)')
        await db.execute('DELETE FROM media_item_collections WHERE media_item_id NOT IN (SELECT id FROM media_items)')
        await db.execute(`DELETE FROM series_completeness
          WHERE library_id = ''
            AND source_id <> ''
            AND NOT EXISTS (
              SELECT 1 FROM media_items
              WHERE media_items.type = 'episode'
                AND media_items.source_id = series_completeness.source_id
                AND COALESCE(media_items.library_id, '') = ''
                AND media_items.series_title = series_completeness.series_title
            )`)
        await db.execute('COMMIT')
    } catch(err) {
      await db.execute('ROLLBACK')
      throw err
    }
  } catch (e) {
    getLoggingService().error('[DatabaseMigration]', 'Cleanup error: ' + getErrorMessage(e))
  }
}

export async function mergeDuplicateSeriesCompleteness(db: Client): Promise<void> {
  getLoggingService().debug('[DatabaseMigration]', 'Checking for duplicate TV show records...')
  const parser = getFileNameParser()

  try {
    const allRowsResult = await db.execute('SELECT * FROM series_completeness')
    const rows = allRowsResult.rows as unknown as Array<{
      id: number
      series_title: string
      series_identity_key: string | null
      source_id: string
      library_id: string
      total_seasons: number
      total_episodes: number
      owned_seasons: number
      owned_episodes: number
      missing_seasons: string
      missing_episodes: string
      completeness_percentage: number
      tmdb_id: string | null
      tvdb_id: string | null
      poster_url: string | null
      backdrop_url: string | null
      status: string | null
      user_fixed_match: number | null
      efficiency_score: number | null
      storage_debt_bytes: number | null
      total_size: number | null
      created_at: string
      updated_at: string
    }>

    if (!rows || rows.length <= 1) {
      await ensureSeriesUniquenessIndexes(db)
      return
    }

    // Group by (source_id, library_id)
    const scopedGroups = new Map<string, typeof rows>()
    for (const row of rows) {
      const scope = `${row.source_id || ''}:::${row.library_id || ''}`
      if (!scopedGroups.has(scope)) scopedGroups.set(scope, [])
      scopedGroups.get(scope)!.push(row)
    }

    for (const [scope, scopeRows] of scopedGroups.entries()) {
      const [sourceId, libraryId] = scope.split(':::')
      // Cluster rows by matching tvdb_id, tmdb_id, series_identity_key, or normalizedTitle
      const clusters: Array<typeof rows> = []
      const visited = new Set<number>()

      for (let i = 0; i < scopeRows.length; i++) {
        const a = scopeRows[i]
        if (visited.has(a.id)) continue

        const cluster: typeof rows = [a]
        visited.add(a.id)

        const normA = parser.normalizeSeriesTitle(a.series_title)
        const cleanA = parser.cleanSeriesTitleAndYear(a.series_title)

        for (let j = i + 1; j < scopeRows.length; j++) {
          const b = scopeRows[j]
          if (visited.has(b.id)) continue

          const normB = parser.normalizeSeriesTitle(b.series_title)
          const cleanB = parser.cleanSeriesTitleAndYear(b.series_title)

          const matchTvdb = a.tvdb_id && b.tvdb_id && a.tvdb_id === b.tvdb_id
          const matchTmdb = a.tmdb_id && b.tmdb_id && a.tmdb_id === b.tmdb_id
          const matchIdentityKey = a.series_identity_key && b.series_identity_key && a.series_identity_key === b.series_identity_key
          const matchNormTitle = normA && normB && normA === normB
          const matchCleanTitleAndYear = cleanA.title && cleanB.title && cleanA.title.toLowerCase() === cleanB.title.toLowerCase() && (cleanA.year === cleanB.year || !cleanA.year || !cleanB.year)

          if (matchTvdb || matchTmdb || matchIdentityKey || (matchNormTitle && matchCleanTitleAndYear)) {
            cluster.push(b)
            visited.add(b.id)
          }
        }

        if (cluster.length > 1) {
          clusters.push(cluster)
        }
      }

      // Merge each cluster with > 1 show
      for (const cluster of clusters) {
        // Priority: user_fixed_match = 1, has external ID (tmdb/tvdb), highest owned_episodes, lowest id (oldest)
        cluster.sort((x, y) => {
          const xFixed = (x.user_fixed_match || 0) === 1 ? 1 : 0
          const yFixed = (y.user_fixed_match || 0) === 1 ? 1 : 0
          if (xFixed !== yFixed) return yFixed - xFixed

          const xHasExt = (x.tmdb_id || x.tvdb_id) ? 1 : 0
          const yHasExt = (y.tmdb_id || y.tvdb_id) ? 1 : 0
          if (xHasExt !== yHasExt) return yHasExt - xHasExt

          const xEpisodes = x.owned_episodes || 0
          const yEpisodes = y.owned_episodes || 0
          if (xEpisodes !== yEpisodes) return yEpisodes - xEpisodes

          return x.id - y.id
        })

        const primary = cluster[0]
        const secondaryRows = cluster.slice(1)
        const secondaryIds = secondaryRows.map(r => r.id)

        // Merge attributes
        const mergedTmdbId = primary.tmdb_id || cluster.find(r => r.tmdb_id)?.tmdb_id || null
        const mergedTvdbId = primary.tvdb_id || cluster.find(r => r.tvdb_id)?.tvdb_id || null
        const mergedPosterUrl = primary.poster_url ?? cluster.find(r => r.poster_url)?.poster_url ?? null
        const mergedBackdropUrl = primary.backdrop_url ?? cluster.find(r => r.backdrop_url)?.backdrop_url ?? null
        const mergedStatus = primary.status || cluster.find(r => r.status)?.status || 'Continuing'
        const mergedUserFixed = cluster.some(r => r.user_fixed_match === 1) ? 1 : 0

        // Compute canonical series identity key
        const canonicalKey = deriveSeriesIdentityKey({
          sourceId,
          libraryId,
          folderRelativePath: primary.series_title,
          tmdbId: mergedTmdbId,
          tvdbId: mergedTvdbId,
        })

        // Cleaned series title
        const cleanTitle = parser.cleanSeriesTitleAndYear(primary.series_title).title || primary.series_title

        await db.execute('BEGIN IMMEDIATE')
        try {
          // 1. Repoint media_items from all duplicate rows to canonical
          for (const sec of secondaryRows) {
            await db.execute({
              sql: `UPDATE media_items
                    SET series_identity_key = ?, series_title = ?, series_tmdb_id = COALESCE(?, series_tmdb_id)
                    WHERE type = 'episode' AND source_id = ? AND (library_id = ? OR library_id IS NULL OR library_id = '')
                      AND (series_identity_key = ? OR series_title = ?)`,
              args: [canonicalKey, cleanTitle, mergedTmdbId, sourceId, libraryId, sec.series_identity_key || '', sec.series_title]
            })
          }
          await db.execute({
            sql: `UPDATE media_items
                  SET series_identity_key = ?, series_title = ?, series_tmdb_id = COALESCE(?, series_tmdb_id)
                  WHERE type = 'episode' AND source_id = ? AND (library_id = ? OR library_id IS NULL OR library_id = '')
                    AND (series_identity_key = ? OR series_title = ?)`,
            args: [canonicalKey, cleanTitle, mergedTmdbId, sourceId, libraryId, primary.series_identity_key || '', primary.series_title]
          })

          // 2. Repoint media_identities and media_aliases
          for (const secId of secondaryIds) {
            await db.execute({
              sql: `UPDATE OR IGNORE media_identities SET entity_id = ? WHERE entity_type = 'series' AND entity_id = ?`,
              args: [primary.id, secId]
            })
            await db.execute({
              sql: `DELETE FROM media_identities WHERE entity_type = 'series' AND entity_id = ?`,
              args: [secId]
            })
            await db.execute({
              sql: `UPDATE OR IGNORE media_aliases SET entity_id = ? WHERE entity_type = 'series' AND entity_id = ?`,
              args: [primary.id, secId]
            })
            await db.execute({
              sql: `DELETE FROM media_aliases WHERE entity_type = 'series' AND entity_id = ?`,
              args: [secId]
            })
          }

          // 3. Compute aggregate stats from media_items for canonical row
          const epStatsRes = await db.execute({
            sql: `SELECT
                    COUNT(DISTINCT season_number) as owned_seasons,
                    COUNT(*) as owned_episodes,
                    TOTAL(file_size) as total_size,
                    TOTAL(storage_debt_bytes) as storage_debt_bytes,
                    AVG(CASE WHEN efficiency_score > 0 THEN efficiency_score ELSE NULL END) as avg_efficiency
                  FROM media_items
                  WHERE type = 'episode' AND source_id = ? AND (library_id = ? OR library_id IS NULL OR library_id = '')
                    AND series_identity_key = ?`,
            args: [sourceId, libraryId, canonicalKey]
          })
          const epStats = epStatsRes.rows[0] as unknown as {
            owned_seasons: number
            owned_episodes: number
            total_size: number
            storage_debt_bytes: number
            avg_efficiency: number | null
          }

          const totalEpisodes = Math.max(primary.total_episodes || 0, Number(epStats?.owned_episodes || 0))
          const totalSeasons = Math.max(primary.total_seasons || 0, Number(epStats?.owned_seasons || 0))
          const ownedEpisodes = Number(epStats?.owned_episodes || primary.owned_episodes || 0)
          const ownedSeasons = Number(epStats?.owned_seasons || primary.owned_seasons || 0)
          const completenessPct = totalEpisodes > 0 ? (ownedEpisodes / totalEpisodes) * 100 : (primary.completeness_percentage || 100)

          // 4. Update primary row
          await db.execute({
            sql: `UPDATE series_completeness
                  SET series_title = ?, series_identity_key = ?, tmdb_id = ?, tvdb_id = ?,
                      poster_url = ?, backdrop_url = ?, status = ?, user_fixed_match = ?,
                      total_seasons = ?, total_episodes = ?, owned_seasons = ?, owned_episodes = ?,
                      completeness_percentage = ?, total_size = ?, storage_debt_bytes = ?,
                      efficiency_score = ?, updated_at = datetime('now')
                  WHERE id = ?`,
            args: [
              cleanTitle,
              canonicalKey,
              mergedTmdbId,
              mergedTvdbId,
              mergedPosterUrl,
              mergedBackdropUrl,
              mergedStatus,
              mergedUserFixed,
              totalSeasons,
              totalEpisodes,
              ownedSeasons,
              ownedEpisodes,
              completenessPct,
              Math.round(Number(epStats?.total_size || primary.total_size || 0)),
              Math.round(Number(epStats?.storage_debt_bytes || primary.storage_debt_bytes || 0)),
              Math.round(Number(epStats?.avg_efficiency || primary.efficiency_score || 0)),
              primary.id
            ]
          })

          // 5. Delete secondary rows
          for (const secId of secondaryIds) {
            await db.execute({
              sql: `DELETE FROM series_completeness WHERE id = ?`,
              args: [secId]
            })
          }

          await db.execute('COMMIT')
          getLoggingService().info('[DatabaseMigration]', `Merged ${cluster.length} duplicate TV show records into canonical ID ${primary.id} ("${cleanTitle}")`)
        } catch (err) {
          await db.execute('ROLLBACK')
          getLoggingService().error('[DatabaseMigration]', `Failed to merge duplicate cluster for "${primary.series_title}": ${getErrorMessage(err)}`)
        }
      }
    }
  } catch (error) {
    getLoggingService().error('[DatabaseMigration]', `Error in mergeDuplicateSeriesCompleteness: ${getErrorMessage(error)}`)
  }

  await ensureSeriesUniquenessIndexes(db)
}

async function ensureSeriesUniquenessIndexes(db: Client): Promise<void> {
  const indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_unique ON series_completeness(series_identity_key, source_id, library_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_tvdb ON series_completeness(source_id, library_id, tvdb_id) WHERE tvdb_id IS NOT NULL AND tvdb_id != ""',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_tmdb ON series_completeness(source_id, library_id, tmdb_id) WHERE tmdb_id IS NOT NULL AND tmdb_id != ""'
  ]
  for (const idx of indexes) {
    try {
      await db.execute(idx)
    } catch (e) {
      getLoggingService().debug('[DatabaseMigration]', 'Unique index creation note: ' + getErrorMessage(e))
    }
  }
}
