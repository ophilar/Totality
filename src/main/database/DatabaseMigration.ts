/**
 * Database Migration Utility
 *
 * Handles transition to better-sqlite3 and schema updates.
 */

import Database from 'better-sqlite3'
import { getLoggingService } from '../services/LoggingService'
import { DATABASE_SCHEMA } from './schema'
import { getErrorMessage } from '../services/utils/errorUtils'

/**
 * Run database migrations and schema updates
 */
export function runMigrations(db: Database.Database): void {
  // Execute main schema
  db.exec(DATABASE_SCHEMA)

  // List of ALTER TABLE statements for incremental updates
  const alterStatements = [
    // Quality scores tier columns
    "ALTER TABLE quality_scores ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'SD'",
    "ALTER TABLE quality_scores ADD COLUMN tier_quality TEXT NOT NULL DEFAULT 'MEDIUM'",
    'ALTER TABLE quality_scores ADD COLUMN tier_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE quality_scores ADD COLUMN bitrate_tier_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE quality_scores ADD COLUMN audio_tier_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE quality_scores ADD COLUMN efficiency_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE quality_scores ADD COLUMN storage_debt_bytes INTEGER NOT NULL DEFAULT 0',

    // Media items enhancements
    'ALTER TABLE media_items ADD COLUMN episode_thumb_url TEXT',
    'ALTER TABLE media_items ADD COLUMN season_poster_url TEXT',
    'ALTER TABLE media_items ADD COLUMN video_frame_rate REAL',
    'ALTER TABLE media_items ADD COLUMN color_bit_depth INTEGER',
    'ALTER TABLE media_items ADD COLUMN hdr_format TEXT',
    'ALTER TABLE media_items ADD COLUMN color_space TEXT',
    'ALTER TABLE media_items ADD COLUMN video_profile TEXT',
    'ALTER TABLE media_items ADD COLUMN video_level INTEGER',
    'ALTER TABLE media_items ADD COLUMN audio_profile TEXT',
    'ALTER TABLE media_items ADD COLUMN audio_sample_rate INTEGER',
    'ALTER TABLE media_items ADD COLUMN has_object_audio INTEGER DEFAULT 0',
    'ALTER TABLE media_items ADD COLUMN container TEXT',
    'ALTER TABLE media_items ADD COLUMN series_tmdb_id TEXT',
    'ALTER TABLE media_items ADD COLUMN user_fixed_match INTEGER DEFAULT 0',
    'ALTER TABLE media_items ADD COLUMN audio_tracks TEXT',
    'ALTER TABLE media_items ADD COLUMN file_mtime INTEGER',
    "ALTER TABLE media_items ADD COLUMN source_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE media_items ADD COLUMN source_type TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE media_items ADD COLUMN library_id TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE media_items ADD COLUMN original_language TEXT',
    'ALTER TABLE media_items ADD COLUMN audio_language TEXT',
    'ALTER TABLE media_items ADD COLUMN subtitle_tracks TEXT',
    'ALTER TABLE media_items ADD COLUMN sort_title TEXT',
    'ALTER TABLE media_items ADD COLUMN version_count INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE media_items ADD COLUMN summary TEXT',

    // Series completeness
    'ALTER TABLE series_completeness ADD COLUMN tmdb_id TEXT',
    'ALTER TABLE series_completeness ADD COLUMN poster_url TEXT',
    'ALTER TABLE series_completeness ADD COLUMN backdrop_url TEXT',
    'ALTER TABLE series_completeness ADD COLUMN status TEXT',
    "ALTER TABLE series_completeness ADD COLUMN source_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE series_completeness ADD COLUMN library_id TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE series_completeness ADD COLUMN efficiency_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE series_completeness ADD COLUMN storage_debt_bytes INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE series_completeness ADD COLUMN total_size INTEGER NOT NULL DEFAULT 0',

    // Movie collections
    "ALTER TABLE movie_collections ADD COLUMN source_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE movie_collections ADD COLUMN library_id TEXT NOT NULL DEFAULT ''",

    // Music tables
    "ALTER TABLE music_artists ADD COLUMN library_id TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE music_artists ADD COLUMN user_fixed_match INTEGER DEFAULT 0',
    "ALTER TABLE music_albums ADD COLUMN library_id TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE music_albums ADD COLUMN user_fixed_match INTEGER DEFAULT 0',
    "ALTER TABLE music_tracks ADD COLUMN library_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE artist_completeness ADD COLUMN library_id TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE artist_completeness ADD COLUMN total_size INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE artist_completeness ADD COLUMN efficiency_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE artist_completeness ADD COLUMN storage_debt_bytes INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE music_tracks ADD COLUMN file_mtime INTEGER',

    // Album completeness
    'ALTER TABLE album_completeness ADD COLUMN efficiency_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE album_completeness ADD COLUMN storage_debt_bytes INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE album_completeness ADD COLUMN total_size INTEGER NOT NULL DEFAULT 0',

    // Per-version enhancements
    'ALTER TABLE media_item_versions ADD COLUMN original_language TEXT',
    'ALTER TABLE media_item_versions ADD COLUMN audio_language TEXT',
    'ALTER TABLE media_item_versions ADD COLUMN efficiency_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE media_item_versions ADD COLUMN storage_debt_bytes INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE media_item_versions ADD COLUMN bitrate_tier_score INTEGER DEFAULT 0',
    'ALTER TABLE media_item_versions ADD COLUMN audio_tier_score INTEGER DEFAULT 0',

    // Wishlist
    "ALTER TABLE wishlist_items ADD COLUMN reason TEXT DEFAULT 'missing'",
    'ALTER TABLE wishlist_items ADD COLUMN current_quality_tier TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN current_quality_level TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN current_resolution TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN current_video_codec TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN current_audio_codec TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN media_item_id INTEGER',
    "ALTER TABLE wishlist_items ADD COLUMN status TEXT DEFAULT 'active'",
    'ALTER TABLE wishlist_items ADD COLUMN completed_at TEXT',

    // Library scans
    'ALTER TABLE library_scans ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1',
  ]

  for (const statement of alterStatements) {
    try {
      db.exec(statement)
    } catch (error: unknown) {
      const msg = getErrorMessage(error)
      if (!msg?.includes('duplicate column name')) {
        getLoggingService().debug('[DatabaseMigration]', `Migration note: ${msg}`)
      }
    }
  }

  // Handle CHECK constraint migrations (complex in SQLite)
  migrateCheckConstraints(db)

  // Create performance indexes
  createIndexes(db)

  // Functional fixes
  fixMusicTrackAlbumReferences(db)

  // Data migrations
  migrateExistingItemsToVersions(db)

  // Cleanup
  cleanupOrphanedRecords(db)

  getLoggingService().info('[DatabaseMigration]', 'Migrations completed successfully')
}

function migrateCheckConstraints(db: Database.Database): void {
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

function createIndexes(db: Database.Database): void {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_media_items_tmdb_id ON media_items(tmdb_id) WHERE tmdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_media_items_imdb_id ON media_items(imdb_id) WHERE imdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_media_items_year ON media_items(year) WHERE year IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_series_completeness_tmdb_id ON series_completeness(tmdb_id) WHERE tmdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_music_albums_type ON music_albums(album_type) WHERE album_type IS NOT NULL'
  ]
  for (const idx of indexes) {
    try { db.exec(idx) } catch { /* ignore */ }
  }
}

function fixMusicTrackAlbumReferences(db: Database.Database): void {
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

function migrateExistingItemsToVersions(db: Database.Database): void {
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

function cleanupOrphanedRecords(db: Database.Database): void {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM quality_scores WHERE media_item_id NOT IN (SELECT id FROM media_items)').run()
      db.prepare('DELETE FROM media_item_versions WHERE media_item_id NOT IN (SELECT id FROM media_items)').run()
      db.prepare('DELETE FROM media_item_collections WHERE media_item_id NOT IN (SELECT id FROM media_items)').run()
    })()
  } catch { /* ignore */ }
}
