import { getLoggingService } from '../services/LoggingService'
/**
 * BetterSQLiteService
 *
 * High-performance SQLite database service using better-sqlite3.
 * This replaces SQL.js with native SQLite for improved performance:
 * - Direct file access (no in-memory + export overhead)
 * - Synchronous API (no unnecessary async wrappers)
 * - WAL mode for concurrent reads during writes
 * - Direct object results (no rowsToObjects conversion)
 *
 * Feature flag: Set 'use_better_sqlite3' to 'true' in settings to enable.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { DATABASE_SCHEMA } from './schema'
import { getCredentialEncryptionService } from '../services/CredentialEncryptionService'
import { getErrorMessage } from '../services/utils/errorUtils'
import type {
  MediaItem,
  QualityScore,
  MediaItemFilters,
  MediaSource,
  ProviderType,
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  SeriesCompleteness,
  MovieCollection,
  MusicQualityScore,
  ArtistCompleteness,
  AlbumCompleteness,
  MusicFilters,
  WishlistItem,
  WishlistFilters,
  TVShowSummary,
  TVShowFilters,
  MediaItemVersion,
} from '../types/database'
import type {
  Notification,
  NotificationCountResult,
  GetNotificationsOptions,
} from '../types/monitoring'
import {
  ConfigRepository,
  MediaRepository,
  MusicRepository,
  StatsRepository,
  NotificationRepository
} from './repositories'

// Singleton instance
let serviceInstance: BetterSQLiteService | null = null

export function getBetterSQLiteService(): BetterSQLiteService {
  if (!serviceInstance) {
    serviceInstance = new BetterSQLiteService()
  }
  return serviceInstance
}

export class BetterSQLiteService {
  private db: Database.Database | null = null
  private dbPath: string
  private _isInitialized = false

  private _configRepo: ConfigRepository | null = null
  private _mediaRepo: MediaRepository | null = null
  private _musicRepo: MusicRepository | null = null
  private _statsRepo: StatsRepository | null = null
  private _notificationRepo: NotificationRepository | null = null

  /** Check if database is initialized */
  get isInitialized(): boolean {
    return this._isInitialized
  }

  private get configRepo(): ConfigRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._configRepo) this._configRepo = new ConfigRepository(this.db)
    return this._configRepo
  }

  private get mediaRepo(): MediaRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._mediaRepo) this._mediaRepo = new MediaRepository(this.db)
    return this._mediaRepo
  }

  private get musicRepo(): MusicRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._musicRepo) this._musicRepo = new MusicRepository(this.db)
    return this._musicRepo
  }

  private get statsRepo(): StatsRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._statsRepo) this._statsRepo = new StatsRepository(this.db)
    return this._statsRepo
  }

  private get notificationRepo(): NotificationRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._notificationRepo) this._notificationRepo = new NotificationRepository(this.db)
    return this._notificationRepo
  }

  constructor() {
    const userDataPath = app.getPath('userData')
    this.dbPath = path.join(userDataPath, 'totality-v2.db')
  }

  /**
   * Initialize the database
   */
  initialize(): void {
    if (this._isInitialized) {
      return
    }

    try {
      // Create or open database
      const dbExists = fs.existsSync(this.dbPath)

      this.db = new Database(this.dbPath)

      // Configure for performance
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('cache_size = -32000') // 32MB cache
      this.db.pragma('foreign_keys = ON')
      this.db.pragma('temp_store = MEMORY')
      this.db.pragma('busy_timeout = 5000') // Wait up to 5s for locked database

      if (dbExists) {
        getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] Database loaded from:', path.basename(this.dbPath))

        // Verify integrity in the background to avoid blocking startup
        // This is safe because we're in WAL mode and the check is read-only
        setImmediate(() => {
          try {
            const result = this.db!.pragma('integrity_check') as Array<{ integrity_check: string }>
            if (result[0]?.integrity_check !== 'ok') {
              getLoggingService().error('[BetterSQLiteService]', '[BetterSQLite] Background integrity check failed:', result)
              // In a real app, we might want to notify the user or trigger a repair here
            } else {
              getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] Background integrity check passed')
            }
          } catch (error) {
            getLoggingService().error('[BetterSQLiteService]', '[BetterSQLite] Error during background integrity check:', error)
          }
        })
      } else {
        getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] New database created')
      }

      // Run schema and migrations
      this.runMigrations()

      this._isInitialized = true
      getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] Database initialized successfully')
    } catch (error) {
      getLoggingService().error('[BetterSQLiteService]', '[BetterSQLite] Failed to initialize database:', error)
      throw error
    }
  }

  /**
   * Run database migrations
   */
  private runMigrations(): void {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    // Execute main schema (CREATE TABLE IF NOT EXISTS)
    this.db.exec(DATABASE_SCHEMA)

    // Run ALTER TABLE migrations for new columns
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

      // Subtitle tracks
      'ALTER TABLE media_items ADD COLUMN subtitle_tracks TEXT',

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

      // Sort title support
      'ALTER TABLE media_items ADD COLUMN sort_title TEXT',

      // Multi-version support
      'ALTER TABLE media_items ADD COLUMN version_count INTEGER NOT NULL DEFAULT 1',

      // Per-version split quality scores
      'ALTER TABLE media_item_versions ADD COLUMN bitrate_tier_score INTEGER DEFAULT 0',
      'ALTER TABLE media_item_versions ADD COLUMN audio_tier_score INTEGER DEFAULT 0',

      // Media item summary/description
      'ALTER TABLE media_items ADD COLUMN summary TEXT',
    ]

    for (const statement of alterStatements) {
      try {
        this.db.exec(statement)
      } catch (error: unknown) {
        // Ignore "duplicate column" errors
        const msg = getErrorMessage(error)
        if (!msg?.includes('duplicate column name')) {
          getLoggingService().info('[BetterSQLite]', `Migration note: ${msg}`)
        }
      }
    }

    // Migration: Add 'kodi-mysql' to source_type CHECK constraints for existing databases
    // Uses PRAGMA writable_schema to modify CHECK constraints in-place (SQLite limitation)
    try {
      const schemaRow = this.db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='media_sources'"
      ).get() as { sql: string } | undefined
      if (schemaRow?.sql && !schemaRow.sql.includes('kodi-mysql')) {
        const tableNames = ['media_sources', 'media_items', 'music_artists', 'music_albums', 'music_tracks']
        this.db.exec('PRAGMA writable_schema = ON')
        try {
          for (const table of tableNames) {
            // Handle migration 001 format (missing 'local')
            this.db.prepare(
              `UPDATE sqlite_master SET sql = replace(sql, '''kodi-local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = ?`
            ).run(table)
            // Handle schema.ts format (has 'local')
            this.db.prepare(
              `UPDATE sqlite_master SET sql = replace(sql, '''kodi-local'', ''local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = ?`
            ).run(table)
          }
        } finally {
          this.db.exec('PRAGMA writable_schema = OFF')
        }
        // Verify database integrity after schema modification
        const integrityResult = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>
        const isOk = integrityResult.length === 1 && integrityResult[0].integrity_check === 'ok'
        if (!isOk) {
          getLoggingService().error('[BetterSQLiteService]', '[BetterSQLite] Integrity check failed after CHECK migration:', integrityResult)
        } else {
          getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] Migration: Added kodi-mysql to source_type CHECK constraints')
        }
      }
    } catch (error: unknown) {
      getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] kodi-mysql CHECK migration note:', getErrorMessage(error))
    }

    // Create indexes for performance
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_media_items_tmdb_id ON media_items(tmdb_id) WHERE tmdb_id IS NOT NULL')
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_media_items_imdb_id ON media_items(imdb_id) WHERE imdb_id IS NOT NULL')
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_media_items_year ON media_items(year) WHERE year IS NOT NULL')
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_series_completeness_tmdb_id ON series_completeness(tmdb_id) WHERE tmdb_id IS NOT NULL')
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_music_albums_type ON music_albums(album_type) WHERE album_type IS NOT NULL')
    } catch {
      // Indexes may already exist
    }

    // Fix music track album_id references — prior bug in upsertMusicAlbum returned
    // stale lastInsertRowid after ON CONFLICT DO UPDATE, causing tracks to link to
    // wrong albums. Re-link tracks by matching source_id + album_name + artist_name.
    try {
      const mismatchCount = (this.db.prepare(`
        SELECT COUNT(*) as cnt FROM music_tracks t
        WHERE t.album_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM music_albums a
            WHERE a.id = t.album_id AND a.title = t.album_name AND a.source_id = t.source_id
          )
      `).get() as { cnt: number })?.cnt || 0

      if (mismatchCount > 0) {
        this.db.exec(`
          UPDATE music_tracks SET album_id = (
            SELECT a.id FROM music_albums a
            WHERE a.title = music_tracks.album_name
              AND a.artist_name = music_tracks.artist_name
              AND a.source_id = music_tracks.source_id
            LIMIT 1
          )
          WHERE EXISTS (
            SELECT 1 FROM music_albums a
            WHERE a.title = music_tracks.album_name
              AND a.artist_name = music_tracks.artist_name
              AND a.source_id = music_tracks.source_id
          )
        `)
        getLoggingService().info('[BetterSQLite]', `Fixed ${mismatchCount} music tracks with incorrect album_id references`)
      }
    } catch (error: unknown) {
      getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] Music track album_id fix note:', getErrorMessage(error))
    }

    // Populate media_item_versions from existing media_items (one version per item)
    this.migrateExistingItemsToVersions()

    // Clean up orphaned records from prior cascade delete bugs (wrapped in transaction)
    try {
      const cleanupOrphans = this.db.transaction(() => {
        const orphanedScores = this.db!.prepare(
          'DELETE FROM quality_scores WHERE media_item_id NOT IN (SELECT id FROM media_items)'
        ).run()
        const orphanedVersions = this.db!.prepare(
          'DELETE FROM media_item_versions WHERE media_item_id NOT IN (SELECT id FROM media_items)'
        ).run()
        const orphanedCollections = this.db!.prepare(
          'DELETE FROM media_item_collections WHERE media_item_id NOT IN (SELECT id FROM media_items)'
        ).run()
        return orphanedScores.changes + orphanedVersions.changes + orphanedCollections.changes
      })
      const total = cleanupOrphans()
      if (total > 0) {
        getLoggingService().info('[BetterSQLite]', `Orphan cleanup: removed ${total} orphaned records`)
      }
    } catch (err) {
      getLoggingService().warn('[BetterSQLiteService]', '[BetterSQLite] Orphan cleanup skipped:', err)
    }

    getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] Migrations completed')
  }

  /**
   * Migrate existing media_items into media_item_versions (one version per item).
   * Only runs if versions table is empty but items exist.
   */
  private migrateExistingItemsToVersions(): void {
    if (!this.db) return

    try {
      const countResult = this.db.prepare('SELECT COUNT(*) as count FROM media_item_versions').get() as { count: number }
      if (countResult.count > 0) return // Already migrated

      const itemCount = (this.db.prepare('SELECT COUNT(*) as count FROM media_items').get() as { count: number }).count
      if (itemCount === 0) return // No items to migrate

      getLoggingService().info('[BetterSQLite]', `Migrating ${itemCount} existing items to versions table...`)

      this.db.exec(`
        INSERT INTO media_item_versions (
          media_item_id, version_source, file_path, file_size, duration,
          resolution, width, height, video_codec, video_bitrate,
          audio_codec, audio_channels, audio_bitrate,
          video_frame_rate, color_bit_depth, hdr_format, color_space,
          video_profile, video_level, audio_profile, audio_sample_rate,
          has_object_audio, audio_tracks, subtitle_tracks, container, file_mtime,
          is_best, created_at, updated_at
        )
        SELECT
          id, 'primary', file_path, file_size, duration,
          resolution, width, height, video_codec, video_bitrate,
          audio_codec, audio_channels, audio_bitrate,
          video_frame_rate, color_bit_depth, hdr_format, color_space,
          video_profile, video_level, audio_profile, audio_sample_rate,
          has_object_audio, audio_tracks, subtitle_tracks, container, file_mtime,
          1, created_at, updated_at
        FROM media_items
      `)

      getLoggingService().info('[BetterSQLite]', `Migrated ${itemCount} items to versions table`)
    } catch (error: unknown) {
      const msg = getErrorMessage(error)
      // Table might not exist yet on first run - schema handles creation
      if (!msg?.includes('no such table')) {
        getLoggingService().error('[BetterSQLiteService]', '[BetterSQLite] Version migration error:', msg)
      }
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      // Optimize database before closing
      this.db.pragma('optimize')
      this.db.close()
      this.db = null
      this._isInitialized = false
      getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] Database closed')
    }
  }

  /**
   * Get the database file path
   */
  getDbPath(): string {
    return this.dbPath
  }

  /**
   * Batch mode is a no-op for better-sqlite3 ΓÇö each write is auto-persisted
   * via WAL mode. For multi-step operations needing atomicity, use
   * db.transaction() explicitly instead.
   *
   * SQL.js backend uses batch mode to defer disk writes until endBatch().
   */
  startBatch(): void {
    // No-op: better-sqlite3 auto-persists via WAL mode
  }

  /**
   * End batch mode (no-op for better-sqlite3)
   */
  async endBatch(): Promise<void> {
    // No-op: better-sqlite3 auto-persists via WAL mode
  }

  /**
   * Force save (no-op for better-sqlite3 - changes are auto-persisted)
   */
  forceSave(): void {
    // No-op: better-sqlite3 auto-persists with WAL mode
    // Optionally checkpoint the WAL file
    if (this.db) {
      this.db.pragma('wal_checkpoint(PASSIVE)')
    }
  }

  /**
   * Check if in batch mode (always false for better-sqlite3)
   */
  isInBatchMode(): boolean {
    return false
  }

  // ============================================================================
  // SETTINGS
  // ============================================================================

  /**
   * Get a setting value
   */
  getSetting(key: string): string | null {
    return this.configRepo.getSetting(key)
  }

  /**
   * Set a setting value
   */
  setSetting(key: string, value: string): void {
    this.configRepo.setSetting(key, value)
  }

  /**
   * Delete a setting
   */
  deleteSetting(key: string): void {
    this.configRepo.deleteSetting(key)
  }

  /**
   * Get all settings
   */
  getAllSettings(): Record<string, string> {
    return this.configRepo.getAllSettings()
  }

  /**
   * Get settings by prefix
   */
  getSettingsByPrefix(prefix: string): Record<string, string> {
    return this.configRepo.getSettingsByPrefix(prefix)
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get library statistics
   */
  getLibraryStats(sourceId?: string): ReturnType<StatsRepository['getLibraryStats']> {
    return this.statsRepo.getLibraryStats(sourceId)
  }

  /**
   * Get media items count by source
   */
  getMediaItemsCountBySource(sourceId: string): number {
    return this.statsRepo.getMediaItemsCountBySource(sourceId)
  }

  /**
   * Get aggregated stats across all sources
   */
  getAggregatedSourceStats(): ReturnType<StatsRepository['getAggregatedSourceStats']> {
    return this.statsRepo.getAggregatedSourceStats()
  }

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  /**
   * Get media items with filters
   * By default, only returns items from enabled libraries
   */
  getMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): MediaItem[] {
    return this.mediaRepo.getMediaItems(filters)
  }

  /**
   * Get media item by ID
   */
  getMediaItem(id: number): MediaItem | null {
    return this.mediaRepo.getMediaItem(id)
  }

  /**
   * Get media item by file path
   */
  getMediaItemByPath(filePath: string): MediaItem | null {
    return this.mediaRepo.getMediaItemByPath(filePath)
  }

  /**
   * Get media item by provider ID
   */
  getMediaItemByProviderId(providerId: string, sourceId?: string): MediaItem | null {
    return this.mediaRepo.getMediaItemByProviderId(providerId, sourceId)
  }

  /**
   * Count media items matching filters
   * Uses same filter logic as getMediaItems but returns count only
   */
  countMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): number {
    return this.mediaRepo.getMediaItems(filters).length
  }

  /**
   * Upsert media item
   */
  upsertMediaItem(item: MediaItem): number {
    return this.mediaRepo.upsertMediaItem(item)
  }

  /**
   * Delete media item
   */
  deleteMediaItem(id: number): void {
    this.mediaRepo.deleteMediaItem(id)
  }

  /**
   * Delete all media items for a source
   */
  deleteMediaItemsForSource(sourceId: string): void {
    this.mediaRepo.deleteMediaItemsForSource(sourceId)
  }

  // ============================================================================
  // MEDIA ITEM VERSIONS
  // ============================================================================

  /**
   * Upsert a version for a media item
   */
  upsertMediaItemVersion(version: MediaItemVersion): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO media_item_versions (
        media_item_id, version_source, edition, label,
        file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate,
        video_frame_rate, color_bit_depth, hdr_format, color_space,
        video_profile, video_level, audio_profile, audio_sample_rate,
        has_object_audio, audio_tracks, subtitle_tracks, container, file_mtime,
        quality_tier, tier_quality, tier_score, is_best
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(media_item_id, file_path) DO UPDATE SET
        version_source = excluded.version_source,
        edition = excluded.edition,
        label = excluded.label,
        file_size = excluded.file_size,
        duration = excluded.duration,
        resolution = excluded.resolution,
        width = excluded.width,
        height = excluded.height,
        video_codec = excluded.video_codec,
        video_bitrate = excluded.video_bitrate,
        audio_codec = excluded.audio_codec,
        audio_channels = excluded.audio_channels,
        audio_bitrate = excluded.audio_bitrate,
        video_frame_rate = excluded.video_frame_rate,
        color_bit_depth = excluded.color_bit_depth,
        hdr_format = excluded.hdr_format,
        color_space = excluded.color_space,
        video_profile = excluded.video_profile,
        video_level = excluded.video_level,
        audio_profile = excluded.audio_profile,
        audio_sample_rate = excluded.audio_sample_rate,
        has_object_audio = excluded.has_object_audio,
        audio_tracks = excluded.audio_tracks,
        subtitle_tracks = excluded.subtitle_tracks,
        container = excluded.container,
        file_mtime = excluded.file_mtime,
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        is_best = excluded.is_best,
        updated_at = datetime('now')
    `)

    const result = stmt.run(
      version.media_item_id,
      version.version_source || 'primary',
      version.edition || null,
      version.label || null,
      version.file_path,
      version.file_size,
      version.duration,
      version.resolution,
      version.width,
      version.height,
      version.video_codec,
      version.video_bitrate,
      version.audio_codec,
      version.audio_channels,
      version.audio_bitrate,
      version.video_frame_rate || null,
      version.color_bit_depth || null,
      version.hdr_format || null,
      version.color_space || null,
      version.video_profile || null,
      version.video_level || null,
      version.audio_profile || null,
      version.audio_sample_rate || null,
      version.has_object_audio ? 1 : 0,
      version.audio_tracks || null,
      version.subtitle_tracks || null,
      version.container || null,
      version.file_mtime || null,
      version.quality_tier || null,
      version.tier_quality || null,
      version.tier_score || 0,
      version.is_best ? 1 : 0
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Get all versions for a media item
   */
  getMediaItemVersions(mediaItemId: number): MediaItemVersion[] {
    if (!this.db) throw new Error('Database not initialized')

    const rows = this.db.prepare(
      'SELECT * FROM media_item_versions WHERE media_item_id = ? ORDER BY is_best DESC, tier_score DESC'
    ).all(mediaItemId) as Record<string, unknown>[]

    return rows.map(row => ({
      id: row.id as number,
      media_item_id: row.media_item_id as number,
      version_source: row.version_source as string,
      edition: row.edition as string | undefined,
      label: row.label as string | undefined,
      file_path: row.file_path as string,
      file_size: row.file_size as number,
      duration: row.duration as number,
      resolution: row.resolution as string,
      width: row.width as number,
      height: row.height as number,
      video_codec: row.video_codec as string,
      video_bitrate: row.video_bitrate as number,
      audio_codec: row.audio_codec as string,
      audio_channels: row.audio_channels as number,
      audio_bitrate: row.audio_bitrate as number,
      video_frame_rate: row.video_frame_rate as number | undefined,
      color_bit_depth: row.color_bit_depth as number | undefined,
      hdr_format: row.hdr_format as string | undefined,
      color_space: row.color_space as string | undefined,
      video_profile: row.video_profile as string | undefined,
      video_level: row.video_level as number | undefined,
      audio_profile: row.audio_profile as string | undefined,
      audio_sample_rate: row.audio_sample_rate as number | undefined,
      has_object_audio: !!(row.has_object_audio as number),
      audio_tracks: row.audio_tracks as string | undefined,
      subtitle_tracks: row.subtitle_tracks as string | undefined,
      container: row.container as string | undefined,
      file_mtime: row.file_mtime as number | undefined,
      quality_tier: row.quality_tier as string | undefined,
      tier_quality: row.tier_quality as string | undefined,
      tier_score: row.tier_score as number | undefined,
      is_best: !!(row.is_best as number),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }))
  }

  /**
   * Update only the quality scoring fields on a version row.
   */
  updateMediaItemVersionQuality(versionId: number, scores: { quality_tier: string; tier_quality: string; tier_score: number; bitrate_tier_score: number; audio_tier_score: number }): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      `UPDATE media_item_versions SET quality_tier = ?, tier_quality = ?, tier_score = ?, bitrate_tier_score = ?, audio_tier_score = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(scores.quality_tier, scores.tier_quality, scores.tier_score, scores.bitrate_tier_score, scores.audio_tier_score, versionId)
  }

  /**
   * Delete all versions for a media item (used before re-inserting during rescan)
   */
  deleteMediaItemVersions(mediaItemId: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM media_item_versions WHERE media_item_id = ?').run(mediaItemId)
  }

  /**
   * Sync versions for a media item: delete stale versions not in the current
   * file paths, upsert current versions, and update best version + version_count.
   */
  syncMediaItemVersions(mediaItemId: number, versions: MediaItemVersion[]): void {
    if (!this.db) throw new Error('Database not initialized')

    const currentFilePaths = versions.map(v => v.file_path).filter(Boolean)

    if (currentFilePaths.length > 0) {
      const placeholders = currentFilePaths.map(() => '?').join(',')
      this.db.prepare(
        `DELETE FROM media_item_versions WHERE media_item_id = ? AND file_path NOT IN (${placeholders})`
      ).run(mediaItemId, ...currentFilePaths)
    } else {
      this.db.prepare('DELETE FROM media_item_versions WHERE media_item_id = ?').run(mediaItemId)
    }

    for (const version of versions) {
      this.upsertMediaItemVersion(version)
    }

    this.updateBestVersion(mediaItemId)
  }

  /**
   * Update the best version flag and sync parent media_item fields.
   * Picks the highest quality version and copies its data to the parent item.
   */
  updateBestVersion(mediaItemId: number): void {
    if (!this.db) throw new Error('Database not initialized')

    const versions = this.getMediaItemVersions(mediaItemId)
    if (versions.length === 0) return

    // Rank versions: 4K=4, 1080p=3, 720p=2, SD=1, then by tier_score
    const tierRank = (tier?: string): number => {
      switch (tier) {
        case '4K': return 4
        case '1080p': return 3
        case '720p': return 2
        default: return 1
      }
    }

    // Sort by tier rank desc, then tier_score desc
    const sorted = [...versions].sort((a, b) => {
      const rankDiff = tierRank(b.quality_tier || 'SD') - tierRank(a.quality_tier || 'SD')
      if (rankDiff !== 0) return rankDiff
      return (b.tier_score || 0) - (a.tier_score || 0)
    })

    const best = sorted[0]

    // Wrap in transaction to ensure consistency across the 3 related updates
    const updateBest = this.db.transaction(() => {
      // Clear all is_best flags, then set the best one
      this.db!.prepare('UPDATE media_item_versions SET is_best = 0 WHERE media_item_id = ?').run(mediaItemId)
      if (best.id) {
        this.db!.prepare('UPDATE media_item_versions SET is_best = 1 WHERE id = ?').run(best.id)
      }

      // Sync best version's file/quality fields to parent media_item
      this.db!.prepare(`
        UPDATE media_items SET
          file_path = ?, file_size = ?, duration = ?,
          resolution = ?, width = ?, height = ?,
          video_codec = ?, video_bitrate = ?,
          audio_codec = ?, audio_channels = ?, audio_bitrate = ?,
          video_frame_rate = ?, color_bit_depth = ?, hdr_format = ?, color_space = ?,
          video_profile = ?, video_level = ?,
          audio_profile = ?, audio_sample_rate = ?, has_object_audio = ?,
          audio_tracks = ?, subtitle_tracks = ?, container = ?, file_mtime = ?,
          version_count = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        best.file_path, best.file_size, best.duration,
        best.resolution, best.width, best.height,
        best.video_codec, best.video_bitrate,
        best.audio_codec, best.audio_channels, best.audio_bitrate,
        best.video_frame_rate || null, best.color_bit_depth || null,
        best.hdr_format || null, best.color_space || null,
        best.video_profile || null, best.video_level || null,
        best.audio_profile || null, best.audio_sample_rate || null,
        best.has_object_audio ? 1 : 0,
        best.audio_tracks || null, best.subtitle_tracks || null,
        best.container || null, best.file_mtime || null,
        versions.length,
        mediaItemId
      )
    })
    updateBest()
  }

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  /**
   * Upsert quality score
   */
  upsertQualityScore(score: QualityScore): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO quality_scores (
        media_item_id, quality_tier, tier_quality, tier_score,
        bitrate_tier_score, audio_tier_score, overall_score,
        resolution_score, bitrate_score, audio_score,
        efficiency_score, storage_debt_bytes,
        is_low_quality, needs_upgrade, issues,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(media_item_id) DO UPDATE SET
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        bitrate_tier_score = excluded.bitrate_tier_score,
        audio_tier_score = excluded.audio_tier_score,
        overall_score = excluded.overall_score,
        resolution_score = excluded.resolution_score,
        bitrate_score = excluded.bitrate_score,
        audio_score = excluded.audio_score,
        efficiency_score = excluded.efficiency_score,
        storage_debt_bytes = excluded.storage_debt_bytes,
        is_low_quality = excluded.is_low_quality,
        needs_upgrade = excluded.needs_upgrade,
        issues = excluded.issues,
        updated_at = datetime('now')
    `)

    stmt.run(
      score.media_item_id,
      score.quality_tier,
      score.tier_quality,
      score.tier_score,
      score.bitrate_tier_score,
      score.audio_tier_score,
      score.overall_score,
      score.resolution_score,
      score.bitrate_score,
      score.audio_score,
      score.efficiency_score || 0,
      score.storage_debt_bytes || 0,
      score.is_low_quality ? 1 : 0,
      score.needs_upgrade ? 1 : 0,
      score.issues
    )
  }

  /**
   * Get quality score for media item
   */
  getQualityScore(mediaItemId: number): QualityScore | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM quality_scores WHERE media_item_id = ?')
    return (stmt.get(mediaItemId) as QualityScore) || null
  }

  // ============================================================================
  // MEDIA SOURCES
  // ============================================================================

  /**
   * Get all media sources
   */
  getMediaSources(type?: ProviderType): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    let sources: MediaSource[]
    if (type) {
      const stmt = this.db.prepare('SELECT * FROM media_sources WHERE source_type = ? ORDER BY display_name')
      sources = stmt.all(type) as MediaSource[]
    } else {
      const stmt = this.db.prepare('SELECT * FROM media_sources ORDER BY display_name')
      sources = stmt.all() as MediaSource[]
    }
    const encryption = getCredentialEncryptionService()

    return sources.map(source => {
      let decryptedConfig = source.connection_config
      try {
        const config = JSON.parse(source.connection_config)
        const decrypted = encryption.decryptConnectionConfig(config)
        decryptedConfig = JSON.stringify(decrypted)
      } catch {
        // Keep original if decryption fails
      }
      return { ...source, connection_config: decryptedConfig }
    })
  }

  /**
   * Get enabled media sources
   */
  getEnabledMediaSources(): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE is_enabled = 1 ORDER BY display_name')
    const sources = stmt.all() as MediaSource[]
    const encryption = getCredentialEncryptionService()

    return sources.map(source => {
      let decryptedConfig = source.connection_config
      try {
        const config = JSON.parse(source.connection_config)
        const decrypted = encryption.decryptConnectionConfig(config)
        decryptedConfig = JSON.stringify(decrypted)
      } catch {
        // Keep original if decryption fails
      }
      return { ...source, connection_config: decryptedConfig }
    })
  }

  /**
   * Get media source by ID
   */
  getMediaSource(sourceId: string): MediaSource | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE source_id = ?')
    const source = stmt.get(sourceId) as MediaSource | undefined
    if (!source) return null

    // Decrypt connection config
    const encryption = getCredentialEncryptionService()
    let decryptedConfig = source.connection_config
    try {
      const config = JSON.parse(source.connection_config)
      const decrypted = encryption.decryptConnectionConfig(config)
      decryptedConfig = JSON.stringify(decrypted)
    } catch {
      // Keep original if decryption fails
    }

    return { ...source, connection_config: decryptedConfig }
  }

  /**
   * Get media source by ID (alias for getMediaSource for compatibility)
   */
  getMediaSourceById(sourceId: string): MediaSource | null {
    return this.getMediaSource(sourceId)
  }

  /**
   * Add or update media source
   */
  upsertMediaSource(source: MediaSource): void {
    if (!this.db) throw new Error('Database not initialized')

    // Encrypt connection config
    const encryption = getCredentialEncryptionService()
    let encryptedConfig = source.connection_config
    try {
      const config = JSON.parse(source.connection_config)
      const encrypted = encryption.encryptConnectionConfig(config)
      encryptedConfig = JSON.stringify(encrypted)
    } catch {
      // Keep original if encryption fails
    }

    const stmt = this.db.prepare(`
      INSERT INTO media_sources (
        source_id, source_type, display_name, connection_config,
        is_enabled, last_connected_at, last_scan_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id) DO UPDATE SET
        source_type = excluded.source_type,
        display_name = excluded.display_name,
        connection_config = excluded.connection_config,
        is_enabled = excluded.is_enabled,
        last_connected_at = excluded.last_connected_at,
        last_scan_at = excluded.last_scan_at,
        updated_at = datetime('now')
    `)

    stmt.run(
      source.source_id,
      source.source_type,
      source.display_name,
      encryptedConfig,
      source.is_enabled ? 1 : 0,
      source.last_connected_at || null,
      source.last_scan_at || null
    )
  }

  /**
   * Delete media source
   */
  deleteMediaSource(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    getLoggingService().info('[BetterSQLite]', `Deleting source ${sourceId} and all associated data...`)

    // Delete media item related data (versions, quality scores, collections)
    this.deleteMediaItemsForSource(sourceId)

    // Delete wishlist items referencing media items from this source
    this.db.prepare(`
      DELETE FROM wishlist_items WHERE media_item_id IN (
        SELECT id FROM media_items WHERE source_id = ?
      )
    `).run(sourceId)

    // Delete music quality scores for albums from this source
    this.db.prepare(`
      DELETE FROM music_quality_scores WHERE album_id IN (
        SELECT id FROM music_albums WHERE source_id = ?
      )
    `).run(sourceId)

    // Delete album completeness data for albums from this source
    this.db.prepare(`
      DELETE FROM album_completeness WHERE album_id IN (
        SELECT id FROM music_albums WHERE source_id = ?
      )
    `).run(sourceId)

    // Delete artist completeness data for artists from this source
    this.db.prepare(`
      DELETE FROM artist_completeness WHERE artist_name IN (
        SELECT name FROM music_artists WHERE source_id = ?
      )
    `).run(sourceId)

    // Delete music tracks, albums, artists
    this.db.prepare('DELETE FROM music_tracks WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM music_albums WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM music_artists WHERE source_id = ?').run(sourceId)

    // Delete completeness and scan data
    this.db.prepare('DELETE FROM series_completeness WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM movie_collections WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM library_scans WHERE source_id = ?').run(sourceId)

    // Delete notifications for this source
    this.db.prepare('DELETE FROM notifications WHERE source_id = ?').run(sourceId)

    // Delete the source itself
    this.db.prepare('DELETE FROM media_sources WHERE source_id = ?').run(sourceId)

    getLoggingService().info('[BetterSQLite]', `Deleted source and all data: ${sourceId}`)
  }

  /**
   * Update source connection time
   */
  updateSourceConnectionTime(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      UPDATE media_sources SET last_connected_at = datetime('now'), updated_at = datetime('now')
      WHERE source_id = ?
    `)
    stmt.run(sourceId)
  }

  /**
   * Update source scan time
   */
  updateSourceScanTime(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      UPDATE media_sources SET last_scan_at = datetime('now'), updated_at = datetime('now')
      WHERE source_id = ?
    `)
    stmt.run(sourceId)
  }

  /**
   * Toggle source enabled state
   */
  toggleMediaSource(sourceId: string, enabled: boolean): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      UPDATE media_sources SET is_enabled = ?, updated_at = datetime('now')
      WHERE source_id = ?
    `)
    stmt.run(enabled ? 1 : 0, sourceId)
  }

  // ============================================================================
  // LIBRARY SCANS
  // ============================================================================

  /**
   * Update library scan timestamp
   */
  updateLibraryScanTime(
    sourceId: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    itemsScanned: number = 0
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned)
      VALUES (?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(source_id, library_id) DO UPDATE SET
        library_name = excluded.library_name,
        library_type = excluded.library_type,
        last_scan_at = datetime('now'),
        items_scanned = excluded.items_scanned
    `)
    stmt.run(sourceId, libraryId, libraryName, libraryType, itemsScanned)
  }

  /**
   * Get library scan timestamp
   */
  getLibraryScanTime(sourceId: string, libraryId: string): string | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      'SELECT last_scan_at FROM library_scans WHERE source_id = ? AND library_id = ?'
    )
    const row = stmt.get(sourceId, libraryId) as { last_scan_at: string } | undefined
    return row?.last_scan_at || null
  }

  /**
   * Get all library scan times for a source
   */
  getLibraryScanTimes(sourceId: string): Map<string, { lastScanAt: string; itemsScanned: number }> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      'SELECT library_id, last_scan_at, items_scanned FROM library_scans WHERE source_id = ?'
    )
    const rows = stmt.all(sourceId) as Array<{
      library_id: string
      last_scan_at: string
      items_scanned: number
    }>

    const map = new Map<string, { lastScanAt: string; itemsScanned: number }>()
    for (const row of rows) {
      map.set(row.library_id, {
        lastScanAt: row.last_scan_at,
        itemsScanned: row.items_scanned || 0,
      })
    }

    return map
  }

  /**
   * Delete library scan records for a source
   */
  deleteLibraryScanTimes(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    this.db.prepare('DELETE FROM library_scans WHERE source_id = ?').run(sourceId)
  }

  /**
   * Check if a library is enabled
   */
  isLibraryEnabled(sourceId: string, libraryId: string): boolean {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      'SELECT is_enabled FROM library_scans WHERE source_id = ? AND library_id = ?'
    )
    const row = stmt.get(sourceId, libraryId) as { is_enabled: number } | undefined

    // If no record exists, library is enabled by default
    if (!row) return true
    return row.is_enabled === 1
  }

  /**
   * Get all libraries for a source with their enabled status
   */
  getSourceLibraries(sourceId: string): Array<{
    libraryId: string
    libraryName: string
    libraryType: string
    isEnabled: boolean
    lastScanAt: string | null
    itemsScanned: number
  }> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      SELECT library_id, library_name, library_type, is_enabled, last_scan_at, items_scanned
      FROM library_scans WHERE source_id = ?
    `)
    const rows = stmt.all(sourceId) as Array<{
      library_id: string
      library_name: string
      library_type: string
      is_enabled: number
      last_scan_at: string | null
      items_scanned: number
    }>

    return rows.map(row => ({
      libraryId: row.library_id,
      libraryName: row.library_name,
      libraryType: row.library_type,
      isEnabled: row.is_enabled === 1,
      lastScanAt: row.last_scan_at,
      itemsScanned: row.items_scanned || 0,
    }))
  }

  /**
   * Get enabled library IDs for a source
   */
  getEnabledLibraryIds(sourceId: string): string[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      'SELECT library_id FROM library_scans WHERE source_id = ? AND is_enabled = 1'
    )
    const rows = stmt.all(sourceId) as Array<{ library_id: string }>
    return rows.map(row => row.library_id)
  }

  /**
   * Toggle a library's enabled status
   */
  toggleLibrary(sourceId: string, libraryId: string, enabled: boolean): void {
    if (!this.db) throw new Error('Database not initialized')

    // Check if record exists
    const existingStmt = this.db.prepare(
      'SELECT id FROM library_scans WHERE source_id = ? AND library_id = ?'
    )
    const existing = existingStmt.get(sourceId, libraryId) as { id: number } | undefined

    if (existing) {
      this.db.prepare(
        'UPDATE library_scans SET is_enabled = ? WHERE source_id = ? AND library_id = ?'
      ).run(enabled ? 1 : 0, sourceId, libraryId)
    } else {
      this.db.prepare(`
        INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
        VALUES (?, ?, '', 'unknown', datetime('now'), 0, ?)
      `).run(sourceId, libraryId, enabled ? 1 : 0)
    }
  }

  /**
   * Set library enabled status with metadata
   */
  setLibraryEnabled(
    sourceId: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    enabled: boolean
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
      VALUES (?, ?, ?, ?, datetime('now'), 0, ?)
      ON CONFLICT(source_id, library_id) DO UPDATE SET
        library_name = excluded.library_name,
        library_type = excluded.library_type,
        is_enabled = excluded.is_enabled
    `)
    stmt.run(sourceId, libraryId, libraryName, libraryType, enabled ? 1 : 0)
  }

  /**
   * Set multiple libraries' enabled status at once
   */
  setLibrariesEnabled(
    sourceId: string,
    libraries: Array<{ id: string; name: string; type: string; enabled: boolean }>
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
      VALUES (?, ?, ?, ?, datetime('now'), 0, ?)
      ON CONFLICT(source_id, library_id) DO UPDATE SET
        library_name = excluded.library_name,
        library_type = excluded.library_type,
        is_enabled = excluded.is_enabled
    `)

    const transaction = this.db.transaction(() => {
      for (const lib of libraries) {
        stmt.run(sourceId, lib.id, lib.name, lib.type, lib.enabled ? 1 : 0)
      }
    })
    transaction()
  }

  // ============================================================================
  // MUSIC TRACKS
  // ============================================================================

  /**
   * Get music track by file path
   */
  getMusicTrackByPath(filePath: string): MusicTrack | null {
    return this.musicRepo.getMusicTrackByPath(filePath)
  }

  /**
   * Upsert music track
   */
  upsertMusicTrack(track: MusicTrack): number {
    return this.musicRepo.upsertMusicTrack(track)
  }

  /**
   * Upsert music artist
   */
  upsertMusicArtist(artist: MusicArtist): number {
    return this.musicRepo.upsertMusicArtist(artist)
  }

  /**
   * Upsert music album
   */
  upsertMusicAlbum(album: MusicAlbum): number {
    return this.musicRepo.upsertMusicAlbum(album)
  }

  /**
   * Update music album artwork
   */
  updateMusicAlbumArtwork(
    sourceIdOrAlbumId: string | number,
    providerIdOrThumbUrl: string,
    artwork?: { thumbUrl?: string; artUrl?: string }
  ): void {
    this.musicRepo.updateMusicAlbumArtwork(sourceIdOrAlbumId, providerIdOrThumbUrl, artwork)
  }

  /**
   * Get music artists with filters
   */
  getMusicArtists(filters?: MusicFilters): MusicArtist[] {
    return this.musicRepo.getMusicArtists(filters)
  }

  countMusicArtists(filters?: MusicFilters): number {
    return this.musicRepo.countMusicArtists(filters)
  }

  /**
   * Get music artist by ID
   */
  getMusicArtistById(id: number): MusicArtist | null {
    return this.musicRepo.getMusicArtistById(id)
  }

  /**
   * Get music artist by name and source
   */
  getMusicArtistByName(name: string, sourceId: string): MusicArtist | null {
    return this.musicRepo.getMusicArtistByName(name, sourceId)
  }

  /**
   * Get music albums with filters
   */
  getMusicAlbums(filters?: MusicFilters): MusicAlbum[] {
    return this.musicRepo.getMusicAlbums(filters)
  }

  countMusicAlbums(filters?: MusicFilters): number {
    return this.musicRepo.countMusicAlbums(filters)
  }

  /**
   * Get music album by ID
   */
  getMusicAlbumById(id: number): MusicAlbum | null {
    return this.musicRepo.getMusicAlbumById(id)
  }

  /**
   * Get music album by name and artist
   */
  getMusicAlbumByName(title: string, artistId: number): MusicAlbum | null {
    return this.musicRepo.getMusicAlbumByName(title, artistId)
  }

  /**
   * Get music albums by artist name
   */
  getMusicAlbumsByArtistName(artistName: string, limit = 500): MusicAlbum[] {
    return this.musicRepo.getMusicAlbumsByArtistName(artistName, limit)
  }

  /**
   * Get music tracks with filters
   */
  getMusicTracks(filters?: MusicFilters): MusicTrack[] {
    return this.musicRepo.getMusicTracks(filters)
  }

  /**
   * Batch fetch tracks for multiple album IDs in a single query
   * Returns Map of album_id ΓåÆ MusicTrack[]
   */
  getMusicTracksByAlbumIds(albumIds: number[]): Map<number, MusicTrack[]> {
    return this.musicRepo.getMusicTracksByAlbumIds(albumIds)
  }

  countMusicTracks(filters?: MusicFilters): number {
    return this.musicRepo.countMusicTracks(filters)
  }

  /**
   * Get music track by ID
   */
  getMusicTrackById(id: number): MusicTrack | null {
    return this.musicRepo.getMusicTrackById(id)
  }

  /**
   * Delete music track
   */
  deleteMusicTrack(id: number): void {
    this.musicRepo.deleteMusicTrack(id)
  }

  /**
   * Update music artist counts
   */
  updateMusicArtistCounts(artistId: number, albumCount: number, trackCount: number): void {
    this.musicRepo.updateMusicArtistCounts(artistId, albumCount, trackCount)
  }

  /**
   * Update music artist MusicBrainz ID
   */
  updateMusicArtistMbid(artistId: number, musicbrainzId: string): void {
    this.musicRepo.updateMusicArtistMbid(artistId, musicbrainzId)
  }

  /**
   * Update music album MusicBrainz ID
   */
  updateMusicAlbumMbid(albumId: number, musicbrainzId: string): void {
    this.musicRepo.updateMusicAlbumMbid(albumId, musicbrainzId)
  }

  /**
   * Get music library stats
   */
  getMusicStats(sourceId?: string): {
    totalArtists: number
    totalAlbums: number
    totalTracks: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    const whereClause = sourceId ? ' WHERE source_id = ?' : ''
    const params = sourceId ? [sourceId] : []

    const artistsStmt = this.db.prepare(`SELECT COUNT(*) as count FROM music_artists${whereClause}`)
    const albumsStmt = this.db.prepare(`SELECT COUNT(*) as count FROM music_albums${whereClause}`)
    const tracksStmt = this.db.prepare(`SELECT COUNT(*) as count FROM music_tracks${whereClause}`)

    return {
      totalArtists: ((artistsStmt.get(...params) as { count: number }) || { count: 0 }).count,
      totalAlbums: ((albumsStmt.get(...params) as { count: number }) || { count: 0 }).count,
      totalTracks: ((tracksStmt.get(...params) as { count: number }) || { count: 0 }).count,
    }
  }

  // ============================================================================
  // SERIES COMPLETENESS
  // ============================================================================

  /**
   * Upsert series completeness data
   */
  upsertSeriesCompleteness(
    data: Omit<SeriesCompleteness, 'id' | 'created_at' | 'updated_at'>
  ): number {
    if (!this.db) throw new Error('Database not initialized')

    const sourceId = data.source_id || ''
    const libraryId = data.library_id || ''

    // Check if record exists
    let existingId: number | null = null
    if (sourceId === '' && libraryId === '') {
      const stmt = this.db.prepare(
        "SELECT id FROM series_completeness WHERE series_title = ? AND (source_id = '' OR source_id IS NULL) AND (library_id = '' OR library_id IS NULL)"
      )
      const row = stmt.get(data.series_title) as { id: number } | undefined
      existingId = row?.id || null
    } else if (sourceId === '') {
      const stmt = this.db.prepare(
        "SELECT id FROM series_completeness WHERE series_title = ? AND (source_id = '' OR source_id IS NULL) AND library_id = ?"
      )
      const row = stmt.get(data.series_title, libraryId) as { id: number } | undefined
      existingId = row?.id || null
    } else if (libraryId === '') {
      const stmt = this.db.prepare(
        "SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND (library_id = '' OR library_id IS NULL)"
      )
      const row = stmt.get(data.series_title, sourceId) as { id: number } | undefined
      existingId = row?.id || null
    } else {
      const stmt = this.db.prepare(
        'SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id = ?'
      )
      const row = stmt.get(data.series_title, sourceId, libraryId) as { id: number } | undefined
      existingId = row?.id || null
    }

    if (existingId !== null) {
      this.db.prepare(`
        UPDATE series_completeness SET
          total_seasons = ?, total_episodes = ?, owned_seasons = ?, owned_episodes = ?,
          missing_seasons = ?, missing_episodes = ?, completeness_percentage = ?,
          tmdb_id = ?, poster_url = ?, backdrop_url = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        data.total_seasons, data.total_episodes, data.owned_seasons, data.owned_episodes,
        data.missing_seasons, data.missing_episodes, data.completeness_percentage,
        data.tmdb_id || null, data.poster_url || null, data.backdrop_url || null,
        data.status || null, existingId
      )
      return existingId
    }

    const result = this.db.prepare(`
      INSERT INTO series_completeness (
        series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes,
        completeness_percentage, tmdb_id, poster_url, backdrop_url, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      data.series_title, sourceId, libraryId, data.total_seasons, data.total_episodes,
      data.owned_seasons, data.owned_episodes, data.missing_seasons, data.missing_episodes,
      data.completeness_percentage, data.tmdb_id || null, data.poster_url || null,
      data.backdrop_url || null, data.status || null
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Get series completeness (deduplicated by series_title)
   */
  getSeriesCompleteness(sourceId?: string): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    const sourceFilter = sourceId ? ' AND source_id = ?' : ''
    const params: unknown[] = sourceId ? [sourceId] : []

    const stmt = this.db.prepare(`
      SELECT sc.*
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE 1=1${sourceFilter}
        GROUP BY series_title
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE 1=1${sourceFilter}
      GROUP BY sc.series_title
      ORDER BY sc.series_title ASC
    `)
    const allParams = sourceId ? [...params, ...params] : []
    return stmt.all(...allParams) as SeriesCompleteness[]
  }

  /**
   * Get all series completeness records
   */
  getAllSeriesCompleteness(sourceId?: string, libraryId?: string): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM series_completeness WHERE 1=1'
    const params: unknown[] = []

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as SeriesCompleteness[]
  }

  /**
   * Get series completeness by title
   */
  getSeriesCompletenessByTitle(
    seriesTitle: string,
    sourceId?: string,
    libraryId?: string
  ): SeriesCompleteness | null {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM series_completeness WHERE series_title = ?'
    const params: unknown[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    const stmt = this.db.prepare(sql)
    return (stmt.get(...params) as SeriesCompleteness) || null
  }

  /**
   * Get incomplete series (completeness < 100%)
   * @param sourceId Optional source ID to filter by
   */
  getIncompleteSeries(sourceId?: string): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    const sourceFilter = sourceId ? ' AND source_id = ?' : ''
    const params: unknown[] = sourceId ? [sourceId] : []

    const stmt = this.db.prepare(`
      SELECT sc.*
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE tmdb_id IS NOT NULL${sourceFilter}
        GROUP BY series_title
        HAVING max_pct < 100
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE sc.tmdb_id IS NOT NULL${sourceFilter}
      GROUP BY sc.series_title
      ORDER BY sc.completeness_percentage ASC
    `)
    // If sourceId is provided, we need to pass it twice (once for subquery, once for outer WHERE)
    const allParams = sourceId ? [...params, ...params] : []
    return stmt.all(...allParams) as SeriesCompleteness[]
  }

  /**
   * Delete series completeness record
   */
  deleteSeriesCompleteness(id: number): boolean {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM series_completeness WHERE id = ?').run(id)
    return true
  }

  /**
   * Get TV shows grouped by series_title with pagination support
   */
  getTVShows(filters?: TVShowFilters): TVShowSummary[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = `
      SELECT
        COALESCE(m.series_title, 'Unknown Series') as series_title,
        MIN(m.sort_title) as sort_title,
        COUNT(*) as episode_count,
        COUNT(DISTINCT m.season_number) as season_count,
        MAX(m.poster_url) as poster_url,
        MIN(m.source_id) as source_id,
        MIN(m.source_type) as source_type,
        CAST(AVG(q.efficiency_score) AS INTEGER) as efficiency_score,
        SUM(q.storage_debt_bytes) as storage_debt_bytes,
        SUM(m.file_size) as total_size
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      WHERE m.type = 'episode'
    `
    const params: unknown[] = []

    if (filters?.sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }

    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND COALESCE(m.series_title, 'Unknown Series') NOT GLOB '[A-Za-z]*'"
      } else {
        sql += " AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) = ?"
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }

    if (filters?.searchQuery) {
      sql += " AND COALESCE(m.series_title, 'Unknown Series') LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }

    sql += " GROUP BY COALESCE(m.series_title, 'Unknown Series')"

    if (filters?.slimDown) {
      sql += " HAVING AVG(q.efficiency_score) < 60 OR SUM(q.storage_debt_bytes) > 5368709120"
    }

    // Sorting
    const sortOrder = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    switch (filters?.sortBy) {
      case 'episode_count':
        sql += ` ORDER BY episode_count ${sortOrder}`
        break
      case 'season_count':
        sql += ` ORDER BY season_count ${sortOrder}`
        break
      case 'efficiency':
        sql += ` ORDER BY efficiency_score ${sortOrder}`
        break
      case 'storage_debt':
        sql += ` ORDER BY storage_debt_bytes ${sortOrder}`
        break
      case 'size':
        sql += ` ORDER BY total_size ${sortOrder}`
        break
      default:
        sql += ` ORDER BY COALESCE(sort_title, series_title) ${sortOrder}`
    }

    // Pagination
    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
      if (filters.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as TVShowSummary[]
  }

  /**
   * Count distinct TV shows matching filters
   */
  countTVShows(filters?: TVShowFilters): number {
    if (!this.db) throw new Error('Database not initialized')

    let sql = `
      SELECT COUNT(*) as count FROM (
        SELECT 1
        FROM media_items m
        LEFT JOIN quality_scores q ON m.id = q.media_item_id
        WHERE m.type = 'episode'
    `
    const params: unknown[] = []

    if (filters?.sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }

    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND COALESCE(m.series_title, 'Unknown Series') NOT GLOB '[A-Za-z]*'"
      } else {
        sql += " AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) = ?"
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }

    if (filters?.searchQuery) {
      sql += " AND COALESCE(m.series_title, 'Unknown Series') LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }

    sql += " GROUP BY COALESCE(m.series_title, 'Unknown Series')"

    if (filters?.slimDown) {
      sql += " HAVING AVG(q.efficiency_score) < 60 OR SUM(q.storage_debt_bytes) > 5368709120"
    }
    
    sql += ")"

    const stmt = this.db.prepare(sql)
    const result = stmt.get(...params) as { count: number }
    return result?.count || 0
  }

  /**
   * Count total TV episodes matching filters
   */
  countTVEpisodes(filters?: TVShowFilters): number {
    if (!this.db) throw new Error('Database not initialized')

    let sql = `
      SELECT SUM(episode_count) as count FROM (
        SELECT COUNT(*) as episode_count
        FROM media_items m
        LEFT JOIN quality_scores q ON m.id = q.media_item_id
        WHERE m.type = 'episode'
    `
    const params: unknown[] = []

    if (filters?.sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }

    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND COALESCE(m.series_title, 'Unknown Series') NOT GLOB '[A-Za-z]*'"
      } else {
        sql += " AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) = ?"
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }

    if (filters?.searchQuery) {
      sql += " AND COALESCE(m.series_title, 'Unknown Series') LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }

    sql += " GROUP BY COALESCE(m.series_title, 'Unknown Series')"

    if (filters?.slimDown) {
      sql += " HAVING AVG(q.efficiency_score) < 60 OR SUM(q.storage_debt_bytes) > 5368709120"
    }

    sql += ")"

    const stmt = this.db.prepare(sql)
    const result = stmt.get(...params) as { count: number }
    return result?.count || 0
  }

  /**
   * Get the offset (count of items before) a given letter for alphabet jump navigation.
   * Returns the number of items that sort before the target letter.
   */
  getLetterOffset(
    table: 'movies' | 'tvshows' | 'artists' | 'albums',
    letter: string,
    filters?: { sourceId?: string; libraryId?: string }
  ): number {
    if (!this.db) throw new Error('Database not initialized')

    // '#' = non-alpha chars, which sort first ΓåÆ offset 0
    if (letter === '#') return 0

    const upperLetter = letter.toUpperCase()
    let sql: string
    const params: unknown[] = []

    if (table === 'movies') {
      sql = `
        SELECT COUNT(*) as count FROM media_items m
        LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
        WHERE m.type = 'movie' AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
          AND UPPER(SUBSTR(COALESCE(m.sort_title, m.title), 1, 1)) < ?
      `
      params.push(upperLetter)
      if (filters?.sourceId) { sql += ' AND m.source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND m.library_id = ?'; params.push(filters.libraryId) }
    } else if (table === 'tvshows') {
      sql = `
        SELECT COUNT(DISTINCT COALESCE(m.series_title, 'Unknown Series')) as count FROM media_items m
        WHERE m.type = 'episode'
          AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) < ?
      `
      params.push(upperLetter)
      if (filters?.sourceId) { sql += ' AND m.source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND m.library_id = ?'; params.push(filters.libraryId) }
    } else if (table === 'artists') {
      sql = `
        SELECT COUNT(*) as count FROM music_artists
        WHERE UPPER(SUBSTR(COALESCE(sort_name, name), 1, 1)) < ?
      `
      params.push(upperLetter)
      if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    } else {
      // albums
      sql = `
        SELECT COUNT(*) as count FROM music_albums
        WHERE UPPER(SUBSTR(title, 1, 1)) < ?
      `
      params.push(upperLetter)
      if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    }

    const stmt = this.db.prepare(sql)
    const result = stmt.get(...params) as { count: number }
    return result?.count || 0
  }

  /**
   * Get episodes for a series
   */
  getEpisodesForSeries(
    seriesTitle: string,
    sourceId?: string,
    libraryId?: string
  ): MediaItem[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = `SELECT m.*, q.overall_score, q.needs_upgrade, q.quality_tier, q.tier_quality, q.tier_score, q.issues
FROM media_items m
LEFT JOIN quality_scores q ON m.id = q.media_item_id
WHERE m.type = 'episode' AND m.series_title = ?`
    const params: unknown[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(libraryId)
    }

    sql += ' ORDER BY m.season_number ASC, m.episode_number ASC'

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MediaItem[]
  }

  /**
   * Get series completeness statistics
   */
  getSeriesCompletenessStats(): {
    totalSeries: number
    completeSeries: number
    incompleteSeries: number
    totalMissingEpisodes: number
    averageCompleteness: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    // Get unique series with their best completeness
    const stmt = this.db.prepare(`
      SELECT series_title, MAX(completeness_percentage) as best_completeness, tmdb_id
      FROM series_completeness
      GROUP BY series_title
    `)
    const rows = stmt.all() as Array<{
      series_title: string
      best_completeness: number
      tmdb_id: string | null
    }>

    const seriesWithTmdb = rows.filter(r => r.tmdb_id !== null)
    const totalSeries = seriesWithTmdb.length
    const completeSeries = seriesWithTmdb.filter(r => r.best_completeness === 100).length
    const incompleteSeries = seriesWithTmdb.filter(r => r.best_completeness < 100).length

    let averageCompleteness = 0
    if (seriesWithTmdb.length > 0) {
      const total = seriesWithTmdb.reduce((sum, r) => sum + r.best_completeness, 0)
      averageCompleteness = Math.round(total / seriesWithTmdb.length)
    }

    // Count missing episodes
    const missingStmt = this.db.prepare(`
      SELECT sc.missing_episodes
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE tmdb_id IS NOT NULL
        GROUP BY series_title
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE sc.tmdb_id IS NOT NULL
      GROUP BY sc.series_title
    `)
    const missingRows = missingStmt.all() as Array<{ missing_episodes: string }>

    let totalMissingEpisodes = 0
    for (const row of missingRows) {
      try {
        const missing = JSON.parse(row.missing_episodes || '[]')
        totalMissingEpisodes += Array.isArray(missing) ? missing.length : 0
      } catch {
        // Ignore parse errors
      }
    }

    return {
      totalSeries,
      completeSeries,
      incompleteSeries,
      totalMissingEpisodes,
      averageCompleteness,
    }
  }

  // ============================================================================
  // MOVIE COLLECTIONS
  // ============================================================================

  /**
   * Upsert movie collection data
   */
  upsertMovieCollection(
    data: Omit<MovieCollection, 'id' | 'created_at' | 'updated_at'>
  ): number {
    if (!this.db) throw new Error('Database not initialized')

    const sourceId = data.source_id || ''
    const libraryId = data.library_id || ''

    // Check if record exists
    let existingId: number | null = null
    if (sourceId === '' && libraryId === '') {
      const stmt = this.db.prepare(
        "SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND (source_id = '' OR source_id IS NULL) AND (library_id = '' OR library_id IS NULL)"
      )
      const row = stmt.get(data.tmdb_collection_id) as { id: number } | undefined
      existingId = row?.id || null
    } else if (sourceId === '') {
      const stmt = this.db.prepare(
        "SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND (source_id = '' OR source_id IS NULL) AND library_id = ?"
      )
      const row = stmt.get(data.tmdb_collection_id, libraryId) as { id: number } | undefined
      existingId = row?.id || null
    } else if (libraryId === '') {
      const stmt = this.db.prepare(
        "SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND (library_id = '' OR library_id IS NULL)"
      )
      const row = stmt.get(data.tmdb_collection_id, sourceId) as { id: number } | undefined
      existingId = row?.id || null
    } else {
      const stmt = this.db.prepare(
        'SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id = ?'
      )
      const row = stmt.get(data.tmdb_collection_id, sourceId, libraryId) as { id: number } | undefined
      existingId = row?.id || null
    }

    if (existingId !== null) {
      this.db.prepare(`
        UPDATE movie_collections SET
          collection_name = ?, total_movies = ?, owned_movies = ?,
          missing_movies = ?, owned_movie_ids = ?, completeness_percentage = ?,
          poster_url = ?, backdrop_url = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        data.collection_name, data.total_movies, data.owned_movies,
        data.missing_movies, data.owned_movie_ids, data.completeness_percentage,
        data.poster_url || null, data.backdrop_url || null, existingId
      )
      return existingId
    }

    const result = this.db.prepare(`
      INSERT INTO movie_collections (
        tmdb_collection_id, collection_name, source_id, library_id,
        total_movies, owned_movies, missing_movies, owned_movie_ids,
        completeness_percentage, poster_url, backdrop_url,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      data.tmdb_collection_id, data.collection_name, sourceId, libraryId,
      data.total_movies, data.owned_movies, data.missing_movies, data.owned_movie_ids,
      data.completeness_percentage, data.poster_url || null, data.backdrop_url || null
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Get all movie collections
   */
  getMovieCollections(sourceId?: string): MovieCollection[] {
    if (!this.db) throw new Error('Database not initialized')
    if (sourceId) {
      const stmt = this.db.prepare('SELECT * FROM movie_collections WHERE source_id = ? ORDER BY collection_name ASC')
      return stmt.all(sourceId) as MovieCollection[]
    }
    const stmt = this.db.prepare('SELECT * FROM movie_collections ORDER BY collection_name ASC')
    return stmt.all() as MovieCollection[]
  }

  /**
   * Get movie collection by TMDB ID
   */
  getMovieCollectionByTmdbId(tmdbCollectionId: string): MovieCollection | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM movie_collections WHERE tmdb_collection_id = ?')
    return (stmt.get(tmdbCollectionId) as MovieCollection) || null
  }

  /**
   * Get incomplete movie collections
   * @param sourceId Optional source ID to filter by
   */
  getIncompleteMovieCollections(sourceId?: string): MovieCollection[] {
    if (!this.db) throw new Error('Database not initialized')

    if (sourceId) {
      const stmt = this.db.prepare(
        'SELECT * FROM movie_collections WHERE completeness_percentage < 100 AND source_id = ? ORDER BY completeness_percentage ASC'
      )
      return stmt.all(sourceId) as MovieCollection[]
    }

    const stmt = this.db.prepare(
      'SELECT * FROM movie_collections WHERE completeness_percentage < 100 ORDER BY completeness_percentage ASC'
    )
    return stmt.all() as MovieCollection[]
  }

  /**
   * Add a media item to a collection
   */
  async addMediaItemToCollection(mediaItemId: number, collectionId: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO media_item_collections (media_item_id, collection_id)
      VALUES (?, ?)
    `)
    stmt.run(mediaItemId, collectionId)
  }

  /**
   * Delete movie collection
   */
  deleteMovieCollection(id: number): boolean {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM movie_collections WHERE id = ?').run(id)
    return true
  }

  /**
   * Clear all movie collections
   */
  clearMovieCollections(sourceId?: string): void {
    if (!this.db) throw new Error('Database not initialized')
    if (sourceId) {
      this.db.prepare('DELETE FROM movie_collections WHERE source_id = ?').run(sourceId)
      getLoggingService().info('[BetterSQLite]', `Cleared movie collections for source ${sourceId}`)
    } else {
      this.db.prepare('DELETE FROM movie_collections').run()
      getLoggingService().info('[BetterSQLiteService]', '[BetterSQLite] Cleared all movie collections')
    }
  }

  /**
   * Delete single-movie collections
   */
  deleteSingleMovieCollections(): number {
    if (!this.db) throw new Error('Database not initialized')

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM movie_collections WHERE total_movies <= 1')
    const count = (countStmt.get() as { count: number }).count

    if (count > 0) {
      this.db.prepare('DELETE FROM movie_collections WHERE total_movies <= 1').run()
      getLoggingService().info('[BetterSQLite]', `Deleted ${count} single-movie collections`)
    }

    return count
  }

  /**
   * Get movie collection statistics
   */
  getMovieCollectionStats(): {
    total: number
    complete: number
    incomplete: number
    totalMissing: number
    avgCompleteness: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM movie_collections')
    const total = (totalStmt.get() as { count: number }).count

    const completeStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM movie_collections WHERE completeness_percentage = 100'
    )
    const complete = (completeStmt.get() as { count: number }).count

    const incompleteStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM movie_collections WHERE completeness_percentage < 100'
    )
    const incomplete = (incompleteStmt.get() as { count: number }).count

    const missingStmt = this.db.prepare(
      'SELECT SUM(json_array_length(missing_movies)) as count FROM movie_collections WHERE missing_movies IS NOT NULL'
    )
    const totalMissing = (missingStmt.get() as { count: number | null }).count || 0

    const avgStmt = this.db.prepare('SELECT AVG(completeness_percentage) as avg FROM movie_collections')
    const avgCompleteness = Math.round((avgStmt.get() as { avg: number | null }).avg || 0)

    return { total, complete, incomplete, totalMissing, avgCompleteness }
  }

  // ============================================================================
  // MUSIC QUALITY SCORES
  // ============================================================================

  /**
   * Upsert music quality score
   */
  upsertMusicQualityScore(score: MusicQualityScore): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO music_quality_scores (
        album_id, quality_tier, tier_quality, tier_score,
        codec_score, bitrate_score, needs_upgrade, issues,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(album_id) DO UPDATE SET
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        codec_score = excluded.codec_score,
        bitrate_score = excluded.bitrate_score,
        needs_upgrade = excluded.needs_upgrade,
        issues = excluded.issues,
        updated_at = datetime('now')
    `)
    stmt.run(
      score.album_id, score.quality_tier, score.tier_quality, score.tier_score,
      score.codec_score, score.bitrate_score, score.needs_upgrade ? 1 : 0, score.issues
    )
  }

  /**
   * Get music quality score for album
   */
  getMusicQualityScore(albumId: number): MusicQualityScore | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_quality_scores WHERE album_id = ?')
    return (stmt.get(albumId) as MusicQualityScore) || null
  }

  /**
   * Get albums needing upgrade
   * @param limit Maximum number of albums to return
   * @param sourceId Optional source ID to filter by
   */
  getAlbumsNeedingUpgrade(limit?: number, sourceId?: string): MusicAlbum[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = `
      SELECT a.* FROM music_albums a
      INNER JOIN music_quality_scores q ON a.id = q.album_id
      WHERE q.needs_upgrade = 1
    `

    if (sourceId) {
      sql += ` AND a.source_id = ?`
    }

    sql += ` ORDER BY q.tier_score ASC`

    if (limit) {
      sql += ` LIMIT ${limit}`
    }

    const stmt = this.db.prepare(sql)
    return sourceId ? (stmt.all(sourceId) as MusicAlbum[]) : (stmt.all() as MusicAlbum[])
  }

  // ============================================================================
  // ARTIST/ALBUM COMPLETENESS
  // ============================================================================

  /**
   * Upsert artist completeness
   */
  upsertArtistCompleteness(data: ArtistCompleteness): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO artist_completeness (
        artist_name, musicbrainz_id, library_id, total_albums, owned_albums,
        total_singles, owned_singles, total_eps, owned_eps,
        missing_albums, missing_singles, missing_eps,
        completeness_percentage, country, active_years, artist_type,
        thumb_url, last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(artist_name) DO UPDATE SET
        musicbrainz_id = excluded.musicbrainz_id,
        library_id = excluded.library_id,
        total_albums = excluded.total_albums,
        owned_albums = excluded.owned_albums,
        total_singles = excluded.total_singles,
        owned_singles = excluded.owned_singles,
        total_eps = excluded.total_eps,
        owned_eps = excluded.owned_eps,
        missing_albums = excluded.missing_albums,
        missing_singles = excluded.missing_singles,
        missing_eps = excluded.missing_eps,
        completeness_percentage = excluded.completeness_percentage,
        country = excluded.country,
        active_years = excluded.active_years,
        artist_type = excluded.artist_type,
        thumb_url = excluded.thumb_url,
        last_sync_at = excluded.last_sync_at,
        updated_at = datetime('now')
    `)
    stmt.run(
      data.artist_name, data.musicbrainz_id || null, data.library_id || '',
      data.total_albums, data.owned_albums,
      data.total_singles, data.owned_singles, data.total_eps, data.owned_eps,
      data.missing_albums, data.missing_singles, data.missing_eps,
      data.completeness_percentage, data.country || null, data.active_years || null,
      data.artist_type || null, data.thumb_url || null, data.last_sync_at || null
    )
  }

  /**
   * Get artist completeness by name
   */
  getArtistCompleteness(artistName: string): ArtistCompleteness | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM artist_completeness WHERE artist_name = ?')
    return (stmt.get(artistName) as ArtistCompleteness) || null
  }

  /**
   * Get all artist completeness records
   * @param sourceId Optional source ID to filter by (filters by artists in that source)
   */
  getAllArtistCompleteness(sourceId?: string): ArtistCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    if (sourceId) {
      // When filtering by source, only return completeness for artists that exist in that source
      const stmt = this.db.prepare(`
        SELECT DISTINCT ac.*, ma.thumb_url
        FROM artist_completeness ac
        INNER JOIN music_artists ma ON ac.artist_name = ma.name AND ma.source_id = ?
        ORDER BY ac.artist_name ASC
      `)
      return stmt.all(sourceId) as ArtistCompleteness[]
    }

    const stmt = this.db.prepare(`
      SELECT ac.*, ma.thumb_url
      FROM artist_completeness ac
      LEFT JOIN music_artists ma ON ac.artist_name = ma.name
      ORDER BY ac.artist_name ASC
    `)
    return stmt.all() as ArtistCompleteness[]
  }

  /**
   * Upsert album completeness
   */
  upsertAlbumCompleteness(data: AlbumCompleteness): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO album_completeness (
        album_id, artist_name, album_title,
        musicbrainz_release_id, musicbrainz_release_group_id,
        total_tracks, owned_tracks, missing_tracks,
        completeness_percentage, last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(album_id) DO UPDATE SET
        artist_name = excluded.artist_name,
        album_title = excluded.album_title,
        musicbrainz_release_id = excluded.musicbrainz_release_id,
        musicbrainz_release_group_id = excluded.musicbrainz_release_group_id,
        total_tracks = excluded.total_tracks,
        owned_tracks = excluded.owned_tracks,
        missing_tracks = excluded.missing_tracks,
        completeness_percentage = excluded.completeness_percentage,
        last_sync_at = excluded.last_sync_at,
        updated_at = datetime('now')
    `)
    stmt.run(
      data.album_id, data.artist_name, data.album_title,
      data.musicbrainz_release_id || null, data.musicbrainz_release_group_id || null,
      data.total_tracks, data.owned_tracks, data.missing_tracks,
      data.completeness_percentage, data.last_sync_at || null
    )
  }

  /**
   * Get album completeness by album ID
   */
  getAlbumCompleteness(albumId: number): AlbumCompleteness | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM album_completeness WHERE album_id = ?')
    return (stmt.get(albumId) as AlbumCompleteness) || null
  }

  /**
   * Get all album completeness records
   */
  getAllAlbumCompleteness(): AlbumCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM album_completeness ORDER BY artist_name, album_title')
    return stmt.all() as AlbumCompleteness[]
  }

  /**
   * Get album completeness by artist name
   */
  getAlbumCompletenessByArtist(artistName: string): AlbumCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM album_completeness WHERE artist_name = ?')
    return stmt.all(artistName) as AlbumCompleteness[]
  }

  /**
   * Get incomplete albums
   */
  getIncompleteAlbums(): AlbumCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      'SELECT * FROM album_completeness WHERE completeness_percentage < 100 ORDER BY completeness_percentage ASC'
    )
    return stmt.all() as AlbumCompleteness[]
  }

  // ============================================================================
  // WISHLIST
  // ============================================================================

  /**
   * Add wishlist item
   */
  addWishlistItem(item: Partial<WishlistItem>): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO wishlist_items (
        media_type, title, subtitle, year, reason,
        tmdb_id, imdb_id, musicbrainz_id, series_title,
        season_number, episode_number, collection_name,
        artist_name, album_title, poster_url, priority, notes,
        status, current_quality_tier, current_quality_level,
        current_resolution, current_video_codec, current_audio_codec,
        media_item_id, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)

    const result = stmt.run(
      item.media_type || 'movie',
      item.title || '',
      item.subtitle || null,
      item.year || null,
      item.reason || 'missing',
      item.tmdb_id || null,
      item.imdb_id || null,
      item.musicbrainz_id || null,
      item.series_title || null,
      item.season_number || null,
      item.episode_number || null,
      item.collection_name || null,
      item.artist_name || null,
      item.album_title || null,
      item.poster_url || null,
      item.priority || 3,
      item.notes || null,
      item.status || 'active',
      item.current_quality_tier || null,
      item.current_quality_level || null,
      item.current_resolution || null,
      item.current_video_codec || null,
      item.current_audio_codec || null,
      item.media_item_id || null
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Add multiple wishlist items in bulk
   */
  addWishlistItemsBulk(items: Partial<WishlistItem>[]): number {
    if (!this.db) throw new Error('Database not initialized')
    if (items.length === 0) return 0

    let added = 0

    const insertStmt = this.db.prepare(`
      INSERT INTO wishlist_items (
        media_type, title, subtitle, year, reason,
        tmdb_id, imdb_id, musicbrainz_id, series_title,
        season_number, episode_number, collection_name,
        artist_name, album_title, poster_url, priority, notes,
        status, current_quality_tier, current_quality_level,
        current_resolution, current_video_codec, current_audio_codec,
        media_item_id, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)

    const updatePosterStmt = this.db.prepare(
      'UPDATE wishlist_items SET poster_url = ?, updated_at = datetime(\'now\') WHERE tmdb_id = ? AND (poster_url IS NULL OR poster_url = \'\')'
    )

    const insertMany = this.db.transaction((items: Partial<WishlistItem>[]) => {
      for (const item of items) {
        // If already exists, update poster if missing then skip insert
        if (item.tmdb_id && this.wishlistItemExists(item.tmdb_id)) {
          if (item.poster_url) updatePosterStmt.run(item.poster_url, item.tmdb_id)
          continue
        }
        if (item.musicbrainz_id && this.wishlistItemExists(undefined, item.musicbrainz_id)) continue

        insertStmt.run(
          item.media_type || 'movie',
          item.title || '',
          item.subtitle || null,
          item.year || null,
          item.reason || 'missing',
          item.tmdb_id || null,
          item.imdb_id || null,
          item.musicbrainz_id || null,
          item.series_title || null,
          item.season_number || null,
          item.episode_number || null,
          item.collection_name || null,
          item.artist_name || null,
          item.album_title || null,
          item.poster_url || null,
          item.priority || 3,
          item.notes || null,
          item.status || 'active',
          item.current_quality_tier || null,
          item.current_quality_level || null,
          item.current_resolution || null,
          item.current_video_codec || null,
          item.current_audio_codec || null,
          item.media_item_id || null
        )
        added++
      }
    })

    insertMany(items)
    return added
  }

  /**
   * Update wishlist item
   */
  updateWishlistItem(id: number, updates: Partial<WishlistItem>): void {
    if (!this.db) throw new Error('Database not initialized')

    const fields: string[] = []
    const params: unknown[] = []

    if (updates.priority !== undefined) {
      fields.push('priority = ?')
      params.push(updates.priority)
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?')
      params.push(updates.notes)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      params.push(updates.status)
      if (updates.status === 'completed') {
        fields.push("completed_at = datetime('now')")
      }
    }
    if (updates.poster_url !== undefined) {
      fields.push('poster_url = ?')
      params.push(updates.poster_url)
    }

    if (fields.length === 0) return

    fields.push("updated_at = datetime('now')")
    params.push(id)

    const sql = `UPDATE wishlist_items SET ${fields.join(', ')} WHERE id = ?`
    this.db.prepare(sql).run(...params)
  }

  /**
   * Remove wishlist item
   */
  removeWishlistItem(id: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(id)
  }

  /**
   * Get wishlist items with filters
   */
  getWishlistItems(filters?: WishlistFilters): WishlistItem[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM wishlist_items WHERE 1=1'
    const params: unknown[] = []

    if (filters?.media_type) {
      sql += ' AND media_type = ?'
      params.push(filters.media_type)
    }
    if (filters?.priority) {
      sql += ' AND priority = ?'
      params.push(filters.priority)
    }
    if (filters?.reason) {
      sql += ' AND reason = ?'
      params.push(filters.reason)
    }
    if (filters?.status) {
      sql += ' AND status = ?'
      params.push(filters.status)
    }
    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR series_title LIKE ? OR artist_name LIKE ?)'
      const search = `%${filters.searchQuery}%`
      params.push(search, search, search)
    }

    // Sorting
    const sortColumn = filters?.sortBy || 'added_at'
    const sortOrder = filters?.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
    sql += ` ORDER BY ${sortColumn} ${sortOrder}`

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as WishlistItem[]
  }

  /**
   * Get wishlist item by ID
   */
  getWishlistItemById(id: number): WishlistItem | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM wishlist_items WHERE id = ?')
    return (stmt.get(id) as WishlistItem) || null
  }

  /**
   * Get wishlist count
   */
  getWishlistCount(): number {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM wishlist_items')
    return (stmt.get() as { count: number }).count
  }

  /**
   * Check if wishlist item exists
   */
  wishlistItemExists(tmdbId?: string, musicbrainzId?: string, mediaItemId?: number): boolean {
    if (!this.db) throw new Error('Database not initialized')

    if (mediaItemId) {
      const stmt = this.db.prepare('SELECT 1 FROM wishlist_items WHERE media_item_id = ?')
      return !!stmt.get(mediaItemId)
    }
    if (tmdbId) {
      const stmt = this.db.prepare('SELECT 1 FROM wishlist_items WHERE tmdb_id = ?')
      return !!stmt.get(tmdbId)
    }
    if (musicbrainzId) {
      const stmt = this.db.prepare('SELECT 1 FROM wishlist_items WHERE musicbrainz_id = ?')
      return !!stmt.get(musicbrainzId)
    }

    return false
  }

  /**
   * Get wishlist counts by reason
   */
  getWishlistCountsByReason(): {
    missing: number
    upgrade: number
    active: number
    completed: number
    total: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    const missingStmt = this.db.prepare("SELECT COUNT(*) as count FROM wishlist_items WHERE reason = 'missing'")
    const upgradeStmt = this.db.prepare("SELECT COUNT(*) as count FROM wishlist_items WHERE reason = 'upgrade'")
    const activeStmt = this.db.prepare("SELECT COUNT(*) as count FROM wishlist_items WHERE status = 'active'")
    const completedStmt = this.db.prepare("SELECT COUNT(*) as count FROM wishlist_items WHERE status = 'completed'")
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM wishlist_items')

    return {
      missing: (missingStmt.get() as { count: number }).count,
      upgrade: (upgradeStmt.get() as { count: number }).count,
      active: (activeStmt.get() as { count: number }).count,
      completed: (completedStmt.get() as { count: number }).count,
      total: (totalStmt.get() as { count: number }).count,
    }
  }

  // ============================================================================
  // QUALITY SCORES (extended)
  // ============================================================================

  /**
   * Get all quality scores
   */
  getQualityScores(): QualityScore[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM quality_scores')
    return stmt.all() as QualityScore[]
  }

  /**
   * Get quality score by media item ID (alias)
   */
  getQualityScoreByMediaId(mediaItemId: number): QualityScore | null {
    return this.getQualityScore(mediaItemId)
  }

  // ============================================================================
  // MEDIA ITEMS (extended)
  // ============================================================================

  /**
   * Get media item by ID (alias for getMediaItem)
   */
  getMediaItemById(id: number): MediaItem | null {
    return this.getMediaItem(id)
  }

  /**
   * Update series match (TMDB ID) for all episodes of a series
   */
  updateSeriesMatch(
    seriesTitle: string,
    sourceId: string,
    tmdbId: string,
    posterUrl?: string,
    newSeriesTitle?: string
  ): number {
    if (!this.db) throw new Error('Database not initialized')

    const params: unknown[] = [tmdbId, 1]
    let sql = 'UPDATE media_items SET series_tmdb_id = ?, user_fixed_match = ?'

    if (posterUrl) {
      sql += ', poster_url = ?'
      params.push(posterUrl)
    }
    if (newSeriesTitle) {
      sql += ', series_title = ?'
      params.push(newSeriesTitle)
    }

    sql += " WHERE series_title = ? AND source_id = ? AND type = 'episode'"
    params.push(seriesTitle, sourceId)

    this.db.prepare(sql).run(...params)

    // Update series_completeness if title changed
    if (newSeriesTitle && newSeriesTitle !== seriesTitle) {
      this.db.prepare(
        'UPDATE series_completeness SET series_title = ? WHERE series_title = ? AND source_id = ?'
      ).run(newSeriesTitle, seriesTitle, sourceId)
    }

    // Return count of updated episodes
    const titleToQuery = newSeriesTitle || seriesTitle
    const countStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE series_title = ? AND source_id = ? AND type = 'episode'"
    )
    return (countStmt.get(titleToQuery, sourceId) as { count: number }).count
  }

  /**
   * Update movie match (TMDB ID, poster, etc.)
   */
  updateMovieMatch(
    mediaItemId: number,
    tmdbId: string,
    posterUrl?: string,
    title?: string,
    year?: number
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const params: unknown[] = [tmdbId, 1]
    let sql = 'UPDATE media_items SET tmdb_id = ?, user_fixed_match = ?'

    if (posterUrl) {
      sql += ', poster_url = ?'
      params.push(posterUrl)
    }
    if (title) {
      sql += ', title = ?'
      params.push(title)
    }
    if (year !== undefined) {
      sql += ', year = ?'
      params.push(year)
    }

    sql += " WHERE id = ? AND type = 'movie'"
    params.push(mediaItemId)

    this.db.prepare(sql).run(...params)
  }

  /**
   * Update artist match (MusicBrainz ID)
   */
  updateArtistMatch(artistId: number, musicbrainzId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      'UPDATE music_artists SET musicbrainz_id = ?, user_fixed_match = 1 WHERE id = ?'
    ).run(musicbrainzId, artistId)
  }

  /**
   * Update album match (MusicBrainz ID)
   */
  updateAlbumMatch(albumId: number, musicbrainzId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      'UPDATE music_albums SET musicbrainz_id = ?, user_fixed_match = 1 WHERE id = ?'
    ).run(musicbrainzId, albumId)
  }

  /**
   * Update movie TMDB ID (automatic lookup, not user-initiated)
   */
  updateMovieWithTMDBId(mediaItemId: number, tmdbId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      "UPDATE media_items SET tmdb_id = ? WHERE id = ? AND type = 'movie'"
    ).run(tmdbId, mediaItemId)
  }

  /**
   * Remove stale media items
   */
  removeStaleMediaItems(validPlexIds: Set<string>, type: 'movie' | 'episode'): number {
    if (!this.db) throw new Error('Database not initialized')

    // Get all items of the specified type
    const stmt = this.db.prepare('SELECT id, plex_id FROM media_items WHERE type = ?')
    const items = stmt.all(type) as Array<{ id: number; plex_id: string }>

    let removedCount = 0
    const deleteStmt = this.db.prepare('DELETE FROM media_items WHERE id = ?')
    const deleteScoreStmt = this.db.prepare('DELETE FROM quality_scores WHERE media_item_id = ?')

    const transaction = this.db.transaction(() => {
      for (const item of items) {
        if (!validPlexIds.has(item.plex_id)) {
          deleteScoreStmt.run(item.id)
          deleteStmt.run(item.id)
          removedCount++
        }
      }
    })
    transaction()

    return removedCount
  }

  /**
   * Update media item artwork
   */
  updateMediaItemArtwork(
    sourceIdOrId: string | number,
    providerIdOrArtwork: string | { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string },
    artwork?: { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string }
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    if (typeof sourceIdOrId === 'number') {
      const id = sourceIdOrId
      const actualArtwork = providerIdOrArtwork as { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string }
      this.mediaRepo.updateMediaItemArtwork(id, actualArtwork)
      return
    }

    const sourceId = sourceIdOrId
    const providerId = providerIdOrArtwork as string
    const actualArtwork = artwork
    if (!actualArtwork) return

    const item = this.mediaRepo.getMediaItemByProviderId(providerId, sourceId)
    if (item?.id) {
      this.mediaRepo.updateMediaItemArtwork(item.id, actualArtwork)
    }
  }

  // ============================================================================
  // TRANSACTION SUPPORT
  // ============================================================================

  /**
   * Run a function in a transaction
   */
  transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not initialized')
    return this.db.transaction(fn)()
  }

  /**
   * Export all database data to JSON
   */
  exportData(): Record<string, unknown[]> {
    if (!this.db) throw new Error('Database not initialized')

    const tables = [
      'media_sources',
      'media_items',
      'quality_scores',
      'settings',
      'series_completeness',
      'movie_collections',
      'music_artists',
      'music_albums',
      'music_tracks',
      'music_quality_scores',
      'artist_completeness',
      'album_completeness',
    ]

    const exportedData: Record<string, unknown[]> = {
      _meta: [{
        exportedAt: new Date().toISOString(),
        version: '2.0',
        engine: 'better-sqlite3',
        tables: tables,
      }]
    }

    for (const table of tables) {
      try {
        const stmt = this.db.prepare(`SELECT * FROM ${table}`)
        exportedData[table] = stmt.all()
      } catch {
        exportedData[table] = []
      }
    }

    return exportedData
  }

  /**
   * Import data from exported JSON
   */
  importData(data: Record<string, unknown[]>): { imported: number; errors: string[] } {
    if (!this.db) throw new Error('Database not initialized')

    const errors: string[] = []
    let imported = 0

    const importOrder = [
      'settings',
      'media_sources',
      'media_items',
      'quality_scores',
      'series_completeness',
      'movie_collections',
      'music_artists',
      'music_albums',
      'music_tracks',
      'music_quality_scores',
      'artist_completeness',
      'album_completeness',
    ]

    const transaction = this.db.transaction(() => {
      for (const table of importOrder) {
        if (!data[table] || !Array.isArray(data[table]) || data[table].length === 0) {
          continue
        }

        const rows = data[table] as Record<string, unknown>[]

        for (const row of rows) {
          try {
            const columns = Object.keys(row).filter(k => row[k] !== undefined)
            const values = columns.map(k => row[k])
            const placeholders = columns.map(() => '?').join(', ')

            const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
            this.db!.prepare(sql).run(...values)
            imported++
          } catch (error: unknown) {
            errors.push(`${table}: ${getErrorMessage(error)}`)
          }
        }
      }
    })

    try {
      transaction()
    } catch (error: unknown) {
      errors.push(`Import failed: ${getErrorMessage(error)}`)
    }

    return { imported, errors }
  }

  /**
   * Reset the database (delete all data)
   */
  resetDatabase(): void {
    if (!this.db) throw new Error('Database not initialized')

    const tables = [
      'album_completeness',
      'artist_completeness',
      'music_quality_scores',
      'music_tracks',
      'music_albums',
      'music_artists',
      'movie_collections',
      'series_completeness',
      'quality_scores',
      'media_items',
      'media_sources',
      'library_scans',
      'wishlist_items',
      'notifications',
      'settings',
    ]

    const transaction = this.db.transaction(() => {
      for (const table of tables) {
        try {
          this.db!.prepare(`DELETE FROM ${table}`).run()
        } catch {
          getLoggingService().info('[BetterSQLite]', `Could not clear table ${table}`)
        }
      }
    })
    transaction()
  }

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  /**
   * Create a notification
   */
  createNotification(notification: Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>): number {
    return this.notificationRepo.createNotification(notification)
  }

  /**
   * Create multiple notifications
   */
  createNotifications(notifications: Array<Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>>): number[] {
    return this.notificationRepo.createNotifications(notifications)
  }

  /**
   * Get notifications with optional filtering
   */
  getNotifications(options: GetNotificationsOptions = {}): Notification[] {
    return this.notificationRepo.getNotifications(options)
  }

  /**
   * Get unread notifications
   */
  getUnreadNotifications(): Notification[] {
    return this.notificationRepo.getNotifications({ unreadOnly: true })
  }

  /**
   * Get notification count
   */
  getNotificationCount(): NotificationCountResult {
    const unread = this.notificationRepo.getUnreadCount()
    const totalRow = this.db!.prepare('SELECT COUNT(*) as count FROM notifications').get() as { count: number }
    return { total: totalRow.count, unread }
  }

  /**
   * Mark notifications as read
   */
  markNotificationsRead(ids: number[]): void {
    this.notificationRepo.markAsRead(ids)
  }

  /**
   * Mark all notifications as read
   */
  markAllNotificationsRead(): void {
    this.notificationRepo.markAllAsRead()
  }

  /**
   * Delete notifications
   */
  deleteNotifications(ids: number[]): void {
    this.notificationRepo.deleteNotifications(ids)
  }

  /**
   * Clear all notifications
   */
  clearAllNotifications(): void {
    this.notificationRepo.deleteAllNotifications()
  }

  /**
   * Prune old notifications
   */
  pruneNotifications(maxCount: number): number {
    if (!this.db) throw new Error('Database not initialized')

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM notifications')
    const totalCount = (countStmt.get() as { count: number }).count

    if (totalCount <= maxCount) return 0

    const deleteCount = totalCount - maxCount

    this.db.prepare(`
      DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications ORDER BY created_at ASC LIMIT ?
      )
    `).run(deleteCount)

    return deleteCount
  }

  // ============================================================================
  // GLOBAL SEARCH
  // ============================================================================

  /**
   * Global search across all media types
   */
  globalSearch(query: string, maxResults = 5): {
    movies: Array<{ id: number; title: string; year?: number; poster_url?: string }>
    tvShows: Array<{ id: number; title: string; poster_url?: string }>
    episodes: Array<{ id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string }>
    artists: Array<{ id: number; name: string; thumb_url?: string }>
    albums: Array<{ id: number; title: string; artist_name: string; year?: number; thumb_url?: string }>
    tracks: Array<{ id: number; title: string; album_id?: number; album_title?: string; artist_name?: string; album_thumb_url?: string }>
  } {
    if (!this.db || !query) {
      return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }
    }

    // For very short queries (1-2 chars), use exact title match to avoid overly broad LIKE results
    const isShortQuery = query.length <= 2
    const searchQuery = isShortQuery ? query.toLowerCase() : `%${query.toLowerCase()}%`
    const likeOp = isShortQuery ? '=' : 'LIKE'

    // Search movies
    const moviesStmt = this.db.prepare(`
      SELECT id, title, year, poster_url
      FROM media_items
      WHERE type = 'movie' AND LOWER(title) ${likeOp} ?
      ORDER BY title
      LIMIT ?
    `)
    const movies = moviesStmt.all(searchQuery, maxResults) as Array<{
      id: number; title: string; year?: number; poster_url?: string
    }>

    // Search TV shows (unique series titles)
    const tvShowsStmt = this.db.prepare(`
      SELECT MIN(id) as id, series_title as title, MIN(poster_url) as poster_url
      FROM media_items
      WHERE type = 'episode' AND series_title IS NOT NULL AND LOWER(series_title) ${likeOp} ?
      GROUP BY series_title
      ORDER BY series_title
      LIMIT ?
    `)
    const tvShows = tvShowsStmt.all(searchQuery, maxResults) as Array<{
      id: number; title: string; poster_url?: string
    }>

    // Search episodes
    const episodesStmt = this.db.prepare(`
      SELECT id, title, series_title, season_number, episode_number, episode_thumb_url as poster_url
      FROM media_items
      WHERE type = 'episode' AND (LOWER(title) ${likeOp} ? OR LOWER(series_title) ${likeOp} ?)
      ORDER BY series_title, season_number, episode_number
      LIMIT ?
    `)
    const episodes = episodesStmt.all(searchQuery, searchQuery, maxResults) as Array<{
      id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string
    }>

    // Search artists
    const artistsStmt = this.db.prepare(`
      SELECT id, name, thumb_url
      FROM music_artists
      WHERE LOWER(name) ${likeOp} ?
      ORDER BY name
      LIMIT ?
    `)
    const artists = artistsStmt.all(searchQuery, maxResults) as Array<{
      id: number; name: string; thumb_url?: string
    }>

    // Search albums
    const albumsStmt = this.db.prepare(`
      SELECT id, title, artist_name, year, thumb_url
      FROM music_albums
      WHERE LOWER(title) ${likeOp} ? OR LOWER(artist_name) ${likeOp} ?
      ORDER BY title
      LIMIT ?
    `)
    const albums = albumsStmt.all(searchQuery, searchQuery, maxResults) as Array<{
      id: number; title: string; artist_name: string; year?: number; thumb_url?: string
    }>

    // Search tracks with album info
    const tracksStmt = this.db.prepare(`
      SELECT t.id, t.title, t.album_id, a.title as album_title, t.artist_name, a.thumb_url as album_thumb_url
      FROM music_tracks t
      LEFT JOIN music_albums a ON t.album_id = a.id
      WHERE LOWER(t.title) ${likeOp} ? OR LOWER(t.artist_name) ${likeOp} ?
      ORDER BY t.title
      LIMIT ?
    `)
    const tracks = tracksStmt.all(searchQuery, searchQuery, maxResults) as Array<{
      id: number; title: string; album_id?: number; album_title?: string; artist_name?: string; album_thumb_url?: string
    }>

    return { movies, tvShows, episodes, artists, albums, tracks }
  }

  // ============================================================================
  // EXCLUSIONS
  // ============================================================================

  addExclusion(exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string, title?: string): number {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      'INSERT INTO exclusions (exclusion_type, reference_id, reference_key, parent_key, title) VALUES (?, ?, ?, ?, ?)'
    )
    const result = stmt.run(exclusionType, referenceId ?? null, referenceKey ?? null, parentKey ?? null, title ?? null)
    return result.lastInsertRowid as number
  }

  removeExclusion(id: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM exclusions WHERE id = ?').run(id)
  }

  getExclusions(exclusionType?: string, parentKey?: string): Array<{
    id: number; exclusion_type: string; reference_id: number | null; reference_key: string | null
    parent_key: string | null; title: string | null; created_at: string
  }> {
    if (!this.db) throw new Error('Database not initialized')
    let sql = 'SELECT * FROM exclusions WHERE 1=1'
    const params: unknown[] = []
    if (exclusionType) { sql += ' AND exclusion_type = ?'; params.push(exclusionType) }
    if (parentKey) { sql += ' AND parent_key = ?'; params.push(parentKey) }
    sql += ' ORDER BY created_at DESC'
    return this.db.prepare(sql).all(...params) as Array<{
      id: number; exclusion_type: string; reference_id: number | null; reference_key: string | null
      parent_key: string | null; title: string | null; created_at: string
    }>
  }

  isExcluded(exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string): boolean {
    if (!this.db) throw new Error('Database not initialized')
    if (referenceId) {
      const row = this.db.prepare('SELECT 1 FROM exclusions WHERE exclusion_type = ? AND reference_id = ? LIMIT 1').get(exclusionType, referenceId)
      return !!row
    }
    if (referenceKey) {
      let sql = 'SELECT 1 FROM exclusions WHERE exclusion_type = ? AND reference_key = ?'
      const params: unknown[] = [exclusionType, referenceKey]
      if (parentKey) { sql += ' AND parent_key = ?'; params.push(parentKey) }
      sql += ' LIMIT 1'
      return !!this.db.prepare(sql).get(...params)
    }
    return false
  }

  // ============================================================================
  // WISHLIST COMPLETION HELPERS
  // ============================================================================

  /**
   * Get all active wishlist items (status = 'active')
   */
  getActiveWishlistItems(): WishlistItem[] {
    return this.getWishlistItems({ status: 'active' })
  }

  /**
   * Batch lookup media items by TMDB IDs
   * Returns a Map of tmdb_id ΓåÆ MediaItem
   */
  getMediaItemsByTmdbIds(tmdbIds: string[]): Map<string, MediaItem> {
    if (!this.db) throw new Error('Database not initialized')
    const result = new Map<string, MediaItem>()
    if (tmdbIds.length === 0) return result

    // Process in batches of 500 to avoid SQLite variable limit
    const batchSize = 500
    for (let i = 0; i < tmdbIds.length; i += batchSize) {
      const batch = tmdbIds.slice(i, i + batchSize)
      const placeholders = batch.map(() => '?').join(',')
      const stmt = this.db.prepare(`SELECT * FROM media_items WHERE tmdb_id IN (${placeholders})`)
      const rows = stmt.all(...batch) as MediaItem[]
      for (const row of rows) {
        if (row.tmdb_id) result.set(row.tmdb_id, row)
      }
    }
    return result
  }

  /**
   * Get episode count for a TV show by its series-level TMDB ID
   */
  getEpisodeCountBySeriesTmdbId(seriesTmdbId: string): number {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_tmdb_id = ?"
    )
    return (stmt.get(seriesTmdbId) as { count: number }).count
  }

  /**
   * Check if any episodes exist for a given series title + season number
   */
  getEpisodeCountForSeason(seriesTitle: string, seasonNumber: number): number {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_title = ? AND season_number = ?"
    )
    return (stmt.get(seriesTitle, seasonNumber) as { count: number }).count
  }

  /**
   * Check if a specific episode exists by series title + season + episode number
   */
  getEpisodeCountForSeasonEpisode(seriesTitle: string, seasonNumber: number, episodeNumber: number): number {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_title = ? AND season_number = ? AND episode_number = ?"
    )
    return (stmt.get(seriesTitle, seasonNumber, episodeNumber) as { count: number }).count
  }

  /**
   * Batch lookup music albums by MusicBrainz IDs
   * Returns a Map of musicbrainz_id ΓåÆ MusicAlbum
   */
  getMusicAlbumsByMusicbrainzIds(ids: string[]): Map<string, MusicAlbum> {
    if (!this.db) throw new Error('Database not initialized')
    const result = new Map<string, MusicAlbum>()
    if (ids.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const placeholders = batch.map(() => '?').join(',')
      const stmt = this.db.prepare(`SELECT * FROM music_albums WHERE musicbrainz_id IN (${placeholders})`)
      const rows = stmt.all(...batch) as MusicAlbum[]
      for (const row of rows) {
        if (row.musicbrainz_id) result.set(row.musicbrainz_id, row)
      }
    }
    return result
  }

  /**
   * Lookup a single music track by MusicBrainz ID
   */
  getMusicTrackByMusicbrainzId(id: string): MusicTrack | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE musicbrainz_id = ? LIMIT 1')
    return (stmt.get(id) as MusicTrack) || null
  }

  /**
   * Batch lookup quality scores by media item IDs
   * Returns a Map of media_item_id ΓåÆ QualityScore
   */
  getQualityScoresByMediaItemIds(ids: number[]): Map<number, QualityScore> {
    if (!this.db) throw new Error('Database not initialized')
    const result = new Map<number, QualityScore>()
    if (ids.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const placeholders = batch.map(() => '?').join(',')
      const stmt = this.db.prepare(`SELECT * FROM quality_scores WHERE media_item_id IN (${placeholders})`)
      const rows = stmt.all(...batch) as QualityScore[]
      for (const row of rows) {
        result.set(row.media_item_id, row)
      }
    }
    return result
  }

  // ============================================================================
  // TASK QUEUE HISTORY
  // ============================================================================

  saveTaskHistory(task: {
    taskId: string
    type: string
    label: string
    sourceId?: string
    libraryId?: string
    status: string
    error?: string
    result?: Record<string, unknown>
    createdAt: string
    startedAt?: string
    completedAt?: string
  }): void {
    if (!this.db) throw new Error('Database not initialized')

    const durationMs = task.startedAt && task.completedAt
      ? new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()
      : null

    this.db.prepare(`
      INSERT INTO task_history (task_id, type, label, source_id, library_id, status, error, result, created_at, started_at, completed_at, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.taskId, task.type, task.label,
      task.sourceId || null, task.libraryId || null,
      task.status, task.error || null,
      task.result ? JSON.stringify(task.result) : null,
      task.createdAt, task.startedAt || null,
      task.completedAt || null, durationMs
    )

    // Prune old entries
    this.db.prepare(`
      DELETE FROM task_history WHERE id NOT IN (
        SELECT id FROM task_history ORDER BY recorded_at DESC LIMIT 200
      )
    `).run()
  }

  getTaskHistory(limit = 50, offset = 0): Array<{
    taskId: string; type: string; label: string; sourceId: string | null
    libraryId: string | null; status: string; error: string | null
    result: string | null; createdAt: string; startedAt: string | null
    completedAt: string | null; durationMs: number | null
  }> {
    if (!this.db) throw new Error('Database not initialized')
    const rows = this.db.prepare(
      'SELECT task_id, type, label, source_id, library_id, status, error, result, created_at, started_at, completed_at, duration_ms FROM task_history ORDER BY recorded_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as Array<{
      task_id: string; type: string; label: string; source_id: string | null
      library_id: string | null; status: string; error: string | null
      result: string | null; created_at: string; started_at: string | null
      completed_at: string | null; duration_ms: number | null
    }>
    return rows.map(r => ({
      taskId: r.task_id, type: r.type, label: r.label,
      sourceId: r.source_id, libraryId: r.library_id,
      status: r.status, error: r.error, result: r.result,
      createdAt: r.created_at, startedAt: r.started_at,
      completedAt: r.completed_at, durationMs: r.duration_ms,
    }))
  }

  saveActivityLogEntry(entry: {
    entryType: string
    message: string
    taskId?: string
    taskType?: string
  }): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      'INSERT INTO activity_log (entry_type, message, task_id, task_type) VALUES (?, ?, ?, ?)'
    ).run(entry.entryType, entry.message, entry.taskId || null, entry.taskType || null)

    // Prune old entries
    this.db.prepare(`
      DELETE FROM activity_log WHERE id NOT IN (
        SELECT id FROM activity_log ORDER BY created_at DESC LIMIT 500
      )
    `).run()
  }

  getActivityLog(entryType?: string, limit = 100, offset = 0): Array<{
    id: number; entryType: string; message: string
    taskId: string | null; taskType: string | null; createdAt: string
  }> {
    if (!this.db) throw new Error('Database not initialized')
    let sql = 'SELECT id, entry_type, message, task_id, task_type, created_at FROM activity_log'
    const params: unknown[] = []
    if (entryType) {
      sql += ' WHERE entry_type LIKE ?'
      params.push(entryType + '%')
    }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: number; entry_type: string; message: string
      task_id: string | null; task_type: string | null; created_at: string
    }>
    return rows.map(r => ({
      id: r.id, entryType: r.entry_type, message: r.message,
      taskId: r.task_id, taskType: r.task_type, createdAt: r.created_at,
    }))
  }

  clearTaskHistory(): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM task_history').run()
    this.db.prepare("DELETE FROM activity_log WHERE entry_type LIKE 'task-%'").run()
  }

  clearActivityLog(entryType?: string): void {
    if (!this.db) throw new Error('Database not initialized')
    if (entryType) {
      this.db.prepare('DELETE FROM activity_log WHERE entry_type LIKE ?').run(entryType + '%')
    } else {
      this.db.prepare('DELETE FROM activity_log').run()
    }
  }

  // ============================================================================
  // DATA EXPORT (CSV)
  // ============================================================================

  /**
   * Export working document CSV for tracking upgrades and completions
   */
  exportWorkingCSV(options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
  }): string {
    if (!this.db) throw new Error('Database not initialized')

    const sections: string[] = []

    if (options.includeUpgrades) {
      sections.push(this.buildUpgradeCandidatesSection())
    }
    if (options.includeMissingMovies) {
      sections.push(this.buildMissingMoviesSection())
    }
    if (options.includeMissingEpisodes) {
      sections.push(this.buildMissingEpisodesSection())
    }
    if (options.includeMissingAlbums) {
      sections.push(this.buildMissingAlbumsSection())
    }

    return sections.filter(s => s.length > 0).join('\n\n')
  }

  /**
   * Build the Upgrade Candidates section of the CSV
   */
  private buildUpgradeCandidatesSection(): string {
    if (!this.db) return ''

    const rows = this.db.prepare(`
      SELECT
        mi.title,
        mi.year,
        mi.type,
        mi.series_title,
        mi.season_number,
        mi.episode_number,
        qs.quality_tier,
        mi.resolution,
        mi.video_bitrate,
        mi.audio_channels,
        mi.video_codec,
        mi.tmdb_id,
        mi.imdb_id,
        mi.file_path
      FROM media_items mi
      JOIN quality_scores qs ON qs.media_item_id = mi.id
      WHERE qs.needs_upgrade = 1
      ORDER BY qs.quality_tier, mi.type, mi.title
    `).all() as any[]

    if (rows.length === 0) {
      return '=== UPGRADE CANDIDATES ===\nNo items need upgrading.'
    }

    const header = '=== UPGRADE CANDIDATES ==='
    const columnHeader = 'Title,Year,Type,Series,Season,Episode,Current Tier,Target Tier,Resolution,Video Bitrate,Audio Channels,Codec,TMDB ID,IMDB ID,File Path'

    const csvRows = rows.map(row => {
      // Determine target tier (next level up)
      const tierOrder = ['SD', '720p', '1080p', '4K']
      const currentIndex = tierOrder.indexOf(row.quality_tier)
      const targetTier = currentIndex < tierOrder.length - 1 ? tierOrder[currentIndex + 1] : row.quality_tier

      return [
        this.escapeCSV(row.title || ''),
        row.year || '',
        row.type || '',
        this.escapeCSV(row.series_title || ''),
        row.season_number || '',
        row.episode_number || '',
        row.quality_tier || '',
        targetTier,
        row.resolution || '',
        row.video_bitrate || '',
        row.audio_channels || '',
        row.video_codec || '',
        row.tmdb_id || '',
        row.imdb_id || '',
        this.escapeCSV(row.file_path || '')
      ].join(',')
    })

    return [header, columnHeader, ...csvRows].join('\n')
  }

  /**
   * Build the Missing Movies section of the CSV
   */
  private buildMissingMoviesSection(): string {
    if (!this.db) return ''

    const rows = this.db.prepare(`
      SELECT
        mc.collection_name,
        mc.missing_movies
      FROM movie_collections mc
      WHERE mc.missing_movies IS NOT NULL
        AND mc.missing_movies != '[]'
    `).all() as any[]

    if (rows.length === 0) {
      return '=== MISSING MOVIES (Collections) ===\nNo missing movies found.'
    }

    const header = '=== MISSING MOVIES (Collections) ==='
    const columnHeader = 'Collection Name,Movie Title,Year,TMDB ID'

    const csvRows: string[] = []

    for (const row of rows) {
      try {
        const missingMovies = JSON.parse(row.missing_movies || '[]') as Array<{
          title: string
          year?: number
          tmdb_id: string
        }>

        for (const movie of missingMovies) {
          csvRows.push([
            this.escapeCSV(row.collection_name || ''),
            this.escapeCSV(movie.title || ''),
            movie.year || '',
            movie.tmdb_id || ''
          ].join(','))
        }
      } catch (e) {
        getLoggingService().info('[BetterSQLiteService]', 'Error parsing missing movies JSON:', e)
      }
    }

    return [header, columnHeader, ...csvRows].join('\n')
  }

  /**
   * Build the Missing Episodes section of the CSV
   */
  private buildMissingEpisodesSection(): string {
    if (!this.db) return ''

    const rows = this.db.prepare(`
      SELECT
        sc.series_title,
        sc.missing_episodes,
        sc.tmdb_id
      FROM series_completeness sc
      WHERE sc.missing_episodes IS NOT NULL
        AND sc.missing_episodes != '[]'
    `).all() as any[]

    if (rows.length === 0) {
      return '=== MISSING TV EPISODES ===\nNo missing episodes found.'
    }

    const header = '=== MISSING TV EPISODES ==='
    const columnHeader = 'Series Title,Season,Episode,Episode Title,Air Date,TMDB ID'

    const csvRows: string[] = []

    for (const row of rows) {
      try {
        const missingEpisodes = JSON.parse(row.missing_episodes || '[]') as Array<{
          season_number: number
          episode_number: number
          title?: string
          air_date?: string
        }>

        for (const episode of missingEpisodes) {
          csvRows.push([
            this.escapeCSV(row.series_title || ''),
            episode.season_number || '',
            episode.episode_number || '',
            this.escapeCSV(episode.title || ''),
            episode.air_date || '',
            row.tmdb_id || ''
          ].join(','))
        }
      } catch (e) {
        getLoggingService().info('[BetterSQLiteService]', 'Error parsing missing episodes JSON:', e)
      }
    }

    return [header, columnHeader, ...csvRows].join('\n')
  }

  /**
   * Build the Missing Albums section of the CSV
   */
  private buildMissingAlbumsSection(): string {
    if (!this.db) return ''

    const rows = this.db.prepare(`
      SELECT
        ac.artist_name,
        ac.missing_albums,
        ac.missing_singles,
        ac.missing_eps
      FROM artist_completeness ac
      WHERE (ac.missing_albums IS NOT NULL AND ac.missing_albums != '[]')
         OR (ac.missing_singles IS NOT NULL AND ac.missing_singles != '[]')
         OR (ac.missing_eps IS NOT NULL AND ac.missing_eps != '[]')
    `).all() as any[]

    if (rows.length === 0) {
      return '=== MISSING ALBUMS ===\nNo missing albums found.'
    }

    const header = '=== MISSING ALBUMS ==='
    const columnHeader = 'Artist Name,Album Title,Year,Album Type,MusicBrainz ID'

    const csvRows: string[] = []

    for (const row of rows) {
      // Process albums
      try {
        const albums = JSON.parse(row.missing_albums || '[]') as Array<{
          title: string
          year?: number
          musicbrainz_id: string
        }>
        for (const album of albums) {
          csvRows.push([
            this.escapeCSV(row.artist_name || ''),
            this.escapeCSV(album.title || ''),
            album.year || '',
            'Album',
            album.musicbrainz_id || ''
          ].join(','))
        }
      } catch (e) { /* ignore */ }

      // Process singles
      try {
        const singles = JSON.parse(row.missing_singles || '[]') as Array<{
          title: string
          year?: number
          musicbrainz_id: string
        }>
        for (const single of singles) {
          csvRows.push([
            this.escapeCSV(row.artist_name || ''),
            this.escapeCSV(single.title || ''),
            single.year || '',
            'Single',
            single.musicbrainz_id || ''
          ].join(','))
        }
      } catch (e) { /* ignore */ }

      // Process EPs
      try {
        const eps = JSON.parse(row.missing_eps || '[]') as Array<{
          title: string
          year?: number
          musicbrainz_id: string
        }>
        for (const ep of eps) {
          csvRows.push([
            this.escapeCSV(row.artist_name || ''),
            this.escapeCSV(ep.title || ''),
            ep.year || '',
            'EP',
            ep.musicbrainz_id || ''
          ].join(','))
        }
      } catch (e) { /* ignore */ }
    }

    return [header, columnHeader, ...csvRows].join('\n')
  }

  /**
   * Escape a string for CSV
   */
  private escapeCSV(val: string): string {
    if (!val) return ''
    const str = String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }
}
