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
      this.db.pragma('cache_size = -64000') // 64MB cache
      this.db.pragma('foreign_keys = ON')
      this.db.pragma('temp_store = MEMORY')
      this.db.pragma('busy_timeout = 5000') // Wait up to 5s for locked database

      if (dbExists) {
        console.log('[BetterSQLite] Database loaded from:', path.basename(this.dbPath))

        // Verify integrity in the background to avoid blocking startup
        // This is safe because we're in WAL mode and the check is read-only
        setImmediate(() => {
          try {
            const result = this.db!.pragma('integrity_check') as Array<{ integrity_check: string }>
            if (result[0]?.integrity_check !== 'ok') {
              console.error('[BetterSQLite] Background integrity check failed:', result)
              // In a real app, we might want to notify the user or trigger a repair here
            } else {
              console.log('[BetterSQLite] Background integrity check passed')
            }
          } catch (error) {
            console.error('[BetterSQLite] Error during background integrity check:', error)
          }
        })
      } else {
        console.log('[BetterSQLite] New database created')
      }

      // Run schema and migrations
      this.runMigrations()

      this._isInitialized = true
      console.log('[BetterSQLite] Database initialized successfully')
    } catch (error) {
      console.error('[BetterSQLite] Failed to initialize database:', error)
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
      'ALTER TABLE media_items ADD COLUMN source_id TEXT',
      'ALTER TABLE media_items ADD COLUMN source_type TEXT',
      'ALTER TABLE media_items ADD COLUMN library_id TEXT',

      // Subtitle tracks
      'ALTER TABLE media_items ADD COLUMN subtitle_tracks TEXT',

      // Series completeness
      'ALTER TABLE series_completeness ADD COLUMN tmdb_id TEXT',
      'ALTER TABLE series_completeness ADD COLUMN poster_url TEXT',
      'ALTER TABLE series_completeness ADD COLUMN backdrop_url TEXT',
      'ALTER TABLE series_completeness ADD COLUMN status TEXT',
      'ALTER TABLE series_completeness ADD COLUMN source_id TEXT',
      'ALTER TABLE series_completeness ADD COLUMN library_id TEXT',

      // Movie collections
      'ALTER TABLE movie_collections ADD COLUMN source_id TEXT',
      'ALTER TABLE movie_collections ADD COLUMN library_id TEXT',

      // Music tables
      'ALTER TABLE music_artists ADD COLUMN library_id TEXT',
      'ALTER TABLE music_artists ADD COLUMN user_fixed_match INTEGER DEFAULT 0',
      'ALTER TABLE music_albums ADD COLUMN library_id TEXT',
      'ALTER TABLE music_albums ADD COLUMN user_fixed_match INTEGER DEFAULT 0',
      'ALTER TABLE music_tracks ADD COLUMN library_id TEXT',
      'ALTER TABLE music_tracks ADD COLUMN file_mtime INTEGER',

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
    ]

    for (const statement of alterStatements) {
      try {
        this.db.exec(statement)
      } catch (error: unknown) {
        // Ignore "duplicate column" errors
        const msg = getErrorMessage(error)
        if (!msg?.includes('duplicate column name')) {
          console.log(`[BetterSQLite] Migration note: ${msg}`)
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
          console.error('[BetterSQLite] Integrity check failed after CHECK migration:', integrityResult)
        } else {
          console.log('[BetterSQLite] Migration: Added kodi-mysql to source_type CHECK constraints')
        }
      }
    } catch (error: unknown) {
      console.log('[BetterSQLite] kodi-mysql CHECK migration note:', getErrorMessage(error))
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
        console.log(`[BetterSQLite] Orphan cleanup: removed ${total} orphaned records`)
      }
    } catch (err) {
      console.warn('[BetterSQLite] Orphan cleanup skipped:', err)
    }

    console.log('[BetterSQLite] Migrations completed')
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

      console.log(`[BetterSQLite] Migrating ${itemCount} existing items to versions table...`)

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

      console.log(`[BetterSQLite] Migrated ${itemCount} items to versions table`)
    } catch (error: unknown) {
      const msg = getErrorMessage(error)
      // Table might not exist yet on first run - schema handles creation
      if (!msg?.includes('no such table')) {
        console.error('[BetterSQLite] Version migration error:', msg)
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
      console.log('[BetterSQLite] Database closed')
    }
  }

  /**
   * Get the database file path
   */
  getDbPath(): string {
    return this.dbPath
  }

  /**
   * Batch mode is a no-op for better-sqlite3 — each write is auto-persisted
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
  endBatch(): void {
    // No-op: better-sqlite3 auto-persists
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
    return this.mediaRepo.countMediaItems(filters)
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
      const rankDiff = tierRank(b.quality_tier) - tierRank(a.quality_tier)
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
        is_low_quality, needs_upgrade, issues,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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
  getMediaSources(): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_sources ORDER BY display_name')
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

    // Delete all associated data
    this.deleteMediaItemsForSource(sourceId)
    this.db.prepare('DELETE FROM series_completeness WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM movie_collections WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM library_scans WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM media_sources WHERE source_id = ?').run(sourceId)
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
  updateMusicAlbumArtwork(albumId: number, artworkUrl: string): void {
    this.musicRepo.updateMusicAlbumArtwork(albumId, artworkUrl)
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
   * Returns Map of album_id → MusicTrack[]
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
    const stmt = this.db.prepare(
      'SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id = ?'
    )
    const row = stmt.get(data.series_title, sourceId, libraryId) as { id: number } | undefined
    const existingId = row?.id || null

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
        MIN(m.source_type) as source_type
      FROM media_items m
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

    // Sorting
    const sortOrder = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    switch (filters?.sortBy) {
      case 'episode_count':
        sql += ` ORDER BY episode_count ${sortOrder}`
        break
      case 'season_count':
        sql += ` ORDER BY season_count ${sortOrder}`
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
      SELECT COUNT(DISTINCT COALESCE(m.series_title, 'Unknown Series')) as count
      FROM media_items m
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
      SELECT COUNT(*) as count
      FROM media_items m
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

    // '#' = non-alpha chars, which sort first → offset 0
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
    const stmt = this.db.prepare(
      'SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id = ?'
    )
    const row = stmt.get(data.tmdb_collection_id, sourceId, libraryId) as { id: number } | undefined
    const existingId = row?.id || null

    if (existingId !== null) {
      this.db.prepare(`
        UPDATE movie_collections SET
          total_movies = ?, owned_movies = ?, missing_movies = ?,
          completeness_percentage = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        data.total_movies, data.owned_movies, data.missing_movies,
        data.completeness_percentage, existingId
      )
      return existingId
    }

    const result = this.db.prepare(`
      INSERT INTO movie_collections (
        tmdb_collection_id, collection_name, source_id, library_id,
        total_movies, owned_movies, missing_movies, completeness_percentage,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      data.tmdb_collection_id, data.collection_name, sourceId, libraryId,
      data.total_movies, data.owned_movies, data.missing_movies,
      data.completeness_percentage
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Get all movie collections
   */
  getMovieCollections(sourceId?: string): MovieCollection[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM movie_collections'
    const params: unknown[] = []

    if (sourceId) {
      sql += ' WHERE source_id = ?'
      params.push(sourceId)
    }

    sql += ' ORDER BY collection_name ASC'

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MovieCollection[]
  }

  /**
   * Delete movie collection
   */
  deleteMovieCollection(id: number): boolean {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM movie_collections WHERE id = ?').run(id)
    return true
  }

  // ============================================================================
  // WISHLIST
  // ============================================================================

  /**
   * Upsert wishlist item
   */
  upsertWishlistItem(item: Omit<WishlistItem, 'id' | 'created_at' | 'updated_at'>): number {
    if (!this.db) throw new Error('Database not initialized')

    // Check if record exists by tmdb_id
    const stmt = this.db.prepare('SELECT id FROM wishlist_items WHERE tmdb_id = ?')
    const row = stmt.get(item.tmdb_id) as { id: number } | undefined
    const existingId = row?.id || null

    if (existingId !== null) {
      this.db.prepare(`
        UPDATE wishlist_items SET
          title = ?, type = ?, year = ?, poster_url = ?,
          reason = ?, current_quality_tier = ?, current_quality_level = ?,
          current_resolution = ?, current_video_codec = ?, current_audio_codec = ?,
          media_item_id = ?, status = ?,
          completed_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        item.title, item.type, item.year, item.poster_url,
        item.reason || 'missing', item.current_quality_tier || null,
        item.current_quality_level || null, item.current_resolution || null,
        item.current_video_codec || null, item.current_audio_codec || null,
        item.media_item_id || null, item.status || 'active',
        item.completed_at || null, existingId
      )
      return existingId
    }

    const result = this.db.prepare(`
      INSERT INTO wishlist_items (
        tmdb_id, title, type, year, poster_url,
        reason, current_quality_tier, current_quality_level,
        current_resolution, current_video_codec, current_audio_codec,
        media_item_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      item.tmdb_id, item.title, item.type, item.year, item.poster_url,
      item.reason || 'missing', item.current_quality_tier || null,
      item.current_quality_level || null, item.current_resolution || null,
      item.current_video_codec || null, item.current_audio_codec || null,
      item.media_item_id || null, item.status || 'active'
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Get wishlist items with filters
   */
  getWishlistItems(filters?: WishlistFilters): WishlistItem[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM wishlist_items WHERE 1=1'
    const params: unknown[] = []

    if (filters?.type) {
      sql += ' AND type = ?'
      params.push(filters.type)
    }

    if (filters?.status) {
      sql += ' AND status = ?'
      params.push(filters.status)
    }

    if (filters?.searchQuery) {
      sql += " AND title LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }

    sql += ' ORDER BY created_at DESC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
      if (filters.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as WishlistItem[]
  }

  /**
   * Count wishlist items
   */
  countWishlistItems(filters?: WishlistFilters): number {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT COUNT(*) as count FROM wishlist_items WHERE 1=1'
    const params: unknown[] = []

    if (filters?.type) {
      sql += ' AND type = ?'
      params.push(filters.type)
    }

    if (filters?.status) {
      sql += ' AND status = ?'
      params.push(filters.status)
    }

    if (filters?.searchQuery) {
      sql += " AND title LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }

    const stmt = this.db.prepare(sql)
    const result = stmt.get(...params) as { count: number }
    return result?.count || 0
  }

  /**
   * Get wishlist item by TMDB ID
   */
  getWishlistItemByTmdbId(tmdbId: string): WishlistItem | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM wishlist_items WHERE tmdb_id = ?')
    return (stmt.get(tmdbId) as WishlistItem) || null
  }

  /**
   * Delete wishlist item
   */
  deleteWishlistItem(id: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(id)
  }

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  /**
   * Add a notification
   */
  addNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>): number {
    return this.notificationRepo.addNotification(notification)
  }

  /**
   * Get notifications
   */
  getNotifications(options?: GetNotificationsOptions): Notification[] {
    return this.notificationRepo.getNotifications(options)
  }

  /**
   * Get notification counts
   */
  getNotificationCounts(): NotificationCountResult {
    return this.notificationRepo.getNotificationCounts()
  }

  /**
   * Mark notification as read
   */
  markNotificationRead(id: number): void {
    this.notificationRepo.markNotificationRead(id)
  }

  /**
   * Mark all notifications as read
   */
  markAllNotificationsRead(): void {
    this.notificationRepo.markAllNotificationsRead()
  }

  /**
   * Delete a notification
   */
  deleteNotification(id: number): void {
    this.notificationRepo.deleteNotification(id)
  }

  /**
   * Clear all notifications
   */
  clearAllNotifications(): void {
    this.notificationRepo.clearAllNotifications()
  }
}
