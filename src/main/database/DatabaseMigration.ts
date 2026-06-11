/**
 * Database Migration Utility
 *
 * Handles transition to better-sqlite3 and schema updates.
 */

import type { Client } from '@libsql/client'
import { getLoggingService } from '@main/services/LoggingService'
import { DATABASE_SCHEMA } from '@main/database/schema'
import { getErrorMessage } from '@main/services/utils/errorUtils'

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
  await ensureColumn(db, 'series_completeness', 'poster_url', 'TEXT')
  await ensureColumn(db, 'series_completeness', 'backdrop_url', 'TEXT')
  await ensureColumn(db, 'series_completeness', 'status', 'TEXT')
  await ensureColumn(db, 'series_completeness', 'user_fixed_match', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'series_completeness', 'source_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'series_completeness', 'library_id', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'series_completeness', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'series_completeness', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'series_completeness', 'total_size', 'INTEGER NOT NULL DEFAULT 0')

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

  getLoggingService().debug('[DatabaseMigration]', 'Running complex migrations...')
  await migrateCheckConstraints(db)
  await createIndexes(db)
  await fixMusicTrackAlbumReferences(db)
  await migrateExistingItemsToVersions(db)
  await cleanupOrphanedRecords(db)

  getLoggingService().info('[DatabaseMigration]', 'Migrations completed successfully')
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
      await db.execute('COMMIT')
    } catch(err) {
      await db.execute('ROLLBACK')
      throw err
    }
  } catch (e) {
    getLoggingService().error('[DatabaseMigration]', 'Cleanup error: ' + getErrorMessage(e))
  }
}
