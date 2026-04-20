/**
 * Database Migration Utility
 *
 * Handles transition to better-sqlite3 and schema updates.
 */

import { DatabaseSync } from 'node:sqlite'
import { getLoggingService } from '../services/LoggingService'
import { DATABASE_SCHEMA } from './schema'
import { getErrorMessage } from '../services/utils/errorUtils'

/**
 * Run database migrations and schema updates
 */
export function runMigrations(db: DatabaseSync): void {
  getLoggingService().info('[DatabaseMigration]', 'Starting migrations...')

  // 1. Execute main schema
  // This creates all tables if they don't exist. 
  // We ignore errors here because existing tables with schema mismatches will throw,
  // but we fix those in the next step.
  try {
    db.exec(DATABASE_SCHEMA)
    getLoggingService().debug('[DatabaseMigration]', 'Baseline schema applied/verified')
  } catch (error) {
    getLoggingService().debug('[DatabaseMigration]', 'Initial schema execution note (expected on existing DB): ' + getErrorMessage(error))
  }

  // 2. Incremental column updates
  // We explicitly check for each critical column to handle the 0.4.0 -> 0.4.3 jump.
  
  // Quality Scores (Video)
  ensureColumn(db, 'quality_scores', 'quality_tier', "TEXT NOT NULL DEFAULT 'SD'")
  ensureColumn(db, 'quality_scores', 'tier_quality', "TEXT NOT NULL DEFAULT 'MEDIUM'")
  ensureColumn(db, 'quality_scores', 'tier_score', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'quality_scores', 'bitrate_tier_score', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'quality_scores', 'audio_tier_score', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'quality_scores', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'quality_scores', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')

  // Media Items
  ensureColumn(db, 'media_items', 'source_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'media_items', 'source_type', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'media_items', 'library_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'media_items', 'episode_thumb_url', 'TEXT')
  ensureColumn(db, 'media_items', 'season_poster_url', 'TEXT')
  ensureColumn(db, 'media_items', 'video_frame_rate', 'REAL')
  ensureColumn(db, 'media_items', 'color_bit_depth', 'INTEGER')
  ensureColumn(db, 'media_items', 'hdr_format', 'TEXT')
  ensureColumn(db, 'media_items', 'color_space', 'TEXT')
  ensureColumn(db, 'media_items', 'video_profile', 'TEXT')
  ensureColumn(db, 'media_items', 'video_level', 'INTEGER')
  ensureColumn(db, 'media_items', 'audio_profile', 'TEXT')
  ensureColumn(db, 'media_items', 'audio_sample_rate', 'INTEGER')
  ensureColumn(db, 'media_items', 'has_object_audio', 'INTEGER DEFAULT 0')
  ensureColumn(db, 'media_items', 'container', 'TEXT')
  ensureColumn(db, 'media_items', 'series_tmdb_id', 'TEXT')
  ensureColumn(db, 'media_items', 'user_fixed_match', 'INTEGER DEFAULT 0')
  ensureColumn(db, 'media_items', 'audio_tracks', 'TEXT')
  ensureColumn(db, 'media_items', 'file_mtime', 'INTEGER')
  ensureColumn(db, 'media_items', 'original_language', 'TEXT')
  ensureColumn(db, 'media_items', 'audio_language', 'TEXT')
  ensureColumn(db, 'media_items', 'subtitle_tracks', 'TEXT')
  ensureColumn(db, 'media_items', 'sort_title', 'TEXT')
  ensureColumn(db, 'media_items', 'version_count', 'INTEGER NOT NULL DEFAULT 1')
  ensureColumn(db, 'media_items', 'summary', 'TEXT')

  // Series Completeness
  ensureColumn(db, 'series_completeness', 'tmdb_id', 'TEXT')
  ensureColumn(db, 'series_completeness', 'poster_url', 'TEXT')
  ensureColumn(db, 'series_completeness', 'backdrop_url', 'TEXT')
  ensureColumn(db, 'series_completeness', 'status', 'TEXT')
  ensureColumn(db, 'series_completeness', 'source_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'series_completeness', 'library_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'series_completeness', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'series_completeness', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'series_completeness', 'total_size', 'INTEGER NOT NULL DEFAULT 0')

  // Movie Collections
  ensureColumn(db, 'movie_collections', 'source_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'movie_collections', 'library_id', "TEXT NOT NULL DEFAULT ''")

  // Music Tables
  ensureColumn(db, 'music_artists', 'library_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'music_artists', 'user_fixed_match', 'INTEGER DEFAULT 0')
  ensureColumn(db, 'music_albums', 'library_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'music_albums', 'user_fixed_match', 'INTEGER DEFAULT 0')
  ensureColumn(db, 'music_tracks', 'library_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'music_tracks', 'file_mtime', 'INTEGER')

  // Artist & Album Completeness
  ensureColumn(db, 'artist_completeness', 'library_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'artist_completeness', 'total_size', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'artist_completeness', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'artist_completeness', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'album_completeness', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'album_completeness', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'album_completeness', 'total_size', 'INTEGER NOT NULL DEFAULT 0')

  // Music Quality Scores
  ensureColumn(db, 'music_quality_scores', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'music_quality_scores', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')

  // Per-version enhancements
  ensureColumn(db, 'media_item_versions', 'original_language', 'TEXT')
  ensureColumn(db, 'media_item_versions', 'audio_language', 'TEXT')
  ensureColumn(db, 'media_item_versions', 'efficiency_score', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'media_item_versions', 'storage_debt_bytes', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'media_item_versions', 'bitrate_tier_score', 'INTEGER DEFAULT 0')
  ensureColumn(db, 'media_item_versions', 'audio_tier_score', 'INTEGER DEFAULT 0')

  // Wishlist
  ensureColumn(db, 'wishlist_items', 'reason', "TEXT DEFAULT 'missing'")
  ensureColumn(db, 'wishlist_items', 'current_quality_tier', 'TEXT')
  ensureColumn(db, 'wishlist_items', 'current_quality_level', 'TEXT')
  ensureColumn(db, 'wishlist_items', 'current_resolution', 'TEXT')
  ensureColumn(db, 'wishlist_items', 'current_video_codec', 'TEXT')
  ensureColumn(db, 'wishlist_items', 'current_audio_codec', 'TEXT')
  ensureColumn(db, 'wishlist_items', 'media_item_id', 'INTEGER')
  ensureColumn(db, 'wishlist_items', 'status', "TEXT DEFAULT 'active'")
  ensureColumn(db, 'wishlist_items', 'completed_at', 'TEXT')

  // Library scans
  ensureColumn(db, 'library_scans', 'is_enabled', 'INTEGER NOT NULL DEFAULT 1')

  // 3. Post-column complex migrations
  migrateCheckConstraints(db)
  createIndexes(db)
  fixMusicTrackAlbumReferences(db)
  migrateExistingItemsToVersions(db)
  cleanupOrphanedRecords(db)

  getLoggingService().info('[DatabaseMigration]', 'Migrations completed successfully')
}

/**
 * Ensures a column exists in a table, adding it if missing.
 */
function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  try {
    // Check if table exists first
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
    if (!tableExists) return

    const info = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
    if (!info.some(c => c.name === column)) {
      getLoggingService().info('[DatabaseMigration]', `Adding missing column ${column} to ${table}`)
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  } catch (error) {
    const msg = getErrorMessage(error)
    getLoggingService().error('[DatabaseMigration]', `Failed to ensure column ${table}.${column}: ${msg}`)
    // If it's a critical error (not just duplicate column), we should probably know
    if (!msg.includes('duplicate column name')) {
      throw error
    }
  }
}

function migrateCheckConstraints(db: DatabaseSync): void {
  try {
    const schemaRow = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='media_sources'"
    ).get() as { sql: string } | undefined
    
    if (schemaRow?.sql && !schemaRow.sql.includes('kodi-mysql')) {
      const tableNames = ['media_sources', 'media_items', 'music_artists', 'music_albums', 'music_tracks']
      db.exec('PRAGMA writable_schema = ON')
      try {
        for (const table of tableNames) {
          db.prepare(
            `UPDATE sqlite_master SET sql = replace(sql, '''kodi-local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = ?`
          ).run(table)
          db.prepare(
            `UPDATE sqlite_master SET sql = replace(sql, '''kodi-local'', ''local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = ?`
          ).run(table)
        }
      } finally {
        db.exec('PRAGMA writable_schema = OFF')
      }
    }
  } catch (error) {
    getLoggingService().debug('[DatabaseMigration]', 'CHECK migration note: ' + getErrorMessage(error))
  }
}

function createIndexes(db: DatabaseSync): void {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_media_items_tmdb_id ON media_items(tmdb_id) WHERE tmdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_media_items_imdb_id ON media_items(imdb_id) WHERE imdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_media_items_year ON media_items(year) WHERE year IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_series_completeness_tmdb_id ON series_completeness(tmdb_id) WHERE tmdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_music_albums_type ON music_albums(album_type) WHERE album_type IS NOT NULL'
  ]
  for (const idx of indexes) {
    try { 
      db.exec(idx) 
    } catch (e) { 
      getLoggingService().debug('[DatabaseMigration]', 'Index creation note: ' + getErrorMessage(e))
    }
  }
}

function fixMusicTrackAlbumReferences(db: DatabaseSync): void {
  try {
    db.exec(`
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

function migrateExistingItemsToVersions(db: DatabaseSync): void {
  try {
    const count = (db.prepare('SELECT COUNT(*) as count FROM media_item_versions').get() as any).count
    if (count > 0) return

    db.exec(`
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

function cleanupOrphanedRecords(db: DatabaseSync): void {
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM quality_scores WHERE media_item_id NOT IN (SELECT id FROM media_items)').run()
      db.prepare('DELETE FROM media_item_versions WHERE media_item_id NOT IN (SELECT id FROM media_items)').run()
      db.prepare('DELETE FROM media_item_collections WHERE media_item_id NOT IN (SELECT id FROM media_items)').run()
      db.exec('COMMIT')
    } catch(err) {
      db.exec('ROLLBACK')
      throw err
    }
  } catch (e) {
    getLoggingService().error('[DatabaseMigration]', 'Cleanup error: ' + getErrorMessage(e))
  }
}
