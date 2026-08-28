/**
 * Database Migration Utility
 *
 * Handles transition to better-sqlite3 and schema updates.
 */
import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { TVShowRepository } from '@main/database/repositories/TVShowRepository'
import { getLoggingService } from '@main/services/LoggingService'
import { DATABASE_SCHEMA } from '@main/database/schema'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { isTimelineRecipeSummary, validateTimelineDefinition } from '@main/services/timelines/TimelineValidation'

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
  await ensureColumn(db, 'quality_scores', 'evidence_status', "TEXT NOT NULL DEFAULT 'insufficient'")
  await ensureColumn(db, 'quality_scores', 'confidence', "TEXT NOT NULL DEFAULT 'none'")
  await ensureColumn(db, 'quality_scores', 'savings_basis', "TEXT NOT NULL DEFAULT 'insufficient_data'")

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
  await ensureColumn(db, 'series_completeness', 'evidence_status', "TEXT NOT NULL DEFAULT 'insufficient'")
  await ensureColumn(db, 'series_completeness', 'confidence', "TEXT NOT NULL DEFAULT 'none'")
  await ensureColumn(db, 'series_completeness', 'savings_basis', "TEXT NOT NULL DEFAULT 'insufficient_data'")

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
  await ensureColumn(db, 'music_quality_scores', 'evidence_status', "TEXT NOT NULL DEFAULT 'insufficient'")
  await ensureColumn(db, 'music_quality_scores', 'confidence', "TEXT NOT NULL DEFAULT 'none'")
  await ensureColumn(db, 'music_quality_scores', 'savings_basis', "TEXT NOT NULL DEFAULT 'insufficient_data'")

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

  await migrateNullableEvidenceScores(db)

  getLoggingService().debug('[DatabaseMigration]', 'Running complex migrations...')
  await migrateCheckConstraints(db)
  await createIndexes(db)
  await fixMusicTrackAlbumReferences(db)
  await migrateExistingItemsToVersions(db)
  await cleanupOrphanedRecords(db)
  await backfillMediaIdentities(db)
  await mergeDuplicateSeriesCompleteness(db)
  await migrateStaleTimelineRecipes(db)

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

const EVIDENCE_COLUMNS = ['evidence_status', 'confidence', 'savings_basis'] as const

async function migrateNullableEvidenceScores(db: Client): Promise<void> {
  await rebuildQualityScoresForNullableEvidence(db)
  await rebuildMusicQualityScoresForNullableEvidence(db)
  await rebuildSeriesCompletenessForNullableEvidence(db)
  await markLegacyZeroScoresInsufficient(db)
}

async function hasNotNullColumn(db: Client, table: string, columns: readonly string[]): Promise<boolean> {
  const result = await db.execute(`PRAGMA table_info(${table})`)
  return result.rows.some(row => columns.includes(String(row.name)) && Number(row.notnull) === 1)
}

async function rebuildTableWhenNeeded(
  db: Client,
  table: string,
  nullableColumns: readonly string[],
  createSql: string,
  copyColumns: readonly string[],
  createSupportingObjects: readonly string[],
): Promise<void> {
  if (!await hasNotNullColumn(db, table, nullableColumns)) return

  const legacyTable = `${table}_legacy_nullable_evidence`
  getLoggingService().info('[DatabaseMigration]', `Rebuilding ${table} so evidence-based numeric fields can be NULL`)
  await db.execute('BEGIN IMMEDIATE')
  try {
    await db.execute(`ALTER TABLE ${table} RENAME TO ${legacyTable}`)
    await db.execute(createSql)
    await db.execute(`INSERT INTO ${table} (${copyColumns.join(', ')}) SELECT ${copyColumns.join(', ')} FROM ${legacyTable}`)
    await db.execute(`DROP TABLE ${legacyTable}`)
    for (const statement of createSupportingObjects) await db.execute(statement)
    await db.execute('COMMIT')
  } catch (error) {
    await db.execute('ROLLBACK')
    throw error
  }
}

async function rebuildQualityScoresForNullableEvidence(db: Client): Promise<void> {
  await rebuildTableWhenNeeded(
    db,
    'quality_scores',
    ['tier_score', 'bitrate_tier_score', 'audio_tier_score', 'overall_score', 'resolution_score', 'bitrate_score', 'audio_score', 'efficiency_score', 'storage_debt_bytes'],
    `CREATE TABLE quality_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_item_id INTEGER NOT NULL UNIQUE,
      quality_tier TEXT NOT NULL DEFAULT 'SD',
      tier_quality TEXT NOT NULL DEFAULT 'MEDIUM',
      tier_score INTEGER,
      bitrate_tier_score INTEGER,
      audio_tier_score INTEGER,
      overall_score INTEGER,
      resolution_score INTEGER,
      bitrate_score INTEGER,
      audio_score INTEGER,
      efficiency_score INTEGER,
      storage_debt_bytes INTEGER,
      evidence_status TEXT NOT NULL DEFAULT 'insufficient',
      confidence TEXT NOT NULL DEFAULT 'none',
      savings_basis TEXT NOT NULL DEFAULT 'insufficient_data',
      is_low_quality INTEGER NOT NULL,
      needs_upgrade INTEGER NOT NULL,
      issues TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
    )`,
    ['id', 'media_item_id', 'quality_tier', 'tier_quality', 'tier_score', 'bitrate_tier_score', 'audio_tier_score', 'overall_score', 'resolution_score', 'bitrate_score', 'audio_score', 'efficiency_score', 'storage_debt_bytes', ...EVIDENCE_COLUMNS, 'is_low_quality', 'needs_upgrade', 'issues', 'created_at', 'updated_at'],
    [
      `CREATE TRIGGER IF NOT EXISTS update_quality_scores_timestamp
       AFTER UPDATE ON quality_scores BEGIN
         UPDATE quality_scores SET updated_at = datetime('now') WHERE id = NEW.id;
       END`,
    ],
  )
}

async function rebuildMusicQualityScoresForNullableEvidence(db: Client): Promise<void> {
  await rebuildTableWhenNeeded(
    db,
    'music_quality_scores',
    ['tier_score', 'codec_score', 'bitrate_score', 'efficiency_score', 'storage_debt_bytes'],
    `CREATE TABLE music_quality_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL UNIQUE,
      quality_tier TEXT NOT NULL DEFAULT 'LOSSY_MID',
      tier_quality TEXT NOT NULL DEFAULT 'MEDIUM',
      tier_score INTEGER,
      codec_score INTEGER,
      bitrate_score INTEGER,
      efficiency_score INTEGER,
      storage_debt_bytes INTEGER,
      evidence_status TEXT NOT NULL DEFAULT 'insufficient',
      confidence TEXT NOT NULL DEFAULT 'none',
      savings_basis TEXT NOT NULL DEFAULT 'insufficient_data',
      needs_upgrade INTEGER NOT NULL,
      issues TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE CASCADE
    )`,
    ['id', 'album_id', 'quality_tier', 'tier_quality', 'tier_score', 'codec_score', 'bitrate_score', 'efficiency_score', 'storage_debt_bytes', ...EVIDENCE_COLUMNS, 'needs_upgrade', 'issues', 'created_at', 'updated_at'],
    [
      'CREATE INDEX IF NOT EXISTS idx_music_quality_scores_album ON music_quality_scores(album_id)',
      'CREATE INDEX IF NOT EXISTS idx_music_quality_scores_tier ON music_quality_scores(quality_tier)',
      'CREATE INDEX IF NOT EXISTS idx_music_quality_scores_upgrade ON music_quality_scores(needs_upgrade)',
      `CREATE TRIGGER IF NOT EXISTS update_music_quality_scores_timestamp
       AFTER UPDATE ON music_quality_scores BEGIN
         UPDATE music_quality_scores SET updated_at = datetime('now') WHERE id = NEW.id;
       END`,
    ],
  )
}

async function rebuildSeriesCompletenessForNullableEvidence(db: Client): Promise<void> {
  await rebuildTableWhenNeeded(
    db,
    'series_completeness',
    ['efficiency_score', 'storage_debt_bytes'],
    `CREATE TABLE series_completeness (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_title TEXT NOT NULL,
      series_identity_key TEXT,
      source_id TEXT NOT NULL DEFAULT '',
      library_id TEXT NOT NULL DEFAULT '',
      total_seasons INTEGER NOT NULL,
      total_episodes INTEGER NOT NULL,
      owned_seasons INTEGER NOT NULL,
      owned_episodes INTEGER NOT NULL,
      missing_seasons TEXT NOT NULL DEFAULT '[]',
      missing_episodes TEXT NOT NULL DEFAULT '[]',
      completeness_percentage REAL NOT NULL,
      tmdb_id TEXT,
      tvdb_id TEXT,
      poster_url TEXT,
      backdrop_url TEXT,
      status TEXT,
      user_fixed_match INTEGER,
      efficiency_score INTEGER,
      storage_debt_bytes INTEGER,
      evidence_status TEXT NOT NULL DEFAULT 'insufficient',
      confidence TEXT NOT NULL DEFAULT 'none',
      savings_basis TEXT NOT NULL DEFAULT 'insufficient_data',
      total_size INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    ['id', 'series_title', 'series_identity_key', 'source_id', 'library_id', 'total_seasons', 'total_episodes', 'owned_seasons', 'owned_episodes', 'missing_seasons', 'missing_episodes', 'completeness_percentage', 'tmdb_id', 'tvdb_id', 'poster_url', 'backdrop_url', 'status', 'user_fixed_match', 'efficiency_score', 'storage_debt_bytes', ...EVIDENCE_COLUMNS, 'total_size', 'created_at', 'updated_at'],
    [
      'CREATE INDEX IF NOT EXISTS idx_series_completeness_tmdb_id ON series_completeness(tmdb_id) WHERE tmdb_id IS NOT NULL',
      'CREATE INDEX IF NOT EXISTS idx_series_completeness_title ON series_completeness(series_title)',
      'CREATE INDEX IF NOT EXISTS idx_series_completeness_library ON series_completeness(source_id, library_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_unique ON series_completeness(series_identity_key, source_id, library_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_tvdb ON series_completeness(source_id, library_id, tvdb_id) WHERE tvdb_id IS NOT NULL AND tvdb_id != \'\'',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_tmdb ON series_completeness(source_id, library_id, tmdb_id) WHERE tmdb_id IS NOT NULL AND tmdb_id != \'\'',
      'CREATE INDEX IF NOT EXISTS idx_series_completeness_title_pct ON series_completeness(series_title, completeness_percentage)',
      'CREATE INDEX IF NOT EXISTS idx_series_completeness_incomplete ON series_completeness(completeness_percentage) WHERE tmdb_id IS NOT NULL AND completeness_percentage < 100',
      `CREATE TRIGGER IF NOT EXISTS update_series_completeness_timestamp
       AFTER UPDATE ON series_completeness BEGIN
         UPDATE series_completeness SET updated_at = datetime('now') WHERE id = NEW.id;
       END`,
    ],
  )
}

async function markLegacyZeroScoresInsufficient(db: Client): Promise<void> {
  const updates = [
    `UPDATE quality_scores
     SET evidence_status = 'insufficient', confidence = 'none', savings_basis = 'insufficient_data'
     WHERE tier_score = 0 AND bitrate_tier_score = 0 AND audio_tier_score = 0
       AND overall_score = 0 AND resolution_score = 0 AND bitrate_score = 0 AND audio_score = 0
       AND COALESCE(efficiency_score, 0) = 0 AND COALESCE(storage_debt_bytes, 0) = 0`,
    `UPDATE music_quality_scores
     SET evidence_status = 'insufficient', confidence = 'none', savings_basis = 'insufficient_data'
     WHERE tier_score = 0 AND codec_score = 0 AND bitrate_score = 0
       AND COALESCE(efficiency_score, 0) = 0 AND COALESCE(storage_debt_bytes, 0) = 0`,
    `UPDATE series_completeness
     SET evidence_status = 'insufficient', confidence = 'none', savings_basis = 'insufficient_data'
     WHERE COALESCE(efficiency_score, 0) = 0 AND COALESCE(storage_debt_bytes, 0) = 0`,
  ]
  for (const statement of updates) await db.execute(statement)
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
  try {
    const drizzleDb = drizzle(db, { schema })
    const repo = new TVShowRepository(db, drizzleDb)
    await repo.mergeDuplicateShows()
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

async function migrateStaleTimelineRecipes(db: Client): Promise<void> {
  try {
    const rows = await db.execute("SELECT key, value FROM settings WHERE key LIKE 'timeline_recipe:%' OR key LIKE 'timeline_manifest:%'")
    for (const row of rows.rows) {
      const key = String(row.key)
      const raw = typeof row.value === 'string' ? row.value : String(row.value ?? '')
      try {
        const parsed = JSON.parse(raw)

        if (key.startsWith('timeline_recipe:')) {
          const recipe = parseTimelineRecipeCache(parsed)
          const validation = validateTimelineDefinition(recipe.data)
          if (!validation.valid) {
            const reason = validation.reason.startsWith('unsupported version ')
              ? `unsupported recipe version ${validation.reason.slice('unsupported version '.length)}`
              : validation.reason
            warnTimelineCache(key, reason)
            continue
          }
          if (validation.value.version === 2) continue
          warnTimelineCache(key, 'cannot losslessly infer a version 2 episode-interleaved order from version 1 semantics')
          continue
        }

        const manifest = parseTimelineManifestCache(parsed)
        if (manifest) continue
        warnTimelineCache(key, 'unsupported manifest payload')
      } catch (error) {
        warnTimelineCache(key, `malformed JSON or cache payload: ${getErrorMessage(error)}`)
      }
    }
  } catch (err) {
    getLoggingService().debug('[DatabaseMigration]', 'Timeline cache migration note: ' + getErrorMessage(err))
  }
}

interface TimelineCacheEnvelope {
  data: unknown
  timestamp: number
  expiresAt: number
}

function parseTimelineRecipeCache(value: unknown): { envelope: TimelineCacheEnvelope; data: Record<string, unknown> } {
  if (!isTimelineCacheEnvelope(value) || !isRecord(value.data)) {
    throw new Error('recipe envelope is missing data, timestamp, or expiresAt')
  }
  const recipe = value.data
  return { envelope: value, data: recipe }
}

function parseTimelineManifestCache(value: unknown): TimelineCacheEnvelope | null {
  if (!isTimelineCacheEnvelope(value) || !Array.isArray(value.data) || !value.data.every(isTimelineRecipeSummary)) return null
  return value
}

function isTimelineCacheEnvelope(value: unknown): value is TimelineCacheEnvelope {
  return isRecord(value) && typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) &&
    typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) && 'data' in value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function warnTimelineCache(key: string, reason: string): void {
  getLoggingService().warn('[DatabaseMigration]', `Retained timeline cache '${key}': ${reason}`)
}
