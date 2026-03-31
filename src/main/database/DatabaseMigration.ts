/**
 * Database Migration Utility
 *
 * Handles:
 * 1. Migration from SQL.js to better-sqlite3.
 * 2. Incremental schema updates (ALTER TABLE).
 * 3. Performance indexing and data cleanup.
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import type { Database } from 'better-sqlite3'
import { getLoggingService } from '../services/LoggingService'
import { DATABASE_SCHEMA } from './schema'
import { getErrorMessage } from '../services/utils/errorUtils'

interface MigrationResult {
  success: boolean
  tablesExported: number
  rowsExported: number
  rowsImported: number
  errors: string[]
  backupPath?: string
}

// ============================================================================
// SQL.js to BetterSQLite3 Migration
// ============================================================================

/**
 * Check if migration from SQL.js to better-sqlite3 is needed
 */
export function needsMigration(): boolean {
  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')

  const sqlJsExists = fs.existsSync(sqlJsDbPath)
  const betterSqliteExists = fs.existsSync(betterSqliteDbPath)

  return sqlJsExists && !betterSqliteExists
}

/**
 * Check if we should use better-sqlite3 (either migrated or fresh install)
 */
export function shouldUseBetterSqlite(): boolean {
  if (process.env.USE_BETTER_SQLITE3 === 'true') return true

  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')

  const sqlJsExists = fs.existsSync(sqlJsDbPath)
  const betterSqliteExists = fs.existsSync(betterSqliteDbPath)

  if (betterSqliteExists || !sqlJsExists) return true
  return false
}

/**
 * Migrate data from SQL.js to better-sqlite3
 */
export async function migrateDatabase(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    tablesExported: 0,
    rowsExported: 0,
    rowsImported: 0,
    errors: [],
  }

  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')
  const backupPath = path.join(userDataPath, 'totality.db.backup')

  try {
    getLoggingService().info('[Migration]', 'Starting database migration from SQL.js to better-sqlite3...')

    const { getDatabaseService } = await import('../services/DatabaseService')
    const sqlJsDb = getDatabaseService()
    await sqlJsDb.initialize()

    const exportedData = sqlJsDb.exportData()
    for (const [table, rows] of Object.entries(exportedData)) {
      if (table !== '_meta' && Array.isArray(rows)) {
        result.tablesExported++
        result.rowsExported += rows.length
      }
    }

    await sqlJsDb.close()

    const { getBetterSQLiteService } = await import('./BetterSQLiteService')
    const betterDb = getBetterSQLiteService()
    betterDb.initialize()

    const importResult = betterDb.importData(exportedData)
    result.rowsImported = importResult.imported
    result.errors.push(...importResult.errors)

    const verification = verifyMigration(exportedData, betterDb)
    if (!verification.success) {
      result.errors.push(...verification.errors)
      throw new Error('Migration verification failed')
    }

    fs.copyFileSync(sqlJsDbPath, backupPath)
    result.backupPath = backupPath
    result.success = true
    console.log('[Migration] Database migration completed successfully!')

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.errors.push(`Migration failed: ${message}`)
    if (fs.existsSync(betterSqliteDbPath)) {
      try { fs.unlinkSync(betterSqliteDbPath) } catch { /* ignore */ }
    }
  }

  return result
}

function verifyMigration(
  exportedData: Record<string, unknown[]>,
  betterDb: any
): { success: boolean; errors: string[] } {
  const errors: string[] = []
  try {
    const exportedItems = (exportedData['media_items'] as unknown[])?.length || 0
    const importedItems = betterDb.getMediaItems().length
    if (exportedItems !== importedItems) errors.push(`Media items mismatch: exported ${exportedItems}, imported ${importedItems}`)
    
    const exportedSources = (exportedData['media_sources'] as unknown[])?.length || 0
    const importedSources = betterDb.getMediaSources().length
    if (exportedSources !== importedSources) errors.push(`Media sources mismatch: exported ${exportedSources}, imported ${importedSources}`)
  } catch (error) {
    errors.push(`Verification error: ${getErrorMessage(error)}`)
  }
  return { success: errors.length === 0, errors }
}

export function rollbackMigration(): boolean {
  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')
  const backupPath = path.join(userDataPath, 'totality.db.backup')

  try {
    if (fs.existsSync(betterSqliteDbPath)) fs.unlinkSync(betterSqliteDbPath)
    if (fs.existsSync(backupPath) && !fs.existsSync(sqlJsDbPath)) fs.copyFileSync(backupPath, sqlJsDbPath)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Schema Migrations (Incremental)
// ============================================================================

/**
 * Run database migrations and schema updates
 */
export function runMigrations(db: Database): void {
  // Execute main schema
  db.exec(DATABASE_SCHEMA)

  // List of ALTER TABLE statements for incremental updates
  const alterStatements = [
    "ALTER TABLE quality_scores ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'SD'",
    "ALTER TABLE quality_scores ADD COLUMN tier_quality TEXT NOT NULL DEFAULT 'MEDIUM'",
    'ALTER TABLE quality_scores ADD COLUMN tier_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE quality_scores ADD COLUMN bitrate_tier_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE quality_scores ADD COLUMN audio_tier_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE quality_scores ADD COLUMN efficiency_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE quality_scores ADD COLUMN storage_debt_bytes INTEGER NOT NULL DEFAULT 0',

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

    'ALTER TABLE series_completeness ADD COLUMN tmdb_id TEXT',
    'ALTER TABLE series_completeness ADD COLUMN poster_url TEXT',
    'ALTER TABLE series_completeness ADD COLUMN backdrop_url TEXT',
    'ALTER TABLE series_completeness ADD COLUMN status TEXT',
    "ALTER TABLE series_completeness ADD COLUMN source_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE series_completeness ADD COLUMN library_id TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE series_completeness ADD COLUMN efficiency_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE series_completeness ADD COLUMN storage_debt_bytes INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE series_completeness ADD COLUMN total_size INTEGER NOT NULL DEFAULT 0',

    "ALTER TABLE movie_collections ADD COLUMN source_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE movie_collections ADD COLUMN library_id TEXT NOT NULL DEFAULT ''",

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

    'ALTER TABLE album_completeness ADD COLUMN efficiency_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE album_completeness ADD COLUMN storage_debt_bytes INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE album_completeness ADD COLUMN total_size INTEGER NOT NULL DEFAULT 0',

    'ALTER TABLE media_item_versions ADD COLUMN original_language TEXT',
    'ALTER TABLE media_item_versions ADD COLUMN audio_language TEXT',
    'ALTER TABLE media_item_versions ADD COLUMN efficiency_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE media_item_versions ADD COLUMN storage_debt_bytes INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE media_item_versions ADD COLUMN bitrate_tier_score INTEGER DEFAULT 0',
    'ALTER TABLE media_item_versions ADD COLUMN audio_tier_score INTEGER DEFAULT 0',

    "ALTER TABLE wishlist_items ADD COLUMN reason TEXT DEFAULT 'missing'",
    'ALTER TABLE wishlist_items ADD COLUMN current_quality_tier TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN current_quality_level TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN current_resolution TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN current_video_codec TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN current_audio_codec TEXT',
    'ALTER TABLE wishlist_items ADD COLUMN media_item_id INTEGER',
    "ALTER TABLE wishlist_items ADD COLUMN status TEXT DEFAULT 'active'",
    'ALTER TABLE wishlist_items ADD COLUMN completed_at TEXT',

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

  migrateCheckConstraints(db)
  createIndexes(db)
  fixMusicTrackAlbumReferences(db)
  migrateExistingItemsToVersions(db)
  cleanupOrphanedRecords(db)

  getLoggingService().info('[DatabaseMigration]', 'Migrations completed successfully')
}

function migrateCheckConstraints(db: Database): void {
  try {
    const schemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_sources'").get() as { sql: string } | undefined
    if (schemaRow?.sql && !schemaRow.sql.includes('kodi-mysql')) {
      const tableNames = ['media_sources', 'media_items', 'music_artists', 'music_albums', 'music_tracks']
      db.exec('PRAGMA writable_schema = ON')
      try {
        for (const table of tableNames) {
          db.prepare(`UPDATE sqlite_master SET sql = replace(sql, '''kodi-local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = ?`).run(table)
          db.prepare(`UPDATE sqlite_master SET sql = replace(sql, '''kodi-local'', ''local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = ?`).run(table)
        }
      } finally { db.exec('PRAGMA writable_schema = OFF') }
    }
  } catch (error) { getLoggingService().debug('[DatabaseMigration]', 'CHECK migration note: ' + getErrorMessage(error)) }
}

function createIndexes(db: Database): void {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_media_items_tmdb_id ON media_items(tmdb_id) WHERE tmdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_media_items_imdb_id ON media_items(imdb_id) WHERE imdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_media_items_year ON media_items(year) WHERE year IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_series_completeness_tmdb_id ON series_completeness(tmdb_id) WHERE tmdb_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_music_albums_type ON music_albums(album_type) WHERE album_type IS NOT NULL'
  ]
  for (const idx of indexes) { try { db.exec(idx) } catch { /* ignore */ } }
}

function fixMusicTrackAlbumReferences(db: Database): void {
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
  } catch (error) { getLoggingService().debug('[DatabaseMigration]', 'Music track reference fix note: ' + getErrorMessage(error)) }
}

function migrateExistingItemsToVersions(db: Database): void {
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
  } catch (error) { getLoggingService().debug('[DatabaseMigration]', 'Version migration note: ' + getErrorMessage(error)) }
}

function cleanupOrphanedRecords(db: Database): void {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM quality_scores WHERE media_item_id NOT IN (SELECT id FROM media_items)').run()
      db.prepare('DELETE FROM media_item_versions WHERE media_item_id NOT IN (SELECT id FROM media_items)').run()
      db.prepare('DELETE FROM media_item_collections WHERE media_item_id NOT IN (SELECT id FROM media_items)').run()
    })()
  } catch { /* ignore */ }
}
