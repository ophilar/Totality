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
import * as path from 'node:path'
import { app } from 'electron'
import { DATABASE_SCHEMA, PROVIDER_TYPES_SQL } from './schema'
import { getCredentialEncryptionService } from '../services/CredentialEncryptionService'
import { getErrorMessage } from '../services/utils/errorUtils'
import { getVideoResolutionRank, getVideoResolutionTier } from '../services/VideoResolutionTier'
import {
  PROVIDER_TYPES,
  type MediaItem,
  type MediaItemUpsert,
  type QualityScore,
  type MediaItemFilters,
  type OptimizationMetricsSummary,
  type MediaSource,
  type MusicArtist,
  type MusicAlbum,
  type MusicTrack,
  type SeriesCompleteness,
  type MovieCollection,
  type MusicQualityScore,
  type ArtistCompleteness,
  type AlbumCompleteness,
  type MusicFilters,
  type WishlistItem,
  type WishlistFilters,
  type TVShowSummary,
  type TVShowFilters,
  type MediaItemVersion,
  type MediaDuplicate,
} from '../types/database'
import type {
  Notification,
  NotificationType,
  NotificationCountResult,
  GetNotificationsOptions,
} from '../types/monitoring'

import { PlaybackTargetProfileRepository } from './repositories/PlaybackTargetProfileRepository'
import { MediaRemuxJobRepository } from './repositories/MediaRemuxJobRepository'
import { backfillSeriesIdentityKeys } from './SeriesIdentityMigration'
import { deriveSeriesIdentityKey } from '../services/SeriesIdentityService'
import { QUALITY_MODEL_VERSION } from '../constants/qualityModelVersion'

// Singleton instance
let serviceInstance: BetterSQLiteService | null = null

export function getBetterSQLiteService(): BetterSQLiteService {
  if (!serviceInstance) {
    serviceInstance = new BetterSQLiteService()
  }
  return serviceInstance
}

export const getDatabase = getBetterSQLiteService

export class BetterSQLiteService {
  private db: Database.Database | null = null
  private dbPath: string
  private _isInitialized = false
  private invalidatedSeriesCompletenessScopes = new Set<string>()
  private seriesCompletenessInvalidationHandler?: (sourceId: string, libraryId: string) => void

  // Retention limits for unbounded tables — unread notifications are never pruned
  private static readonly MAX_READ_NOTIFICATIONS = 500
  private static readonly MAX_TASK_HISTORY = 500
  private static readonly MAX_ACTIVITY_LOG = 500

  private mapMediaItem(row: Record<string, unknown>): MediaItem {
    return {
      ...row,
      has_object_audio: row.has_object_audio == null ? undefined : Boolean(row.has_object_audio),
      needs_upgrade: row.needs_upgrade == null ? undefined : Boolean(row.needs_upgrade),
      user_fixed_match: row.user_fixed_match == null ? undefined : Boolean(row.user_fixed_match),
    } as MediaItem
  }

  private pruneReadNotifications(): void {
    if (!this.db) return
    const { c } = this.db.prepare('SELECT COUNT(*) as c FROM notifications WHERE is_read = 1').get() as { c: number }
    if (c <= BetterSQLiteService.MAX_READ_NOTIFICATIONS) return
    this.db.prepare(`
      DELETE FROM notifications
      WHERE is_read = 1
        AND id NOT IN (SELECT id FROM notifications WHERE is_read = 1 ORDER BY created_at DESC LIMIT ?)
    `).run(BetterSQLiteService.MAX_READ_NOTIFICATIONS)
  }

  private pruneTaskHistory(): void {
    if (!this.db) return
    const { c } = this.db.prepare('SELECT COUNT(*) as c FROM task_history').get() as { c: number }
    if (c <= BetterSQLiteService.MAX_TASK_HISTORY) return
    this.db.prepare(`
      DELETE FROM task_history
      WHERE id NOT IN (SELECT id FROM task_history ORDER BY recorded_at DESC LIMIT ?)
    `).run(BetterSQLiteService.MAX_TASK_HISTORY)
  }

  private pruneActivityLog(): void {
    if (!this.db) return
    const { c } = this.db.prepare('SELECT COUNT(*) as c FROM activity_log').get() as { c: number }
    if (c <= BetterSQLiteService.MAX_ACTIVITY_LOG) return
    this.db.prepare(`
      DELETE FROM activity_log
      WHERE id NOT IN (SELECT id FROM activity_log ORDER BY created_at DESC LIMIT ?)
    `).run(BetterSQLiteService.MAX_ACTIVITY_LOG)
  }

  private migrateTaskHistoryPartialStatus(): void {
    if (!this.db) throw new Error('Database not initialized')
    const table = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_history'").get() as { sql: string } | undefined
    if (!table || table.sql.includes("'partial'")) return

    this.db.transaction(() => {
      this.db!.exec(`
        CREATE TABLE task_history_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          type TEXT NOT NULL,
          label TEXT NOT NULL,
          source_id TEXT,
          library_id TEXT,
          status TEXT NOT NULL CHECK(status IN ('completed', 'partial', 'failed', 'cancelled', 'interrupted')),
          error TEXT,
          result TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          duration_ms INTEGER,
          recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
      this.db!.exec(`
        INSERT INTO task_history_new (id, task_id, type, label, source_id, library_id, status, error, result, created_at, started_at, completed_at, duration_ms, recorded_at)
        SELECT id, task_id, type, label, source_id, library_id, status, error, result, created_at, started_at, completed_at, duration_ms, recorded_at
        FROM task_history
      `)
      this.db!.exec('DROP TABLE task_history')
      this.db!.exec('ALTER TABLE task_history_new RENAME TO task_history')
      this.db!.exec('CREATE INDEX idx_task_history_status ON task_history(status)')
      this.db!.exec('CREATE INDEX idx_task_history_recorded ON task_history(recorded_at DESC)')
      this.db!.exec('CREATE INDEX idx_task_history_source ON task_history(source_id)')
    })()
  }

  /**
   * Build a safe FTS5 MATCH query from a user-supplied search string.
   * Each whitespace-separated word becomes a quoted phrase to avoid special-char errors.
   */
  private static buildFtsQuery(query: string): string {
    const words = query.trim().split(/\s+/).filter(w => w.length > 0)
    if (words.length === 0) return '""'
    return words.map(w => `"${w.replace(/"/g, '""')}"`).join(' ')
  }

  /** Check if database is initialized */
  get isInitialized(): boolean {
    return this._isInitialized
  }

  private _playbackTargetProfiles: PlaybackTargetProfileRepository | null = null
  public get playbackTargetProfiles(): PlaybackTargetProfileRepository {
    if (!this._playbackTargetProfiles) {
      this._playbackTargetProfiles = new PlaybackTargetProfileRepository()
    }
    return this._playbackTargetProfiles
  }

  private _mediaRemuxJobs: MediaRemuxJobRepository | null = null
  public get mediaRemuxJobs(): MediaRemuxJobRepository {
    if (!this._mediaRemuxJobs) {
      this._mediaRemuxJobs = new MediaRemuxJobRepository(() => this.db!)
    }
    return this._mediaRemuxJobs
  }

  public get config() {
    return {
      getSetting: (key: string) => this.getSetting(key),
      setSetting: (key: string, value: string) => this.setSetting(key, value),
      getAllSettings: () => this.getAllSettings(),
      deleteSetting: (key: string) => this.deleteSetting(key),
      getSettingsByPrefix: (prefix: string) => this.getSettingsByPrefix(prefix)
    }
  }

  public get media() {
    return {
      getItemById: (id: number) => this.getMediaItemById(id),
      setSeriesOriginalLanguage: (tmdbId: string, language: string) => this.setSeriesOriginalLanguage(tmdbId, language),
      getItemByPath: (path: string) => this.getMediaItemByPath(path),
      updatePathAndStats: (id: number, filePath: string, analysis: any) => this.updatePathAndStats(id, filePath, analysis),
      getQualityScoreByMediaId: (id: number) => this.getQualityScore(id),
      upsertQualityScore: (score: any) => this.upsertQualityScore(score),
      upsertQualityScores: (scores: any[]) => this.upsertQualityScores(scores),
      upsertQualityRatings: (scores: any[]) => this.upsertQualityRatings(scores),
      updateQualitySavings: (score: Pick<QualityScore, 'media_item_id' | 'video_savings_bytes' | 'estimated_savings_bytes' | 'savings_coverage' | 'evidence_status' | 'confidence' | 'savings_basis'>) => this.updateQualitySavings(score),
      getQualityScores: () => this.getQualityScores(),
      getItems: (filters?: MediaItemFilters) => this.getMediaItems(filters),
      updateDeepAnalysisByPath: (filePath: string, analysis: any, timestamp?: string) => this.updateDeepAnalysisByPath(filePath, analysis, timestamp),
      getItemVersionsForMediaIds: (ids: number[]) => this.getItemVersionsForMediaIds(ids),
      updateVersionQuality: (versionId: number, score: any) => this.updateMediaItemVersionQuality(versionId, score),
      updateBestVersion: (mediaItemId: number) => this.updateBestVersion(mediaItemId)
    }
  }

  public get tvShows() {
    return {
      getEpisodes: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string, seasonNumber?: number) =>
        this.getEpisodes(seriesTitle, sourceId, seriesIdentityKey, libraryId, seasonNumber),
      getCompletenessByIdentity: (identityKey: string, sourceId?: string, libraryId?: string) =>
        this.getSeriesCompletenessByIdentity(identityKey, sourceId, libraryId)
    }
  }

  public get sources() {
    return {
      getSourceById: (sourceId: string) => this.getMediaSource(sourceId),
      getSources: () => this.getMediaSources()
    }
  }

  updatePathAndStats(mediaItemId: number, newPath: string, analysis: any): void {
    if (!this.db) throw new Error('Database not initialized')
    const resolution = analysis.video?.width && analysis.video?.height ? `${analysis.video.width}x${analysis.video.height}` : analysis.video?.resolution || 'unknown'
    const audioCodec = analysis.audioTracks?.[0]?.codec || 'unknown'
    const audioChannels = analysis.audioTracks?.[0]?.channels || 0
    const audioBitrateKbps = analysis.audioTracks?.[0]?.bitrateKbps || 0
    const videoCodec = analysis.video?.codec || 'unknown'
    const videoBitrateKbps = analysis.video?.bitrateKbps || 0
    const width = analysis.video?.width || 0
    const height = analysis.video?.height || 0
    const durationMs = analysis.durationMs || 0
    const fileSizeBytes = analysis.fileSizeBytes || 0
    const deepAnalysis = analysis.success ? JSON.stringify({ ...analysis, filePath: newPath }) : null
    const audioTracks = analysis.audioTracks ? JSON.stringify(analysis.audioTracks) : null

    this.db.prepare(`
      UPDATE media_items SET
        file_path = ?,
        file_size_bytes = ?,
        duration_ms = ?,
        resolution = ?,
        width = ?,
        height = ?,
        video_codec = ?,
        video_bitrate_kbps = ?,
        audio_codec = ?,
        audio_channels = ?,
        audio_bitrate_kbps = ?,
        deep_analysis = COALESCE(?, deep_analysis),
        deep_analysis_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE deep_analysis_at END,
        audio_tracks = COALESCE(?, audio_tracks),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      newPath,
      fileSizeBytes,
      durationMs,
      resolution,
      width,
      height,
      videoCodec,
      videoBitrateKbps,
      audioCodec,
      audioChannels,
      audioBitrateKbps,
      deepAnalysis,
      deepAnalysis,
      audioTracks,
      mediaItemId
    )
  }

  getEpisodes(
    _seriesTitle: string,
    sourceId: string,
    seriesIdentityKey: string,
    libraryId: string,
    seasonNumber?: number
  ): MediaItem[] {
    if (!this.db) throw new Error('Database not initialized')
    if (!seriesIdentityKey || seriesIdentityKey.trim() === '') {
      throw new Error('seriesIdentityKey is required to retrieve episodes')
    }
    let sql = `SELECT m.*, q.overall_score, q.needs_upgrade, q.quality_tier, q.tier_quality, q.tier_score, q.issues,
      q.video_savings_bytes, q.estimated_savings_bytes, q.savings_coverage, q.evidence_status, q.confidence, q.savings_basis
FROM media_items m
LEFT JOIN quality_scores q ON m.id = q.media_item_id
WHERE m.type = 'episode' AND m.series_identity_key = ?`
    const params: unknown[] = [seriesIdentityKey]
    if (sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(libraryId)
    }
    if (seasonNumber !== undefined) {
      sql += ' AND m.season_number = ?'
      params.push(seasonNumber)
    }
    sql += ' ORDER BY m.season_number ASC, m.episode_number ASC'
    return this.db.prepare(sql).all(...params).map((row) => this.mapMediaItem(row as Record<string, unknown>))
  }

  constructor(customDbPath?: string) {
    const userDataPath = app.getPath('userData')
    this.dbPath = customDbPath || path.join(userDataPath, 'totality-v2.db')
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
        console.log('[BetterSQLite] Database loaded from:', path.basename(this.dbPath))

        // Verify integrity
        const result = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>
        if (result[0]?.integrity_check !== 'ok') {
          console.error('[BetterSQLite] Integrity check failed:', result)
          throw new Error('Database integrity check failed')
        }
      } else {
        console.log('[BetterSQLite] New database created')
      }

      // Run schema and migrations
      this.runMigrations()

      // Purge stale TMDB cache entries (older than 24h)
      this.purgeStaleTmdbCache()

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
    this.migrateTaskHistoryPartialStatus()
    this.renameMediaQualityColumns()

    // Run ALTER TABLE migrations for new columns
    const alterStatements = [
      // Quality scores tier columns
      "ALTER TABLE quality_scores ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'SD'",
      "ALTER TABLE quality_scores ADD COLUMN tier_quality TEXT NOT NULL DEFAULT 'MEDIUM'",
      'ALTER TABLE quality_scores ADD COLUMN tier_score INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE quality_scores ADD COLUMN bitrate_tier_score INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE quality_scores ADD COLUMN audio_tier_score INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE quality_scores ADD COLUMN video_savings_bytes INTEGER',
      'ALTER TABLE quality_scores ADD COLUMN savings_coverage TEXT',
      'ALTER TABLE quality_scores ADD COLUMN evidence_status TEXT',
      'ALTER TABLE quality_scores ADD COLUMN estimated_savings_bytes INTEGER',
      'ALTER TABLE quality_scores ADD COLUMN confidence TEXT',
      'ALTER TABLE quality_scores ADD COLUMN savings_basis TEXT',

      // Media items enhancements
      'ALTER TABLE media_items ADD COLUMN series_identity_key TEXT',
      'ALTER TABLE media_items ADD COLUMN episode_thumb_url TEXT',
      'ALTER TABLE media_items ADD COLUMN season_poster_url TEXT',
      'ALTER TABLE media_items ADD COLUMN video_frame_rate REAL',
      'ALTER TABLE media_items ADD COLUMN color_bit_depth INTEGER',
      'ALTER TABLE media_items ADD COLUMN hdr_format TEXT',
      'ALTER TABLE media_items ADD COLUMN color_space TEXT',
      'ALTER TABLE media_items ADD COLUMN video_profile TEXT',
      'ALTER TABLE media_items ADD COLUMN video_level INTEGER',
      'ALTER TABLE media_items ADD COLUMN dolby_vision_profile INTEGER',
      'ALTER TABLE media_items ADD COLUMN audio_profile TEXT',
      'ALTER TABLE media_items ADD COLUMN audio_sample_rate INTEGER',
      'ALTER TABLE media_items ADD COLUMN has_object_audio INTEGER DEFAULT 0',
      'ALTER TABLE media_items ADD COLUMN container TEXT',
      'ALTER TABLE media_items ADD COLUMN series_tmdb_id TEXT',
      'ALTER TABLE media_items ADD COLUMN original_language TEXT',
      'ALTER TABLE media_items ADD COLUMN user_fixed_match INTEGER DEFAULT 0',
      'ALTER TABLE media_items ADD COLUMN audio_tracks TEXT',
      'ALTER TABLE media_items ADD COLUMN file_mtime INTEGER',
      'ALTER TABLE media_items ADD COLUMN source_id TEXT',
      'ALTER TABLE media_items ADD COLUMN source_type TEXT',
      'ALTER TABLE media_items ADD COLUMN library_id TEXT',

      // Subtitle tracks
      'ALTER TABLE media_items ADD COLUMN subtitle_tracks TEXT',

      // Series completeness
      'ALTER TABLE series_completeness ADD COLUMN series_identity_key TEXT',
      'ALTER TABLE series_completeness ADD COLUMN tmdb_id TEXT',
      'ALTER TABLE series_completeness ADD COLUMN tvdb_id TEXT',
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

      // Per-library upgrade target tier (NULL = use global LOW quality rule)
      'ALTER TABLE library_scans ADD COLUMN upgrade_min_tier TEXT',

      // Sort title support
      'ALTER TABLE media_items ADD COLUMN sort_title TEXT',

      // Multi-version support
      'ALTER TABLE media_items ADD COLUMN version_count INTEGER NOT NULL DEFAULT 1',

      // Per-version split quality scores
      'ALTER TABLE media_item_versions ADD COLUMN bitrate_tier_score INTEGER DEFAULT 0',
      'ALTER TABLE media_item_versions ADD COLUMN audio_tier_score INTEGER DEFAULT 0',

      // Media item summary/description
      'ALTER TABLE media_items ADD COLUMN summary TEXT',
      // Music track mood
      'ALTER TABLE music_tracks ADD COLUMN mood TEXT',
      // Quality upgrade tracking
      'ALTER TABLE quality_scores ADD COLUMN previous_quality_tier TEXT',
      'ALTER TABLE quality_scores ADD COLUMN upgraded_at TEXT',
      // Music quality upgrade tracking
      'ALTER TABLE music_quality_scores ADD COLUMN previous_quality_tier TEXT',
      'ALTER TABLE music_quality_scores ADD COLUMN upgraded_at TEXT',
      // Ratings
      'ALTER TABLE media_items ADD COLUMN tmdb_rating REAL',
      // Watch history
      'ALTER TABLE media_items ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE media_items ADD COLUMN last_watched_at TEXT',
      // Deep file analysis cache
      'ALTER TABLE media_items ADD COLUMN deep_analysis TEXT',
      'ALTER TABLE media_items ADD COLUMN deep_analysis_at TEXT',
      'ALTER TABLE pending_tasks ADD COLUMN payload_json TEXT',
    ]

    for (const statement of alterStatements) {
      try {
        this.db.exec(statement)
      } catch (error: unknown) {
        // Ignore "duplicate column" errors
        const msg = getErrorMessage(error)
        if (!msg?.includes('duplicate column name')) {
          throw error
        }
      }
    }

    const db = this.db
    const qualityScoreColumns = db.pragma('table_info(quality_scores)') as Array<{ name: string; notnull: number }>
    const nullableQualityScoreColumns = ['tier_score', 'bitrate_tier_score', 'audio_tier_score', 'overall_score', 'resolution_score', 'bitrate_score', 'audio_score']
    if (qualityScoreColumns.some(column => nullableQualityScoreColumns.includes(column.name) && column.notnull === 1)) {
      const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'quality_scores'").get() as { sql: string }
      let nextTableSql = table.sql.replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?quality_scores/i, 'CREATE TABLE quality_scores_new')
      for (const column of nullableQualityScoreColumns) {
        nextTableSql = nextTableSql.replace(new RegExp(`(^\\s*${column}\\s+INTEGER)\\s+NOT\\s+NULL(?:\\s+DEFAULT\\s+0)?`, 'gm'), '$1')
      }
      if (nextTableSql === table.sql) throw new Error('Could not prepare nullable quality score table migration')
      db.pragma('foreign_keys = OFF')
      db.exec('BEGIN TRANSACTION')
      try {
        db.exec(nextTableSql)
        const existingColumns = db.pragma('table_info(quality_scores)') as Array<{ name: string }>
        const nextColumns = db.pragma('table_info(quality_scores_new)') as Array<{ name: string }>
        const nextColumnNames = new Set(nextColumns.map(column => column.name))
        const columns = existingColumns.filter(column => nextColumnNames.has(column.name)).map(column => column.name).join(', ')
        db.exec(`INSERT INTO quality_scores_new (${columns}) SELECT ${columns} FROM quality_scores`)
        db.exec('DROP TABLE quality_scores')
        db.exec('ALTER TABLE quality_scores_new RENAME TO quality_scores')
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_quality_scores_needs_upgrade ON quality_scores(needs_upgrade) WHERE needs_upgrade = 1;
          CREATE INDEX IF NOT EXISTS idx_quality_scores_tier ON quality_scores(quality_tier);
          CREATE INDEX IF NOT EXISTS idx_quality_scores_tier_quality ON quality_scores(tier_quality);
          CREATE INDEX IF NOT EXISTS idx_quality_scores_tier_both ON quality_scores(quality_tier, tier_quality);
        `)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      } finally {
        db.pragma('foreign_keys = ON')
      }
    }

    const savingsSemantics = db.prepare(
      "SELECT value FROM settings WHERE key = 'optimization.savings_semantics_version'"
    ).get() as { value: string } | undefined
    if (savingsSemantics?.value !== '5' && savingsSemantics?.value !== '6' && savingsSemantics?.value !== '7') {
      db.transaction(() => {
        db.prepare(`UPDATE quality_scores SET
          video_savings_bytes = NULL,
          estimated_savings_bytes = NULL,
          savings_coverage = NULL,
          evidence_status = NULL,
          confidence = NULL,
          savings_basis = NULL
        `).run()

        db.prepare(`
          INSERT INTO settings (key, value) VALUES ('optimization.savings_semantics_version', '5')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run()
        db.prepare(`
          INSERT INTO settings (key, value) VALUES ('optimization.savings_reanalysis_pending', 'true')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run()
      })()
      console.info('[BetterSQLite] Invalidated savings estimates for recalculation under the current evidence model')
    }

    const qualityRecoveryVersion = db.prepare(
      "SELECT value FROM settings WHERE key = 'optimization.quality_recovery_version'"
    ).get() as { value: string } | undefined
    if (qualityRecoveryVersion?.value !== '1') {
      const clearedQualityScores = db.prepare(`SELECT 1 FROM quality_scores
        WHERE tier_quality = 'UNKNOWN' AND tier_score IS NULL
          AND bitrate_tier_score IS NULL AND audio_tier_score IS NULL
          AND overall_score IS NULL AND resolution_score IS NULL
          AND bitrate_score IS NULL AND audio_score IS NULL
          AND is_low_quality = 0 AND needs_upgrade = 0
        UNION ALL
        SELECT 1 FROM media_items m LEFT JOIN quality_scores q ON q.media_item_id = m.id
          WHERE q.media_item_id IS NULL LIMIT 1`).get()
      db.transaction(() => {
        if (clearedQualityScores) {
          db.prepare(`INSERT INTO settings (key, value) VALUES ('optimization.quality_reanalysis_pending', 'true')
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
        }
        db.prepare(`INSERT INTO settings (key, value) VALUES ('optimization.quality_recovery_version', '1')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
      })()
    }

    const qualityModelVersion = db.prepare(
      "SELECT value FROM settings WHERE key = 'optimization.quality_model_version'"
    ).get() as { value: string } | undefined
    if (qualityModelVersion && qualityModelVersion.value !== String(QUALITY_MODEL_VERSION)) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('optimization.quality_reanalysis_pending', 'true')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
      console.info(`[BetterSQLite] Quality model changed from ${qualityModelVersion.value} to ${QUALITY_MODEL_VERSION}; scheduled score refresh`)
    }
    if (qualityModelVersion?.value !== String(QUALITY_MODEL_VERSION)) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('optimization.quality_model_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(QUALITY_MODEL_VERSION))
    }

    if (savingsSemantics?.value !== '7') {
      db.transaction(() => {
        db.prepare(`UPDATE quality_scores SET video_savings_bytes = NULL, estimated_savings_bytes = NULL,
          savings_coverage = NULL, evidence_status = NULL, confidence = NULL, savings_basis = NULL`).run()
        db.prepare(`INSERT INTO settings (key, value) VALUES ('optimization.savings_semantics_version', '7')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
        db.prepare(`INSERT INTO settings (key, value) VALUES ('optimization.savings_reanalysis_pending', 'true')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
      })()
      console.info('[BetterSQLite] Scheduled savings recalculation with codec-aware modeled estimates and measured overrides; quality ratings retained')
    }

    // Migrate provider CHECK constraints using the canonical schema types.
    let schemaChanged = false
    const tablesToMigrate = ['media_sources', 'media_items', 'music_artists', 'music_albums', 'music_tracks',
      'series_completeness', 'movie_collections']
    const tableDefinitions = new Map<string, string>()
    for (const table of tablesToMigrate) {
      const row = this.db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table) as { sql: string } | undefined
      if (row?.sql) tableDefinitions.set(table, row.sql)
    }
    const needsMigration = [...tableDefinitions.values()].some(sql =>
      /CHECK\s*\(\s*source_type\s+IN\s*\(/i.test(sql) &&
      PROVIDER_TYPES.some(provider => !sql.includes(`'${provider}'`))
    )
    if (needsMigration) {
      console.log('[BetterSQLite] Recreating tables to update provider CHECK constraints...')
      this.db.pragma('foreign_keys = OFF')
      this.db.exec('BEGIN TRANSACTION')
      try {
        for (const table of tablesToMigrate) {
          const tableSql = tableDefinitions.get(table)
          if (!tableSql || !/CHECK\s*\(\s*source_type\s+IN\s*\(/i.test(tableSql) ||
            PROVIDER_TYPES.every(provider => tableSql.includes(`'${provider}'`))) continue
          const newSql = tableSql.replace(
            /CHECK\s*\(\s*source_type\s+IN\s*\([^)]+\)\s*\)/i,
            `CHECK(source_type IN (${PROVIDER_TYPES_SQL}))`
          )
          if (newSql === tableSql) throw new Error(`Could not update source_type CHECK constraint in ${table}`)
          // Replace "CREATE TABLE tablename" with "CREATE TABLE tablename_new"
          const createNewSql = newSql.replace(
            new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${table}`, 'i'),
            `CREATE TABLE ${table}_new`
          )
          if (createNewSql === newSql) throw new Error(`Could not rename ${table} while rebuilding its provider CHECK constraint`)
          this.db.exec(createNewSql)
          // Copy data
          const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
          const newCols = this.db.prepare(`PRAGMA table_info(${table}_new)`).all() as Array<{ name: string }>
          const newColSet = new Set(newCols.map(c => c.name))
          const commonCols = cols.filter(c => newColSet.has(c.name)).map(c => c.name).join(', ')
          this.db.exec(`INSERT INTO ${table}_new (${commonCols}) SELECT ${commonCols} FROM ${table}`)
          this.db.exec(`DROP TABLE ${table}`)
          this.db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`)
          console.log(`[BetterSQLite] Recreated ${table} with current provider CHECK constraint`)
        }
        this.db.exec('COMMIT')
        console.log('[BetterSQLite] Migration: Provider CHECK constraints updated')
        schemaChanged = true
      } catch (e) {
        this.db.exec('ROLLBACK')
        throw e
      } finally {
        this.db.pragma('foreign_keys = ON')
      }
    }

    // Migration: Expand person_type CHECK to include writer, composer, cinematographer, editor
    const personRow = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='person_completeness'").get() as { sql: string } | undefined
    const personSql = personRow?.sql
    const personTypes = ['writer', 'composer', 'cinematographer', 'editor']
    if (personSql && personTypes.some(type => !personSql.includes(`'${type}'`))) {
      console.log('[BetterSQLite] Expanding person_type CHECK constraint...')
      const newSql = personSql.replace(
        /CHECK\s*\(\s*person_type\s+IN\s*\([^)]+\)\s*\)/i,
        "CHECK(person_type IN ('director','actor','writer','composer','cinematographer','editor'))"
      ).replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?person_completeness/i, 'CREATE TABLE person_completeness_new')
      if (newSql === personSql) throw new Error('Could not update person_type CHECK constraint')
      this.db.pragma('foreign_keys = OFF')
      this.db.exec('BEGIN TRANSACTION')
      try {
        this.db.exec(newSql)
        this.db.exec('INSERT INTO person_completeness_new SELECT * FROM person_completeness')
        this.db.exec('DROP TABLE person_completeness')
        this.db.exec('ALTER TABLE person_completeness_new RENAME TO person_completeness')
        this.db.exec('COMMIT')
        console.log('[BetterSQLite] Migration: person_type CHECK constraint expanded')
        schemaChanged = true
      } catch (e) {
        this.db.exec('ROLLBACK')
        throw e
      } finally {
        this.db.pragma('foreign_keys = ON')
      }
    }

    // Migration: Expand exclusion_type CHECK to include person_movie
    const exclusionRow = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='exclusions'").get() as { sql: string } | undefined
    const exclusionSql = exclusionRow?.sql
    if (exclusionSql && !exclusionSql.includes("'person_movie'")) {
      console.log('[BetterSQLite] Expanding exclusion_type CHECK constraint...')
      const newSql = exclusionSql.replace(
        /CHECK\s*\(\s*exclusion_type\s+IN\s*\([^)]+\)\s*\)/i,
        "CHECK(exclusion_type IN ('media_upgrade','collection_movie','series_episode','artist_album','person_movie'))"
      ).replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?exclusions/i, 'CREATE TABLE exclusions_new')
      if (newSql === exclusionSql) throw new Error('Could not update exclusion_type CHECK constraint')
      this.db.pragma('foreign_keys = OFF')
      this.db.exec('BEGIN TRANSACTION')
      try {
        this.db.exec(newSql)
        this.db.exec('INSERT INTO exclusions_new SELECT * FROM exclusions')
        this.db.exec('DROP TABLE exclusions')
        this.db.exec('ALTER TABLE exclusions_new RENAME TO exclusions')
        this.db.exec('COMMIT')
        console.log('[BetterSQLite] Migration: exclusion_type CHECK constraint expanded')
        schemaChanged = true
      } catch (e) {
        this.db.exec('ROLLBACK')
        throw e
      } finally {
        this.db.pragma('foreign_keys = ON')
      }
    }

    if (schemaChanged) this.db.exec(DATABASE_SCHEMA)

    // Create indexes for performance
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_media_items_tmdb_id ON media_items(tmdb_id) WHERE tmdb_id IS NOT NULL')

    // Create FTS5 virtual tables + sync triggers
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
          title, series_title,
          content='media_items', content_rowid='id',
          tokenize='unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS media_fts_ai AFTER INSERT ON media_items BEGIN
          INSERT INTO media_fts(rowid, title, series_title) VALUES (new.id, new.title, COALESCE(new.series_title, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS media_fts_ad AFTER DELETE ON media_items BEGIN
          INSERT INTO media_fts(media_fts, rowid, title, series_title) VALUES ('delete', old.id, old.title, COALESCE(old.series_title, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS media_fts_au AFTER UPDATE OF title, series_title ON media_items BEGIN
          INSERT INTO media_fts(media_fts, rowid, title, series_title) VALUES ('delete', old.id, old.title, COALESCE(old.series_title, ''));
          INSERT INTO media_fts(rowid, title, series_title) VALUES (new.id, new.title, COALESCE(new.series_title, ''));
        END;
        CREATE VIRTUAL TABLE IF NOT EXISTS music_artist_fts USING fts5(
          name,
          content='music_artists', content_rowid='id',
          tokenize='unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS music_artist_fts_ai AFTER INSERT ON music_artists BEGIN
          INSERT INTO music_artist_fts(rowid, name) VALUES (new.id, new.name);
        END;
        CREATE TRIGGER IF NOT EXISTS music_artist_fts_ad AFTER DELETE ON music_artists BEGIN
          INSERT INTO music_artist_fts(music_artist_fts, rowid, name) VALUES ('delete', old.id, old.name);
        END;
        CREATE TRIGGER IF NOT EXISTS music_artist_fts_au AFTER UPDATE OF name ON music_artists BEGIN
          INSERT INTO music_artist_fts(music_artist_fts, rowid, name) VALUES ('delete', old.id, old.name);
          INSERT INTO music_artist_fts(rowid, name) VALUES (new.id, new.name);
        END;
        CREATE VIRTUAL TABLE IF NOT EXISTS music_album_fts USING fts5(
          title, artist_name,
          content='music_albums', content_rowid='id',
          tokenize='unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS music_album_fts_ai AFTER INSERT ON music_albums BEGIN
          INSERT INTO music_album_fts(rowid, title, artist_name) VALUES (new.id, new.title, COALESCE(new.artist_name, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS music_album_fts_ad AFTER DELETE ON music_albums BEGIN
          INSERT INTO music_album_fts(music_album_fts, rowid, title, artist_name) VALUES ('delete', old.id, old.title, COALESCE(old.artist_name, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS music_album_fts_au AFTER UPDATE OF title, artist_name ON music_albums BEGIN
          INSERT INTO music_album_fts(music_album_fts, rowid, title, artist_name) VALUES ('delete', old.id, old.title, COALESCE(old.artist_name, ''));
          INSERT INTO music_album_fts(rowid, title, artist_name) VALUES (new.id, new.title, COALESCE(new.artist_name, ''));
        END;
        CREATE VIRTUAL TABLE IF NOT EXISTS music_track_fts USING fts5(
          title, artist_name, album_name,
          content='music_tracks', content_rowid='id',
          tokenize='unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS music_track_fts_ai AFTER INSERT ON music_tracks BEGIN
          INSERT INTO music_track_fts(rowid, title, artist_name, album_name) VALUES (new.id, new.title, COALESCE(new.artist_name, ''), COALESCE(new.album_name, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS music_track_fts_ad AFTER DELETE ON music_tracks BEGIN
          INSERT INTO music_track_fts(music_track_fts, rowid, title, artist_name, album_name) VALUES ('delete', old.id, old.title, COALESCE(old.artist_name, ''), COALESCE(old.album_name, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS music_track_fts_au AFTER UPDATE OF title, artist_name, album_name ON music_tracks BEGIN
          INSERT INTO music_track_fts(music_track_fts, rowid, title, artist_name, album_name) VALUES ('delete', old.id, old.title, COALESCE(old.artist_name, ''), COALESCE(old.album_name, ''));
          INSERT INTO music_track_fts(rowid, title, artist_name, album_name) VALUES (new.id, new.title, COALESCE(new.artist_name, ''), COALESCE(new.album_name, ''));
        END;
      `)

    // Populate FTS5 virtual tables from existing data (one-time; triggers handle future writes)
    const ftsReady = this.db.prepare("SELECT value FROM settings WHERE key = 'fts_populated'").get()
    if (!ftsReady) {
      this.db.exec(`INSERT INTO media_fts(rowid, title, series_title) SELECT id, title, COALESCE(series_title, '') FROM media_items`)
      this.db.exec(`INSERT INTO music_artist_fts(rowid, name) SELECT id, name FROM music_artists`)
      this.db.exec(`INSERT INTO music_album_fts(rowid, title, artist_name) SELECT id, title, COALESCE(artist_name, '') FROM music_albums`)
      this.db.exec(`INSERT INTO music_track_fts(rowid, title, artist_name, album_name) SELECT id, title, COALESCE(artist_name, ''), COALESCE(album_name, '') FROM music_tracks`)
      this.db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('fts_populated', '1')").run()
      console.log('[BetterSQLite] FTS5 index populated from existing data')
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
        console.log(`[BetterSQLite] Fixed ${mismatchCount} music tracks with incorrect album_id references`)
      }
    } catch (error: unknown) {
      console.log('[BetterSQLite] Music track album_id fix note:', getErrorMessage(error))
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

    // Backfill historical TV show and episode series_identity_key and enforce constraints
    try {
      backfillSeriesIdentityKeys(this.db)
      console.log('[BetterSQLite] Series identity keys backfilled and constraints enforced')
    } catch (err) {
      console.error('[BetterSQLite] Series identity backfill error:', err)
      throw err
    }

    this.invalidateStaleSeriesCompleteness()
    console.log('[BetterSQLite] Migrations completed')
  }

  private renameMediaQualityColumns(): void {
    if (!this.db) throw new Error('Database not initialized')

    const renames = [
      ['media_items', 'file_size', 'file_size_bytes'],
      ['media_items', 'duration', 'duration_ms'],
      ['media_items', 'video_bitrate', 'video_bitrate_kbps'],
      ['media_items', 'audio_bitrate', 'audio_bitrate_kbps'],
      ['media_item_versions', 'file_size', 'file_size_bytes'],
      ['media_item_versions', 'duration', 'duration_ms'],
      ['media_item_versions', 'video_bitrate', 'video_bitrate_kbps'],
      ['media_item_versions', 'audio_bitrate', 'audio_bitrate_kbps'],
      ['quality_scores', 'storage_debt_bytes', 'video_savings_bytes'],
    ] as const

    this.db.transaction(() => {
      for (const [table, oldName, newName] of renames) {
        const columns = this.db!.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
        const columnNames = new Set(columns.map(column => column.name))
        if (columnNames.has(oldName) && columnNames.has(newName)) {
          throw new Error(`Cannot rename ${table}.${oldName}: ${newName} already exists`)
        }
        if (columnNames.has(oldName)) {
          this.db!.exec(`ALTER TABLE ${table} RENAME COLUMN ${oldName} TO ${newName}`)
        } else if (!columnNames.has(newName)) {
          throw new Error(`Cannot find ${table}.${oldName} or ${newName} during media quality migration`)
        }
      }
    })()
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
          media_item_id, version_source, file_path, file_size_bytes, duration_ms,
          resolution, width, height, video_codec, video_bitrate_kbps,
          audio_codec, audio_channels, audio_bitrate_kbps,
          video_frame_rate, color_bit_depth, hdr_format, color_space,
          video_profile, video_level, audio_profile, audio_sample_rate,
          has_object_audio, audio_tracks, subtitle_tracks, container, file_mtime,
          is_best, created_at, updated_at
        )
        SELECT
          id, 'primary', file_path, file_size_bytes, duration_ms,
          resolution, width, height, video_codec, video_bitrate_kbps,
          audio_codec, audio_channels, audio_bitrate_kbps,
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
   * Batch mode depth counter — for API consistency with SQL.js backend.
   * better-sqlite3 auto-persists via WAL mode, so no deferred writes needed.
   */
  private batchDepth = 0

  startBatch(): void {
    this.batchDepth++
  }

  /**
   * End batch mode — depth-counted for safe nesting.
   * Writes auto-persist via WAL mode, so no flush needed.
   */
  async endBatch(): Promise<void> {
    if (this.batchDepth > 0) {
      this.batchDepth--
    }
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
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get(key) as { value: string } | undefined

    if (!row) return null

    return getCredentialEncryptionService().decryptSetting(key, row.value)
  }

  /**
   * Set a setting value
   */
  setSetting(key: string, value: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const storedValue = getCredentialEncryptionService().encryptSetting(key, value)

    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    stmt.run(key, storedValue)
  }

  /**
   * Delete a setting
   */
  deleteSetting(key: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?')
    stmt.run(key)
  }

  /**
   * Get all settings
   */
  getAllSettings(): Record<string, string> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT key, value FROM settings')
    const rows = stmt.all() as Array<{ key: string; value: string }>

    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}

    for (const row of rows) {
      settings[row.key] = encryption.decryptSetting(row.key, row.value)
    }

    return settings
  }

  /**
   * Get settings by prefix
   */
  getSettingsByPrefix(prefix: string): Record<string, string> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT key, value FROM settings WHERE key LIKE ?')
    const rows = stmt.all(prefix + '%') as Array<{ key: string; value: string }>

    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}

    for (const row of rows) {
      settings[row.key] = encryption.decryptSetting(row.key, row.value)
    }

    return settings
  }

  // ============================================================================
  // TMDB CACHE
  // ============================================================================

  /**
   * Retrieve a persisted TMDB API response.
   * Returns null when the key is not present (caller handles expiry by comparing
   * cached_at against CACHE_DURATION).
   */
  getTmdbCache(key: string): { data: string; cached_at: number } | null {
    if (!this.db) return null
    const row = this.db.prepare('SELECT data, cached_at FROM tmdb_cache WHERE cache_key = ?').get(key) as { data: string; cached_at: number } | undefined
    return row ?? null
  }

  /**
   * Persist a TMDB API response. Uses UPSERT so repeated calls are safe.
   * Prunes entries older than 48 hours after every 500 writes to prevent
   * unbounded growth (TMDB data rarely changes within the 24h TTL window).
   */
  setTmdbCache(key: string, data: string): void {
    if (!this.db) return
    const now = Date.now()
    this.db.prepare(
      'INSERT INTO tmdb_cache (cache_key, data, cached_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at'
    ).run(key, data, now)

    // Periodic pruning — avoid a full table scan on every write
    const rowCount = (this.db.prepare('SELECT COUNT(*) as n FROM tmdb_cache').get() as { n: number }).n
    if (rowCount > 2000) {
      const cutoff = now - 48 * 60 * 60 * 1000 // 48 hours
      this.db.prepare('DELETE FROM tmdb_cache WHERE cached_at < ?').run(cutoff)
    }
  }

  /**
   * Purge stale TMDB cache entries on startup (older than 24h)
   */
  private purgeStaleTmdbCache(): void {
    if (!this.db) return
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000
      const purged = this.db.prepare('DELETE FROM tmdb_cache WHERE cached_at < ?').run(cutoff).changes
      if (purged > 0) {
        console.log(`[BetterSQLite] Purged ${purged} stale TMDB cache entries`)
      }
    } catch (error) {
      console.warn('[BetterSQLite] Failed to purge stale TMDB cache entries:', error)
    }
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get library statistics
   */
  getLibraryStats(sourceId?: string): {
    totalItems: number
    totalMovies: number
    totalEpisodes: number
    totalShows: number
    lowQualityCount: number
    needsUpgradeCount: number
    averageQualityScore: number | null
    movieNeedsUpgradeCount: number
    movieAverageQualityScore: number | null
    tvNeedsUpgradeCount: number
    tvAverageQualityScore: number | null
  } {
    if (!this.db) throw new Error('Database not initialized')

    const sourceFilter = sourceId ? ' AND m.source_id = ?' : ''
    const params = sourceId ? [sourceId] : []

    const sql = `
      SELECT
        COUNT(*) as totalItems,
        SUM(CASE WHEN m.type = 'movie' THEN 1 ELSE 0 END) as totalMovies,
        SUM(CASE WHEN m.type = 'episode' THEN 1 ELSE 0 END) as totalEpisodes,
        COUNT(DISTINCT CASE WHEN m.type = 'episode' THEN m.series_title END) as totalShows,
        SUM(CASE WHEN q.is_low_quality = 1 THEN 1 ELSE 0 END) as lowQualityCount,
        SUM(CASE WHEN q.needs_upgrade = 1 THEN 1 ELSE 0 END) as needsUpgradeCount,
        AVG(CASE WHEN q.tier_quality != 'UNKNOWN' THEN q.overall_score END) as averageQualityScore,
        SUM(CASE WHEN m.type = 'movie' AND q.needs_upgrade = 1 THEN 1 ELSE 0 END) as movieNeedsUpgradeCount,
        AVG(CASE WHEN m.type = 'movie' AND q.tier_quality != 'UNKNOWN' THEN q.overall_score END) as movieAverageQualityScore,
        SUM(CASE WHEN m.type = 'episode' AND q.needs_upgrade = 1 THEN 1 ELSE 0 END) as tvNeedsUpgradeCount,
        AVG(CASE WHEN m.type = 'episode' AND q.tier_quality != 'UNKNOWN' THEN q.overall_score END) as tvAverageQualityScore
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)${sourceFilter}
    `

    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as Record<string, number> | undefined

    if (!row) {
      return {
        totalItems: 0,
        totalMovies: 0,
        totalEpisodes: 0,
        totalShows: 0,
        lowQualityCount: 0,
        needsUpgradeCount: 0,
        averageQualityScore: null,
        movieNeedsUpgradeCount: 0,
        movieAverageQualityScore: null,
        tvNeedsUpgradeCount: 0,
        tvAverageQualityScore: null,
      }
    }

    return {
      totalItems: row.totalItems || 0,
      totalMovies: row.totalMovies || 0,
      totalEpisodes: row.totalEpisodes || 0,
      totalShows: row.totalShows || 0,
      lowQualityCount: row.lowQualityCount || 0,
      needsUpgradeCount: row.needsUpgradeCount || 0,
      averageQualityScore: row.averageQualityScore == null ? null : Math.round(row.averageQualityScore),
      movieNeedsUpgradeCount: row.movieNeedsUpgradeCount || 0,
      movieAverageQualityScore: row.movieAverageQualityScore == null ? null : Math.round(row.movieAverageQualityScore),
      tvNeedsUpgradeCount: row.tvNeedsUpgradeCount || 0,
      tvAverageQualityScore: row.tvAverageQualityScore == null ? null : Math.round(row.tvAverageQualityScore),
    }
  }

  /**
   * Get media items count by source
   */
  getMediaItemsCountBySource(sourceId: string): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items WHERE source_id = ?')
    const result = stmt.get(sourceId) as { count: number }
    return result.count
  }

  /**
   * Get aggregated stats across all sources
   */
  getAggregatedSourceStats(): {
    totalSources: number
    enabledSources: number
    totalItems: number
    bySource: Array<{
      sourceId: string
      displayName: string
      sourceType: string
      itemCount: number
      lastScanAt?: string
    }>
  } {
    if (!this.db) throw new Error('Database not initialized')

    const totalSourcesStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_sources')
    const totalSources = (totalSourcesStmt.get() as { count: number }).count

    const enabledSourcesStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_sources WHERE is_enabled = 1')
    const enabledSources = (enabledSourcesStmt.get() as { count: number }).count

    const totalItemsStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items')
    const totalItems = (totalItemsStmt.get() as { count: number }).count

    const bySourceStmt = this.db.prepare(`
      SELECT
        s.source_id,
        s.display_name,
        s.source_type,
        COUNT(m.id) as item_count,
        s.last_scan_at
      FROM media_sources s
      LEFT JOIN media_items m ON s.source_id = m.source_id
      GROUP BY s.source_id
      ORDER BY s.display_name ASC
    `)
    const bySourceRows = bySourceStmt.all() as Array<{
      source_id: string
      display_name: string
      source_type: string
      item_count: number
      last_scan_at: string | null
    }>

    return {
      totalSources,
      enabledSources,
      totalItems,
      bySource: bySourceRows.map(row => ({
        sourceId: row.source_id,
        displayName: row.display_name,
        sourceType: row.source_type,
        itemCount: row.item_count || 0,
        lastScanAt: row.last_scan_at || undefined,
      })),
    }
  }

  /**
   * Get storage analytics — codec breakdown, quality tiers, and size stats
   */
  getStorageAnalytics(): {
    totalSize: number
    totalItems: number
    byCodec: Array<{ codec: string; count: number; size: number }>
    byTier: Array<{ tier: string; count: number; size: number }>
    codecMigration: { h264Count: number; modernCount: number; totalCount: number }
    music: {
      totalSize: number
      totalTracks: number
      byCodec: Array<{ codec: string; count: number; size: number }>
      byTier: Array<{ tier: string; count: number; size: number }>
    }
    versionStats: {
      itemsWithVersions: number
      totalVersions: number
      redundantSize: number
      redundantCount: number
    }
  } {
    if (!this.db) throw new Error('Database not initialized')

    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(m.file_size_bytes), 0) as size
      FROM media_items m
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND m.file_size_bytes > 0
    `).get() as { count: number; size: number }

    const byCodec = this.db.prepare(`
      SELECT
        UPPER(COALESCE(m.video_codec, 'unknown')) as codec,
        COUNT(*) as count,
        COALESCE(SUM(m.file_size_bytes), 0) as size
      FROM media_items m
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND m.file_size_bytes > 0
      GROUP BY UPPER(COALESCE(m.video_codec, 'unknown'))
      ORDER BY size DESC
    `).all() as Array<{ codec: string; count: number; size: number }>

    const byTier = this.db.prepare(`
      SELECT
        COALESCE(q.quality_tier, 'Unknown') as tier,
        COUNT(*) as count,
        COALESCE(SUM(m.file_size_bytes), 0) as size
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND m.file_size_bytes > 0
      GROUP BY COALESCE(q.quality_tier, 'Unknown')
      ORDER BY CASE tier WHEN '4K' THEN 1 WHEN '1080p' THEN 2 WHEN '720p' THEN 3 WHEN 'SD' THEN 4 ELSE 5 END
    `).all() as Array<{ tier: string; count: number; size: number }>

    const migration = this.db.prepare(`
      SELECT
        SUM(CASE WHEN UPPER(m.video_codec) IN ('H264', 'AVC', 'X264') THEN 1 ELSE 0 END) as h264Count,
        SUM(CASE WHEN UPPER(m.video_codec) IN ('HEVC', 'H265', 'X265', 'AV1', 'VP9') THEN 1 ELSE 0 END) as modernCount,
        COUNT(*) as totalCount
      FROM media_items m
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND m.video_codec IS NOT NULL AND m.video_codec != ''
    `).get() as { h264Count: number; modernCount: number; totalCount: number }

    // Music storage analytics
    const musicTotal = this.db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(t.file_size), 0) as size
      FROM music_tracks t
      LEFT JOIN library_scans ls ON t.source_id = ls.source_id AND t.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND t.file_size > 0
    `).get() as { count: number; size: number } | undefined

    const musicByCodec = this.db.prepare(`
      SELECT
        UPPER(COALESCE(t.audio_codec, 'unknown')) as codec,
        COUNT(*) as count,
        COALESCE(SUM(t.file_size), 0) as size
      FROM music_tracks t
      LEFT JOIN library_scans ls ON t.source_id = ls.source_id AND t.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND t.file_size > 0
      GROUP BY UPPER(COALESCE(t.audio_codec, 'unknown'))
      ORDER BY size DESC
    `).all() as Array<{ codec: string; count: number; size: number }>

    const musicByTier = this.db.prepare(`
      SELECT
        CASE
          WHEN t.is_hi_res = 1 THEN 'Hi-Res'
          WHEN t.is_lossless = 1 THEN 'Lossless'
          WHEN t.audio_bitrate >= 256 THEN 'High Lossy'
          WHEN t.audio_bitrate >= 128 THEN 'Medium Lossy'
          ELSE 'Low Lossy'
        END as tier,
        COUNT(*) as count,
        COALESCE(SUM(t.file_size), 0) as size
      FROM music_tracks t
      LEFT JOIN library_scans ls ON t.source_id = ls.source_id AND t.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND t.file_size > 0
      GROUP BY tier
      ORDER BY size DESC
    `).all() as Array<{ tier: string; count: number; size: number }>

    // Version storage stats — redundant versions that could be removed
    const versionStats = this.db.prepare(`
      SELECT
        COUNT(DISTINCT v.media_item_id) as items_with_versions,
        COUNT(*) as total_versions,
        COALESCE(SUM(CASE WHEN v.is_best = 0 THEN v.file_size_bytes ELSE 0 END), 0) as redundant_size,
        COUNT(CASE WHEN v.is_best = 0 THEN 1 END) as redundant_count
      FROM media_item_versions v
      JOIN media_items m ON v.media_item_id = m.id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND v.file_size_bytes > 0
        AND (SELECT COUNT(*) FROM media_item_versions v2 WHERE v2.media_item_id = v.media_item_id) > 1
    `).get() as { items_with_versions: number; total_versions: number; redundant_size: number; redundant_count: number } | undefined

    return {
      totalSize: (totalRow?.size || 0) + (musicTotal?.size || 0),
      totalItems: (totalRow?.count || 0) + (musicTotal?.count || 0),
      byCodec,
      byTier,
      codecMigration: {
        h264Count: migration?.h264Count || 0,
        modernCount: migration?.modernCount || 0,
        totalCount: migration?.totalCount || 0,
      },
      music: {
        totalSize: musicTotal?.size || 0,
        totalTracks: musicTotal?.count || 0,
        byCodec: musicByCodec,
        byTier: musicByTier,
      },
      versionStats: {
        itemsWithVersions: versionStats?.items_with_versions || 0,
        totalVersions: versionStats?.total_versions || 0,
        redundantSize: versionStats?.redundant_size || 0,
        redundantCount: versionStats?.redundant_count || 0,
      },
    }
  }

  /**
   * Get duplicate media items (same TMDB ID across different sources or paths)
   */
  getDuplicateMedia(): Array<{
    tmdb_id: string
    title: string
    year: number | null
    type: string
    copies: Array<{
      id: number
      source_id: string
      source_type: string
      library_id: string
      file_path: string | null
      quality_tier: string | null
      overall_score: number | null
      resolution: string | null
      video_codec: string | null
      file_size_bytes: number | null
    }>
  }> {
    if (!this.db) throw new Error('Database not initialized')

    const sql = `
      SELECT m.tmdb_id, m.title, m.year, m.type,
             m.id, m.source_id, m.source_type, m.library_id, m.file_path, m.file_size_bytes,
             m.resolution, m.video_codec,
             q.quality_tier, q.overall_score
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.tmdb_id IS NOT NULL AND m.tmdb_id != ''
        AND m.type = 'movie'
        AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND m.tmdb_id IN (
          SELECT tmdb_id FROM media_items
          WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND type = 'movie'
          GROUP BY tmdb_id HAVING COUNT(*) > 1
        )
      ORDER BY m.tmdb_id, q.overall_score DESC
    `
    const rows = this.db.prepare(sql).all() as Array<{
      tmdb_id: string; title: string; year: number | null; type: string
      id: number; source_id: string; source_type: string; library_id: string
      file_path: string | null; file_size_bytes: number | null
      resolution: string | null; video_codec: string | null
      quality_tier: string | null; overall_score: number | null
    }>

    const grouped = new Map<string, {
      tmdb_id: string; title: string; year: number | null; type: string
      copies: Array<{
        id: number; source_id: string; source_type: string; library_id: string
        file_path: string | null; quality_tier: string | null
        overall_score: number | null; resolution: string | null
        video_codec: string | null; file_size_bytes: number | null
      }>
    }>()

    for (const row of rows) {
      if (!grouped.has(row.tmdb_id)) {
        grouped.set(row.tmdb_id, {
          tmdb_id: row.tmdb_id,
          title: row.title,
          year: row.year,
          type: row.type,
          copies: [],
        })
      }
      grouped.get(row.tmdb_id)!.copies.push({
        id: row.id,
        source_id: row.source_id,
        source_type: row.source_type,
        library_id: row.library_id,
        file_path: row.file_path,
        quality_tier: row.quality_tier,
        overall_score: row.overall_score,
        resolution: row.resolution,
        video_codec: row.video_codec,
        file_size_bytes: row.file_size_bytes,
      })
    }

    return Array.from(grouped.values())
  }

  /**
   * Get pending duplicates
   */
  getPendingDuplicates(sourceId?: string): MediaDuplicate[] {
    if (!this.db) throw new Error('Database not initialized')
    const sql = sourceId
      ? 'SELECT * FROM media_item_duplicates WHERE status = ? AND source_id = ? ORDER BY id ASC'
      : 'SELECT * FROM media_item_duplicates WHERE status = ? ORDER BY id ASC'
    const stmt = this.db.prepare(sql)
    return (sourceId ? stmt.all('pending', sourceId) : stmt.all('pending')) as MediaDuplicate[]
  }

  /**
   * Upsert a duplicate group
   */
  upsertDuplicate(dup: { source_id: string; external_id: string; external_type: string; media_item_ids: string; status?: string }): void {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(`
      INSERT INTO media_item_duplicates (source_id, external_id, external_type, media_item_ids, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, external_id, external_type) DO UPDATE SET
        media_item_ids = excluded.media_item_ids,
        status = CASE WHEN media_item_duplicates.status = 'resolved' THEN 'pending' ELSE media_item_duplicates.status END,
        updated_at = datetime('now')
    `)
    stmt.run(dup.source_id, dup.external_id, dup.external_type, dup.media_item_ids, dup.status || 'pending')
  }

  /**
   * Resolve a duplicate group
   */
  resolveDuplicate(id: number, strategy: string): void {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(`
      UPDATE media_item_duplicates
      SET status = 'resolved',
          resolution_strategy = ?,
          resolved_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `)
    stmt.run(strategy, id)
  }

  /**
   * Get a duplicate group by ID
   */
  getDuplicateById(id: number): MediaDuplicate | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM media_item_duplicates WHERE id = ?')
    return (stmt.get(id) as MediaDuplicate) || null
  }

  /**
   * Get health scores per library (average quality score)
   */
  getLibraryHealthScores(): Array<{
    source_id: string
    library_id: string
    library_name: string
    library_type: string
    avg_score: number
    item_count: number
  }> {
    if (!this.db) throw new Error('Database not initialized')

    const sql = `
      SELECT
        ls.source_id,
        ls.library_id,
        ls.library_name,
        ls.library_type,
        ROUND(COALESCE(AVG(CASE WHEN q.tier_quality != 'UNKNOWN' THEN q.overall_score END), 0)) as avg_score,
        COUNT(q.media_item_id) as item_count
      FROM library_scans ls
      INNER JOIN media_items m ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      INNER JOIN quality_scores q ON m.id = q.media_item_id
      WHERE ls.is_enabled = 1
      GROUP BY ls.source_id, ls.library_id
      HAVING item_count > 0
    `
    return this.db.prepare(sql).all() as Array<{
      source_id: string; library_id: string; library_name: string
      library_type: string; avg_score: number; item_count: number
    }>
  }

  /**
   * Get recently added items across all sources
   */
  getRecentlyAdded(days: number = 14, limit: number = 50): Array<{
    id: number
    title: string
    year: number | null
    type: string
    source_id: string
    source_type: string
    poster_url: string | null
    created_at: string
    quality_tier: string | null
    series_title: string | null
    season_number: number | null
    episode_number: number | null
  }> {
    if (!this.db) throw new Error('Database not initialized')

    const sql = `
      SELECT m.id, m.title, m.year, m.type, m.source_id, m.source_type,
             m.poster_url, m.created_at, q.quality_tier,
             m.series_title, m.season_number, m.episode_number
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND m.created_at >= datetime('now', ?)
      ORDER BY m.created_at DESC
      LIMIT ?
    `
    return this.db.prepare(sql).all(`-${days} days`, limit) as Array<{
      id: number; title: string; year: number | null; type: string
      source_id: string; source_type: string; poster_url: string | null
      created_at: string; quality_tier: string | null
      series_title: string | null; season_number: number | null; episode_number: number | null
    }>
  }

  /**
   * Get items that recently received a quality tier upgrade
   */
  getRecentlyUpgraded(days: number = 30, sourceId?: string): Array<{
    id: number; title: string; year: number | null; type: string
    poster_url: string | null; quality_tier: string; source_id: string
    previous_quality_tier: string; upgraded_at: string
    series_title: string | null; season_number: number | null; episode_number: number | null
  }> {
    if (!this.db) throw new Error('Database not initialized')
    return this.db.prepare(`
      SELECT m.id, m.title, m.year, m.type, m.poster_url, m.source_id,
        qs.quality_tier, qs.previous_quality_tier, qs.upgraded_at,
        m.series_title, m.season_number, m.episode_number
      FROM quality_scores qs
      JOIN media_items m ON m.id = qs.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE qs.upgraded_at IS NOT NULL
        AND qs.upgraded_at >= datetime('now', ?)
        AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        AND (? IS NULL OR m.source_id = ?)
      ORDER BY qs.upgraded_at DESC
      ${sourceId ? '' : 'LIMIT 50'}
    `).all(`-${days} days`, sourceId ?? null, sourceId ?? null) as Array<{
      id: number; title: string; year: number | null; type: string
      poster_url: string | null; quality_tier: string; source_id: string
      previous_quality_tier: string; upgraded_at: string
      series_title: string | null; season_number: number | null; episode_number: number | null
    }>
  }

  getRecentlyUpgradedMusic(days: number = 30, sourceId?: string): Array<{
    album_id: number; title: string; artist_name: string; source_id: string
    quality_tier: string; previous_quality_tier: string; upgraded_at: string
  }> {
    if (!this.db) throw new Error('Database not initialized')
    return this.db.prepare(`
      SELECT a.id as album_id, a.title, a.artist_name, a.source_id,
        mqs.quality_tier, mqs.previous_quality_tier, mqs.upgraded_at
      FROM music_quality_scores mqs
      JOIN music_albums a ON a.id = mqs.album_id
      WHERE mqs.upgraded_at IS NOT NULL
        AND mqs.upgraded_at >= datetime('now', ?)
        AND (? IS NULL OR a.source_id = ?)
      ORDER BY mqs.upgraded_at DESC
      ${sourceId ? '' : 'LIMIT 50'}
    `).all(`-${days} days`, sourceId ?? null, sourceId ?? null) as Array<{
      album_id: number; title: string; artist_name: string; source_id: string
      quality_tier: string; previous_quality_tier: string; upgraded_at: string
    }>
  }

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  /**
   * Get media items with filters
   * By default, only returns items from enabled libraries
   */
  getMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }, projection?: 'card'): MediaItem[] {
    if (!this.db) throw new Error('Database not initialized')

    const { whereClause, params } = this.buildMediaItemWhere(filters)

    const selectedColumns = projection === 'card'
      ? 'm.id, m.title, m.year, m.type, m.source_id, m.source_type, m.library_id, m.file_path, m.file_size_bytes, m.resolution, m.video_bitrate_kbps, m.audio_channels, m.poster_url, m.tmdb_id, m.imdb_id'
      : 'm.*'
    let sql = `
      SELECT ${selectedColumns},
             q.overall_score, q.needs_upgrade,
             q.quality_tier, q.tier_quality, q.tier_score, q.issues,
             q.video_savings_bytes, q.estimated_savings_bytes, q.savings_coverage, q.evidence_status, q.confidence, q.savings_basis
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      ${whereClause}
    `

    // Dynamic sorting with validated column names (prevent SQL injection)
    const sortColumnMap: Record<string, string> = {
      'title': 'COALESCE(m.sort_title, m.title)',
      'year': 'm.year',
      'play_count': 'm.play_count',
      'last_watched_at': 'm.last_watched_at',
      'updated_at': 'm.updated_at',
      'created_at': 'm.created_at',
      'overall_score': 'q.overall_score',
      'tmdb_rating': 'm.tmdb_rating',
      'estimated_savings_bytes': 'q.estimated_savings_bytes',
      'total_size_bytes': 'm.file_size_bytes'
    }
    const sortColumn = sortColumnMap[filters?.sortBy || 'title'] || 'COALESCE(m.sort_title, m.title)'
    const sortOrder = filters?.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    // For watch history / rating sorts: NULLs last, secondary sort by title
    if (filters?.sortBy === 'last_watched_at' || filters?.sortBy === 'tmdb_rating' || filters?.sortBy === 'estimated_savings_bytes') {
      sql += ` ORDER BY ${sortColumn} IS NULL ASC, ${sortColumn} ${sortOrder}, COALESCE(m.sort_title, m.title) ASC, m.id ASC`
    } else if (filters?.sortBy === 'play_count') {
      sql += ` ORDER BY ${sortColumn} ${sortOrder}, COALESCE(m.sort_title, m.title) ASC, m.id ASC`
    } else {
      sql += ` ORDER BY ${sortColumn} ${sortOrder}, m.id ASC`
    }

    // Pagination
    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params).map((row) => this.mapMediaItem(row as Record<string, unknown>))
  }

  /**
   * Get media item by ID
   */
  getMediaItem(id: number): MediaItem | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_items WHERE id = ?')
    const row = stmt.get(id) as Record<string, unknown> | undefined
    return row ? this.mapMediaItem(row) : null
  }

  /**
   * Get media item by file path
   */
  getMediaItemByPath(filePath: string): MediaItem | null {
    if (!this.db) throw new Error('Database not initialized')

    const row = this.db.prepare('SELECT * FROM media_items WHERE file_path = ?').get(filePath) as Record<string, unknown> | undefined
    if (row) return this.mapMediaItem(row)
    // A secondary movie version also belongs to an existing canonical media item.
    // Never create another parent solely because its file is not the best version.
    const parents = this.db.prepare(
      'SELECT m.* FROM media_items m JOIN media_item_versions v ON v.media_item_id = m.id WHERE v.file_path = ? LIMIT 2'
    ).all(filePath) as Record<string, unknown>[]
    if (parents.length > 1) throw new Error(`Multiple media items own the same version file ${filePath}`)
    return parents.length ? this.mapMediaItem(parents[0]) : null
  }

  /**
   * Update deep analysis for a media item by file path
   */
  updateDeepAnalysisByPath(filePath: string, analysis: unknown, timestamp?: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const deepAnalysisJson = typeof analysis === 'string' ? analysis : JSON.stringify(analysis)
    const deepAnalysisAt = timestamp || new Date().toISOString()
    const stmt = this.db.prepare(
      'UPDATE media_items SET deep_analysis = ?, deep_analysis_at = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?'
    )
    stmt.run(deepAnalysisJson, deepAnalysisAt, filePath)
  }

  /**
   * Get media item by provider ID
   */
  getMediaItemByProviderId(providerId: string, sourceId?: string): MediaItem | null {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM media_items WHERE plex_id = ?'
    const params: unknown[] = [providerId]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }

    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as Record<string, unknown> | undefined
    return row ? this.mapMediaItem(row) : null
  }

  /**
   * Count media items matching filters
   * Uses same filter logic as getMediaItems but returns count only
   */
  countMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): number {
    if (!this.db) throw new Error('Database not initialized')

    const { whereClause, params } = this.buildMediaItemWhere(filters)

    let sql = `
      SELECT COUNT(*) as count
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      ${whereClause}
    `

    const stmt = this.db.prepare(sql)
    const result = stmt.get(...params) as { count: number }
    return result.count
  }

  getOptimizationMetrics(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): OptimizationMetricsSummary {
    if (!this.db) throw new Error('Database not initialized')

    const { whereClause, params } = this.buildMediaItemWhere(filters)
    const result = this.db.prepare(`
      SELECT SUM(q.estimated_savings_bytes) AS estimatedSavingsBytes,
        COUNT(m.id) AS itemCount,
        SUM(CASE WHEN q.estimated_savings_bytes IS NULL OR q.savings_coverage IS NULL OR q.savings_coverage != 'complete' THEN 1 ELSE 0 END) AS incompleteCount
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      ${whereClause}
    `).get(...params) as { estimatedSavingsBytes: number | null; itemCount: number; incompleteCount: number }

    const coverage = result.estimatedSavingsBytes == null || result.itemCount === 0
      ? 'insufficient'
      : result.incompleteCount > 0 ? 'partial' : 'complete'
    return { estimatedSavingsBytes: result.estimatedSavingsBytes, coverage }
  }

  private buildMediaItemWhere(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): { whereClause: string; params: unknown[] } {
    let whereClause = 'WHERE 1=1'
    const params: unknown[] = []

    if (!filters?.includeDisabledLibraries) {
      whereClause += ' AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)'
    }
    if (filters?.type) {
      whereClause += ' AND m.type = ?'
      params.push(filters.type)
    }
    if (filters?.sourceId) {
      whereClause += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.sourceType) {
      whereClause += ' AND m.source_type = ?'
      params.push(filters.sourceType)
    }
    if (filters?.libraryId) {
      whereClause += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.searchQuery) {
      whereClause += ' AND m.id IN (SELECT rowid FROM media_fts WHERE media_fts MATCH ?)'
      params.push(BetterSQLiteService.buildFtsQuery(filters.searchQuery))
    }
    if (filters?.alphabetFilter === '#') {
      whereClause += " AND m.title NOT GLOB '[A-Za-z]*'"
    } else if (filters?.alphabetFilter) {
      whereClause += ' AND UPPER(SUBSTR(m.title, 1, 1)) = ?'
      params.push(filters.alphabetFilter.toUpperCase())
    }
    if (filters?.qualityTier) {
      whereClause += ' AND q.quality_tier = ?'
      params.push(filters.qualityTier)
    }
    if (filters?.tierQuality) {
      whereClause += ' AND q.tier_quality = ?'
      params.push(filters.tierQuality)
    }
    if (filters?.needsUpgrade === true) {
      whereClause += ` AND (q.needs_upgrade = 1 OR (ls.upgrade_min_tier IS NOT NULL AND
        CASE q.quality_tier WHEN '4K' THEN 4 WHEN '1080p' THEN 3 WHEN '720p' THEN 2 ELSE 1 END
        < CASE ls.upgrade_min_tier WHEN '4K' THEN 4 WHEN '1080p' THEN 3 WHEN '720p' THEN 2 ELSE 1 END))`
      whereClause += ` AND m.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)`
    } else if (filters?.needsUpgrade === false) {
      whereClause += ' AND q.needs_upgrade = ?'
      params.push(0)
    }

    return { whereClause, params }
  }

  /**
   * Upsert media item
   */
  upsertMediaItem(item: MediaItemUpsert): number {
    if (!this.db) throw new Error('Database not initialized')

    let seriesIdentityKey = item.series_identity_key
    if (item.type === 'episode') {
      const isCanonical =
        typeof seriesIdentityKey === 'string' &&
        (seriesIdentityKey.startsWith('tmdb:') ||
          seriesIdentityKey.startsWith('tvdb:') ||
          seriesIdentityKey.startsWith('unresolved:'))
      if (!isCanonical) {
        seriesIdentityKey = deriveSeriesIdentityKey({
          sourceId: item.source_id || 'legacy',
          libraryId: item.library_id || '',
          folderRelativePath: item.series_title || item.file_path || 'unknown',
          tmdbId: item.series_tmdb_id || item.tmdb_id,
        })
      }
    } else {
      seriesIdentityKey = null
    }

    const stmt = this.db.prepare(`
      INSERT INTO media_items (
        source_id, source_type, library_id, plex_id, title, sort_title, year, type,
        series_title, series_identity_key, season_number, episode_number, file_path, file_size_bytes,
        duration_ms, resolution, width, height, video_codec, video_bitrate_kbps,
        audio_codec, audio_channels, audio_bitrate_kbps, video_frame_rate,
        color_bit_depth, hdr_format, color_space, video_profile, video_level, dolby_vision_profile,
        audio_profile, audio_sample_rate, has_object_audio, audio_tracks,
        subtitle_tracks,
        container, file_mtime, imdb_id, tmdb_id, series_tmdb_id, original_language, poster_url,
        episode_thumb_url, season_poster_url, summary, tmdb_rating, user_fixed_match,
        play_count, last_watched_at,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
      )
      ON CONFLICT(source_id, plex_id) DO UPDATE SET
        library_id = excluded.library_id,
        title = excluded.title,
        sort_title = excluded.sort_title,
        year = excluded.year,
        type = excluded.type,
        series_title = excluded.series_title,
        series_identity_key = COALESCE(excluded.series_identity_key, media_items.series_identity_key),
        season_number = excluded.season_number,
        episode_number = excluded.episode_number,
        file_path = excluded.file_path,
        file_size_bytes = excluded.file_size_bytes,
        duration_ms = excluded.duration_ms,
        resolution = excluded.resolution,
        width = excluded.width,
        height = excluded.height,
        video_codec = excluded.video_codec,
        video_bitrate_kbps = excluded.video_bitrate_kbps,
        audio_codec = excluded.audio_codec,
        audio_channels = excluded.audio_channels,
        audio_bitrate_kbps = excluded.audio_bitrate_kbps,
        video_frame_rate = excluded.video_frame_rate,
        color_bit_depth = excluded.color_bit_depth,
        hdr_format = excluded.hdr_format,
        color_space = excluded.color_space,
        video_profile = excluded.video_profile,
        video_level = excluded.video_level,
        dolby_vision_profile = excluded.dolby_vision_profile,
        audio_profile = excluded.audio_profile,
        audio_sample_rate = excluded.audio_sample_rate,
        has_object_audio = excluded.has_object_audio,
        audio_tracks = excluded.audio_tracks,
        subtitle_tracks = excluded.subtitle_tracks,
        container = excluded.container,
        file_mtime = excluded.file_mtime,
        imdb_id = COALESCE(excluded.imdb_id, media_items.imdb_id),
        tmdb_id = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.tmdb_id ELSE COALESCE(excluded.tmdb_id, media_items.tmdb_id) END,
        series_tmdb_id = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.series_tmdb_id ELSE COALESCE(excluded.series_tmdb_id, media_items.series_tmdb_id) END,
        original_language = COALESCE(excluded.original_language, media_items.original_language),
        poster_url = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.poster_url ELSE COALESCE(excluded.poster_url, media_items.poster_url) END,
        episode_thumb_url = COALESCE(excluded.episode_thumb_url, media_items.episode_thumb_url),
        season_poster_url = COALESCE(excluded.season_poster_url, media_items.season_poster_url),
        summary = COALESCE(excluded.summary, media_items.summary),
        tmdb_rating = COALESCE(excluded.tmdb_rating, media_items.tmdb_rating),
        user_fixed_match = CASE WHEN media_items.user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END,
        play_count = MAX(excluded.play_count, media_items.play_count),
        last_watched_at = CASE WHEN excluded.last_watched_at IS NOT NULL AND (media_items.last_watched_at IS NULL OR excluded.last_watched_at > media_items.last_watched_at) THEN excluded.last_watched_at ELSE media_items.last_watched_at END,
        updated_at = datetime('now')
    `)

    const sourceId = item.source_id || 'legacy'
    stmt.run(
      sourceId,
      item.source_type || 'plex',
      item.library_id || null,
      item.plex_id,
      item.title,
      item.sort_title || null,
      item.year || null,
      item.type,
      item.series_title || null,
      seriesIdentityKey,
      item.season_number || null,
      item.episode_number || null,
      item.file_path,
      item.file_size_bytes,
      item.duration_ms,
      item.resolution,
      item.width,
      item.height,
      item.video_codec,
      item.video_bitrate_kbps,
      item.audio_codec,
      item.audio_channels,
      item.audio_bitrate_kbps,
      item.video_frame_rate || null,
      item.color_bit_depth || null,
      item.hdr_format || null,
      item.color_space || null,
      item.video_profile || null,
      item.video_level || null,
      item.dolby_vision_profile ?? null,
      item.audio_profile || null,
      item.audio_sample_rate || null,
      item.has_object_audio ? 1 : 0,
      item.audio_tracks || null,
      item.subtitle_tracks || null,
      item.container || null,
      item.file_mtime || null,
      item.imdb_id || null,
      item.tmdb_id || null,
      item.series_tmdb_id || null,
      item.original_language || null,
      item.poster_url || null,
      item.episode_thumb_url || null,
      item.season_poster_url || null,
      item.summary || null,
      item.tmdb_rating || null,
      item.user_fixed_match ? 1 : 0,
      item.play_count || 0,
      item.last_watched_at || null
    )

    // Always look up by unique key — lastInsertRowid is unreliable after
    // ON CONFLICT DO UPDATE (may return stale rowid from a prior INSERT)
    const existing = this.getMediaItemByProviderId(item.plex_id, sourceId)
    return existing?.id || 0
  }

  /**
   * Delete media item
   */
  deleteMediaItem(id: number): void {
    if (!this.db) throw new Error('Database not initialized')

    const db = this.db
    const invalidatedSeriesScopes = new Map<string, { sourceId: string; libraryId: string }>()
    const txn = db.transaction(() => {
    // Before deleting, update affected collections and series completeness
    try {
      const item = db.prepare(
        'SELECT tmdb_id, series_tmdb_id, series_identity_key, file_path, source_id, library_id, type, series_title, season_number, episode_number, title FROM media_items WHERE id = ?'
      ).get(id) as {
        tmdb_id?: string
        series_tmdb_id?: number | string
        series_identity_key?: string
        file_path?: string
        source_id: string
        library_id?: string
        type: string
        series_title?: string
        season_number?: number
        episode_number?: number
        title?: string
      } | undefined

      if (item) {
        if (item.tmdb_id && item.type === 'movie') {
          this.updateCollectionsAfterDeletion([String(item.tmdb_id)], item.source_id)
        }
        if (item.type === 'episode') {
          const libraryId = item.library_id || ''
          const seriesIdentityKey =
            item.series_identity_key ||
            deriveSeriesIdentityKey({
              sourceId: item.source_id || 'legacy',
              libraryId,
              folderRelativePath: item.series_title || item.file_path || 'unknown',
              tmdbId: item.series_tmdb_id != null ? String(item.series_tmdb_id) : (item.tmdb_id ? String(item.tmdb_id) : undefined),
            })

          // Delete the episode and its derived analysis.
          db.prepare('DELETE FROM media_item_versions WHERE media_item_id = ?').run(id)
          db.prepare('DELETE FROM quality_scores WHERE media_item_id = ?').run(id)
          db.prepare('DELETE FROM media_item_collections WHERE media_item_id = ?').run(id)
          db.prepare('DELETE FROM media_items WHERE id = ?').run(id)

          // Completion is derived from the aired episode catalogue; invalidate it rather than guessing from inventory.
          const cacheScopes = db.prepare(
            `SELECT source_id, library_id FROM series_completeness
             WHERE series_identity_key = ?
               AND source_id IN (?, '') AND library_id IN (?, '')`
          ).all(seriesIdentityKey, item.source_id, libraryId) as Array<{ source_id: string; library_id: string }>
          db.prepare(
            `DELETE FROM series_completeness
             WHERE series_identity_key = ?
               AND source_id IN (?, '') AND library_id IN (?, '')`
          ).run(seriesIdentityKey, item.source_id, libraryId)
          invalidatedSeriesScopes.set(`${item.source_id}\0${libraryId}`, { sourceId: item.source_id, libraryId })
          for (const scope of cacheScopes) {
            invalidatedSeriesScopes.set(`${scope.source_id}\0${scope.library_id}`, {
              sourceId: scope.source_id,
              libraryId: scope.library_id,
            })
          }

          // Already deleted above, skip the deletion below
          return
        }
      }
    } catch (e) { console.warn(`[BetterSQLite] Error updating completeness on delete (item ${id}):`, e) }

    // Delete associated data
    db.prepare('DELETE FROM media_item_versions WHERE media_item_id = ?').run(id)
    db.prepare('DELETE FROM quality_scores WHERE media_item_id = ?').run(id)
    db.prepare('DELETE FROM media_item_collections WHERE media_item_id = ?').run(id)
    db.prepare('DELETE FROM media_items WHERE id = ?').run(id)
    })

    txn()
    for (const scope of invalidatedSeriesScopes.values()) {
      if (this.seriesCompletenessInvalidationHandler) {
        this.seriesCompletenessInvalidationHandler(scope.sourceId, scope.libraryId)
      } else {
        this.invalidatedSeriesCompletenessScopes.add(`${scope.sourceId}\0${scope.libraryId}`)
      }
    }
  }

  /**
   * Clean up orphaned rows in related tables where the parent media_item was deleted.
   * Handles quality_scores, media_item_versions, and media_item_collections that
   * may have been left behind due to transaction timing or CASCADE failures.
   */
  cleanupOrphanedMediaData(): number {
    if (!this.db) throw new Error('Database not initialized')

    const db = this.db
    const txn = db.transaction(() => {
      let cleaned = 0
      cleaned += db.prepare(
        'DELETE FROM quality_scores WHERE media_item_id NOT IN (SELECT id FROM media_items)'
      ).run().changes
      cleaned += db.prepare(
        'DELETE FROM media_item_versions WHERE media_item_id NOT IN (SELECT id FROM media_items)'
      ).run().changes
      cleaned += db.prepare(
        'DELETE FROM media_item_collections WHERE media_item_id NOT IN (SELECT id FROM media_items)'
      ).run().changes

      // Validate collection ownership — batch-query all owned TMDB IDs at once
      try {
        const collections = db.prepare(
          'SELECT id, owned_movie_ids, owned_movies, total_movies, source_id FROM movie_collections'
        ).all() as Array<{ id: number; owned_movie_ids: string; owned_movies: number; total_movies: number; source_id: string }>

        // Collect all TMDB IDs across all collections, batch-check existence
        const allTmdbIds = new Set<string>()
        for (const coll of collections) {
          const ownedIds: string[] = JSON.parse(coll.owned_movie_ids || '[]')
          for (const id of ownedIds) allTmdbIds.add(id)
        }

        const existingTmdbIds = new Set<string>()
        if (allTmdbIds.size > 0) {
          const ids = Array.from(allTmdbIds)
          const placeholders = ids.map(() => '?').join(',')
          const rows = db.prepare(
            `SELECT DISTINCT tmdb_id FROM media_items WHERE tmdb_id IN (${placeholders})`
          ).all(...ids) as Array<{ tmdb_id: string }>
          for (const row of rows) existingTmdbIds.add(row.tmdb_id)
        }

        for (const coll of collections) {
          const ownedIds: string[] = JSON.parse(coll.owned_movie_ids || '[]')
          const validIds = ownedIds.filter(tmdbId => existingTmdbIds.has(tmdbId))

          if (validIds.length !== ownedIds.length) {
            if (validIds.length === 0) {
              db.prepare('DELETE FROM movie_collections WHERE id = ?').run(coll.id)
              cleaned++
            } else {
              const newPct = coll.total_movies > 0 ? Math.round((validIds.length / coll.total_movies) * 100) : 0
              db.prepare(
                'UPDATE movie_collections SET owned_movies = ?, owned_movie_ids = ?, completeness_percentage = ?, updated_at = datetime(\'now\') WHERE id = ?'
              ).run(validIds.length, JSON.stringify(validIds), newPct, coll.id)
            }
            cleaned++
          }
        }
      } catch (e) { console.warn('[BetterSQLite] Cleanup warning:', e) }

      // Remove truly orphaned series — no matching episodes in source and library
      try {
        cleaned += this.invalidateStaleSeriesCompleteness()

        cleaned += db.prepare(`
          DELETE FROM series_completeness WHERE id IN (
            SELECT sc.id FROM series_completeness sc
            WHERE NOT EXISTS (
              SELECT 1 FROM media_items mi
              WHERE mi.series_identity_key = sc.series_identity_key
                AND mi.source_id = sc.source_id
                AND mi.library_id = sc.library_id
                AND mi.type = 'episode'
            )
          )
        `).run().changes
      } catch (e) { console.warn('[BetterSQLite] Cleanup warning:', e) }

      // Clean up orphaned music data
      try {
        cleaned += db.prepare(
          'DELETE FROM music_albums WHERE id NOT IN (SELECT DISTINCT album_id FROM music_tracks WHERE album_id IS NOT NULL)'
        ).run().changes
        cleaned += db.prepare(
          'DELETE FROM music_artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM music_tracks WHERE artist_id IS NOT NULL)'
        ).run().changes
        cleaned += db.prepare(
          'DELETE FROM music_quality_scores WHERE album_id NOT IN (SELECT id FROM music_albums)'
        ).run().changes
        cleaned += db.prepare(
          'DELETE FROM album_completeness WHERE album_id NOT IN (SELECT id FROM music_albums)'
        ).run().changes
        cleaned += db.prepare(
          'DELETE FROM artist_completeness WHERE artist_name NOT IN (SELECT name FROM music_artists)'
        ).run().changes
      } catch (e) { console.warn('[BetterSQLite] Cleanup warning:', e) }

      if (cleaned > 0) {
        console.log(`[BetterSQLite] Cleaned up ${cleaned} orphaned rows`)
      }
      return cleaned
    })

    const total = txn()
    this.flushInvalidatedSeriesCompletenessScopes()
    return total
  }

  /**
   * Update movie collections after movies have been deleted.
   * Removes deleted TMDB IDs from owned_movie_ids, decrements owned_movies,
   * recalculates completeness_percentage, and removes empty collections.
   * No TMDB API calls needed — works entirely from local data.
   */
  updateCollectionsAfterDeletion(deletedTmdbIds: string[], sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const deletedSet = new Set(deletedTmdbIds)
    const collections = this.db.prepare(
      'SELECT id, owned_movie_ids, owned_movies, total_movies, missing_movies FROM movie_collections WHERE source_id = ?'
    ).all(sourceId) as Array<{ id: number; owned_movie_ids: string; owned_movies: number; total_movies: number; missing_movies: string }>

    let updated = 0
    for (const coll of collections) {
      try {
        const ownedIds: string[] = JSON.parse(coll.owned_movie_ids || '[]')
        const filteredIds = ownedIds.filter(id => !deletedSet.has(id))

        if (filteredIds.length !== ownedIds.length) {
          const newOwned = filteredIds.length
          const newPct = coll.total_movies > 0
            ? Math.round((newOwned / coll.total_movies) * 100)
            : 0

          if (newOwned === 0) {
            // Remove collection entirely if no owned movies remain
            this.db!.prepare('DELETE FROM movie_collections WHERE id = ?').run(coll.id)
          } else {
            // Add deleted movies to missing_movies JSON
            const missingMovies: Array<{ tmdb_id: string; title: string; year?: number; poster_path?: string }> =
              JSON.parse(coll.missing_movies || '[]')
            const removedIds = ownedIds.filter(tmdbId => deletedSet.has(tmdbId))
            for (const tmdbId of removedIds) {
              if (!missingMovies.some(m => String(m.tmdb_id) === tmdbId)) {
                // Look up movie details (still in media_items at this point)
                const movie = this.db!.prepare(
                  'SELECT title, year, poster_url FROM media_items WHERE tmdb_id = ? AND source_id = ? LIMIT 1'
                ).get(tmdbId, sourceId) as { title: string; year?: number; poster_url?: string } | undefined
                if (movie) {
                  missingMovies.push({
                    tmdb_id: tmdbId,
                    title: movie.title,
                    year: movie.year,
                    poster_path: movie.poster_url,
                  })
                }
              }
            }

            this.db!.prepare(`
              UPDATE movie_collections SET
                owned_movies = ?,
                owned_movie_ids = ?,
                missing_movies = ?,
                completeness_percentage = ?,
                updated_at = datetime('now')
              WHERE id = ?
            `).run(newOwned, JSON.stringify(filteredIds), JSON.stringify(missingMovies), newPct, coll.id)
          }
          updated++
        }
      } catch (e) { console.warn(`[BetterSQLite] Malformed collection data (id ${coll.id}):`, e) }
    }

    if (updated > 0) {
      console.log(`[BetterSQLite] Updated ${updated} collections after movie deletion`)
    }
  }

  /**
   * Invalidate cached completion records whose counts violate the catalogue/missing invariant.
   */
  invalidateStaleSeriesCompleteness(sourceId?: string): number {
    if (!this.db) throw new Error('Database not initialized')

    const staleScopes = this.db.prepare(`
      SELECT DISTINCT source_id, library_id FROM series_completeness
      WHERE ${sourceId ? 'source_id = ? AND' : ''}
        ((total_episodes = 0 AND completeness_percentage != 0)
         OR (total_episodes > 0 AND CASE
              WHEN json_valid(missing_episodes) THEN CASE
                WHEN json_type(missing_episodes) = 'array'
                  THEN owned_episodes != total_episodes - json_array_length(missing_episodes)
                    OR completeness_percentage != ROUND(owned_episodes * 100.0 / total_episodes)
                ELSE 1
              END
              ELSE 1
            END))
    `).all(...(sourceId ? [sourceId] : [])) as Array<{ source_id: string; library_id: string }>
    for (const scope of staleScopes) this.invalidatedSeriesCompletenessScopes.add(`${scope.source_id}\0${scope.library_id}`)

    const sql = `
      DELETE FROM series_completeness
      WHERE ${sourceId ? 'source_id = ? AND' : ''}
        ((total_episodes = 0 AND completeness_percentage != 0)
         OR (total_episodes > 0 AND CASE
              WHEN json_valid(missing_episodes) THEN CASE
                WHEN json_type(missing_episodes) = 'array'
                  THEN owned_episodes != total_episodes - json_array_length(missing_episodes)
                    OR completeness_percentage != ROUND(owned_episodes * 100.0 / total_episodes)
                ELSE 1
              END
              ELSE 1
            END))
    `
    const result = sourceId
      ? this.db.prepare(sql).run(sourceId)
      : this.db.prepare(sql).run()
    if (!this.db.inTransaction) this.flushInvalidatedSeriesCompletenessScopes()

    if (result.changes > 0) {
      console.log(`[BetterSQLite] Invalidated ${result.changes} stale series_completeness records`)
    }

    return result.changes
  }

  setSeriesCompletenessInvalidationHandler(handler: (sourceId: string, libraryId: string) => void): void {
    this.seriesCompletenessInvalidationHandler = handler
  }

  consumeInvalidatedSeriesCompletenessScopes(): Array<{ sourceId: string; libraryId: string }> {
    const scopes = Array.from(this.invalidatedSeriesCompletenessScopes, key => {
      const [sourceId, libraryId] = key.split('\0')
      return { sourceId, libraryId }
    })
    this.invalidatedSeriesCompletenessScopes.clear()
    return scopes
  }

  private flushInvalidatedSeriesCompletenessScopes(): void {
    if (!this.seriesCompletenessInvalidationHandler || this.invalidatedSeriesCompletenessScopes.size === 0) return
    for (const scope of this.consumeInvalidatedSeriesCompletenessScopes()) {
      this.seriesCompletenessInvalidationHandler(scope.sourceId, scope.libraryId)
    }
  }

  /**
   * Remove orphaned music data — artists/albums with no tracks,
   * and related completeness/quality records.
   */
  cleanupOrphanedMusicData(sourceId?: string): number {
    if (!this.db) throw new Error('Database not initialized')

    let cleaned = 0

    // Delete music quality scores for albums that no longer exist
    cleaned += this.db.prepare(
      'DELETE FROM music_quality_scores WHERE album_id NOT IN (SELECT id FROM music_albums)'
    ).run().changes

    // Delete album completeness for albums that no longer exist
    cleaned += this.db.prepare(
      'DELETE FROM album_completeness WHERE album_id NOT IN (SELECT id FROM music_albums)'
    ).run().changes

    // Delete artist completeness for artists that no longer exist
    cleaned += this.db.prepare(
      'DELETE FROM artist_completeness WHERE artist_name NOT IN (SELECT name FROM music_artists)'
    ).run().changes

    // Delete albums with 0 tracks (parameterized, no string interpolation)
    if (sourceId) {
      cleaned += this.db.prepare(
        'DELETE FROM music_albums WHERE source_id = ? AND id NOT IN (SELECT DISTINCT album_id FROM music_tracks WHERE album_id IS NOT NULL)'
      ).run(sourceId).changes
    } else {
      cleaned += this.db.prepare(
        'DELETE FROM music_albums WHERE id NOT IN (SELECT DISTINCT album_id FROM music_tracks WHERE album_id IS NOT NULL)'
      ).run().changes
    }

    // Delete artists with 0 tracks (parameterized)
    if (sourceId) {
      cleaned += this.db.prepare(
        'DELETE FROM music_artists WHERE source_id = ? AND id NOT IN (SELECT DISTINCT artist_id FROM music_tracks WHERE artist_id IS NOT NULL)'
      ).run(sourceId).changes
    } else {
      cleaned += this.db.prepare(
        'DELETE FROM music_artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM music_tracks WHERE artist_id IS NOT NULL)'
      ).run().changes
    }

    if (cleaned > 0) {
      console.log(`[BetterSQLite] Cleaned up ${cleaned} orphaned music rows`)
    }

    return cleaned
  }

  /**
   * Delete all media items for a source
   */
  deleteMediaItemsForSource(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Delete versions and quality scores first
    this.db.prepare(`
      DELETE FROM media_item_versions WHERE media_item_id IN (
        SELECT id FROM media_items WHERE source_id = ?
      )
    `).run(sourceId)
    this.db.prepare(`
      DELETE FROM quality_scores WHERE media_item_id IN (
        SELECT id FROM media_items WHERE source_id = ?
      )
    `).run(sourceId)

    this.db.prepare('DELETE FROM media_items WHERE source_id = ?').run(sourceId)
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
        file_path, file_size_bytes, duration_ms,
        resolution, width, height, video_codec, video_bitrate_kbps,
        audio_codec, audio_channels, audio_bitrate_kbps,
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
        file_size_bytes = excluded.file_size_bytes,
        duration_ms = excluded.duration_ms,
        resolution = excluded.resolution,
        width = excluded.width,
        height = excluded.height,
        video_codec = excluded.video_codec,
        video_bitrate_kbps = excluded.video_bitrate_kbps,
        audio_codec = excluded.audio_codec,
        audio_channels = excluded.audio_channels,
        audio_bitrate_kbps = excluded.audio_bitrate_kbps,
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

    stmt.run(
      version.media_item_id,
      version.version_source || 'primary',
      version.edition || null,
      version.label || null,
      version.file_path,
      version.file_size_bytes,
      version.duration_ms,
      version.resolution,
      version.width,
      version.height,
      version.video_codec,
      version.video_bitrate_kbps,
      version.audio_codec,
      version.audio_channels,
      version.audio_bitrate_kbps,
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
      version.tier_score ?? null,
      version.is_best ? 1 : 0
    )

    // Always look up by unique key — lastInsertRowid is unreliable after ON CONFLICT DO UPDATE
    const existing = this.db.prepare(
      'SELECT id FROM media_item_versions WHERE media_item_id = ? AND file_path = ?'
    ).get(version.media_item_id, version.file_path) as { id: number } | undefined
    return existing?.id || 0
  }

  /**
   * Get all versions for a media item
   */
  getMediaItemVersions(mediaItemId: number): MediaItemVersion[] {
    if (!this.db) throw new Error('Database not initialized')

    const rows = this.db.prepare(
      'SELECT * FROM media_item_versions WHERE media_item_id = ? ORDER BY is_best DESC, id ASC'
    ).all(mediaItemId) as Record<string, unknown>[]

    return rows.map(row => ({
      id: row.id as number,
      media_item_id: row.media_item_id as number,
      version_source: row.version_source as string,
      edition: row.edition as string | undefined,
      label: row.label as string | undefined,
      file_path: row.file_path as string,
      file_size_bytes: row.file_size_bytes as number,
      duration_ms: row.duration_ms as number,
      resolution: row.resolution as string,
      width: row.width as number,
      height: row.height as number,
      video_codec: row.video_codec as string,
      video_bitrate_kbps: row.video_bitrate_kbps as number,
      audio_codec: row.audio_codec as string,
      audio_channels: row.audio_channels as number,
      audio_bitrate_kbps: row.audio_bitrate_kbps as number,
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
      tier_quality: row.tier_quality as MediaItemVersion['tier_quality'],
      tier_score: row.tier_score as number | undefined,
      is_best: !!(row.is_best as number),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }))
  }

  /**
   * Update only the quality scoring fields on a version row.
   */
  updateMediaItemVersionQuality(versionId: number, scores: { quality_tier: string; tier_quality: string; tier_score: number | null; bitrate_tier_score: number | null; audio_tier_score: number | null }): void {
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
  syncMediaItemVersions(mediaItemId: number, versions: MediaItemVersion[], mode: 'replace' | 'merge' = 'replace'): void {
    if (!this.db) throw new Error('Database not initialized')

    const selectedFilePath = (this.db.prepare(
      'SELECT file_path FROM media_item_versions WHERE media_item_id = ? AND is_best = 1 ORDER BY id LIMIT 1'
    ).get(mediaItemId) as { file_path: string } | undefined)?.file_path
    const currentFilePaths = versions.map(v => v.file_path).filter(Boolean)

    if (mode === 'replace') {
      // Replacement is authorized only when caller supplies an exhaustive inventory.
      if (currentFilePaths.length > 0) {
        const placeholders = currentFilePaths.map(() => '?').join(',')
        this.db.prepare(
          `DELETE FROM media_item_versions WHERE media_item_id = ? AND file_path NOT IN (${placeholders})`
        ).run(mediaItemId, ...currentFilePaths)
      } else {
        this.db.prepare('DELETE FROM media_item_versions WHERE media_item_id = ?').run(mediaItemId)
      }
    }

    for (const version of versions) {
      this.upsertMediaItemVersion({
        ...version,
        is_best: version.is_best || version.file_path === selectedFilePath,
      })
    }

    this.updateBestVersion(mediaItemId)
  }

  /**
   * Update the best version flag and sync parent media_item fields.
   * Picks the highest quality version and copies its data to the parent item.
   */
  updateBestVersion(mediaItemId: number, observedPaths?: ReadonlySet<string>): void {
    if (!this.db) throw new Error('Database not initialized')

    // When an inventory is partial, keep all historical versions but choose
    // the playback parent only from versions actually observed in this scan.
    const allVersions = this.getMediaItemVersions(mediaItemId)
    const versions = observedPaths
      ? allVersions.filter(version => observedPaths.has(version.file_path))
      : allVersions
    if (versions.length === 0) return

    // Resolution is the only available objective source-quality ranking.
    const rankedVersions = versions.map(version => ({
      version,
      rank: getVideoResolutionRank(version.quality_tier === 'UNKNOWN' ? null : version.quality_tier)
        ?? getVideoResolutionRank(getVideoResolutionTier(version.resolution, version.height)),
    })).filter((entry): entry is { version: MediaItemVersion; rank: number } => entry.rank !== null)
    const highestTierRank = Math.max(...rankedVersions.map(entry => entry.rank))
    const topVersions = rankedVersions
      .filter(entry => entry.rank === highestTierRank)
      .map(entry => entry.version)
    const best = topVersions.length === 1
      ? topVersions[0]
      : topVersions.find(version => version.is_best)

    // Wrap in transaction to ensure consistency across the 3 related updates
    const updateBest = this.db.transaction(() => {
      // Clear all is_best flags, then set the best one
      this.db!.prepare('UPDATE media_item_versions SET is_best = 0 WHERE media_item_id = ?').run(mediaItemId)
      if (best?.id) {
        this.db!.prepare('UPDATE media_item_versions SET is_best = 1 WHERE id = ?').run(best.id)
      }

      // Sync best version's file/quality fields to parent media_item
      if (best) this.db!.prepare(`
        UPDATE media_items SET
          file_path = ?, file_size_bytes = ?, duration_ms = ?,
          resolution = ?, width = ?, height = ?,
          video_codec = ?, video_bitrate_kbps = ?,
          audio_codec = ?, audio_channels = ?, audio_bitrate_kbps = ?,
          video_frame_rate = ?, color_bit_depth = ?, hdr_format = ?, color_space = ?,
          video_profile = ?, video_level = ?,
          audio_profile = ?, audio_sample_rate = ?, has_object_audio = ?,
          audio_tracks = ?, subtitle_tracks = ?, container = ?, file_mtime = ?,
          version_count = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        best.file_path, best.file_size_bytes, best.duration_ms,
        best.resolution, best.width, best.height,
        best.video_codec, best.video_bitrate_kbps,
        best.audio_codec, best.audio_channels, best.audio_bitrate_kbps,
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
      else this.db!.prepare("UPDATE media_items SET version_count = ?, updated_at = datetime('now') WHERE id = ?").run(versions.length, mediaItemId)
    })
    updateBest()
  }

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  /**
   * Upsert quality score
   */
  private static readonly TIER_RANK: Record<string, number> = { 'SD': 0, '720p': 1, '1080p': 2, '4K': 3 }
  private static readonly MUSIC_TIER_RANK: Record<string, number> = { 'LOSSY_LOW': 0, 'LOSSY_MID': 1, 'LOSSY_HIGH': 2, 'LOSSLESS': 3, 'HI_RES': 4 }

  upsertQualityScore(score: Omit<QualityScore, 'created_at' | 'updated_at'>): void {
    if (!this.db) throw new Error('Database not initialized')

    // Check existing tier to detect upgrades
    const existing = this.db.prepare(
      'SELECT quality_tier, previous_quality_tier, upgraded_at FROM quality_scores WHERE media_item_id = ?'
    ).get(score.media_item_id) as { quality_tier: string; previous_quality_tier: string | null; upgraded_at: string | null } | undefined

    let prevTier: string | null = null
    let upgradedAt: string | null = null

    if (existing) {
      const oldRank = BetterSQLiteService.TIER_RANK[existing.quality_tier] ?? 0
      const newRank = BetterSQLiteService.TIER_RANK[score.quality_tier] ?? 0
      if (newRank > oldRank) {
        // Tier improved — record the upgrade
        prevTier = existing.quality_tier
        upgradedAt = new Date().toISOString()
      } else {
        // No improvement — preserve existing upgrade history
        prevTier = existing.previous_quality_tier
        upgradedAt = existing.upgraded_at
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO quality_scores (
        media_item_id, quality_tier, tier_quality, tier_score,
        bitrate_tier_score, audio_tier_score, video_savings_bytes, overall_score,
        resolution_score, bitrate_score, audio_score,
        is_low_quality, needs_upgrade, issues,
        previous_quality_tier, upgraded_at,
        evidence_status,
        estimated_savings_bytes, savings_coverage, confidence, savings_basis,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(media_item_id) DO UPDATE SET
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        bitrate_tier_score = excluded.bitrate_tier_score,
        audio_tier_score = excluded.audio_tier_score,
        video_savings_bytes = excluded.video_savings_bytes,
        overall_score = excluded.overall_score,
        resolution_score = excluded.resolution_score,
        bitrate_score = excluded.bitrate_score,
        audio_score = excluded.audio_score,
        is_low_quality = excluded.is_low_quality,
        needs_upgrade = excluded.needs_upgrade,
        issues = excluded.issues,
        previous_quality_tier = excluded.previous_quality_tier,
        upgraded_at = excluded.upgraded_at,
        evidence_status = excluded.evidence_status,
        estimated_savings_bytes = excluded.estimated_savings_bytes,
        savings_coverage = excluded.savings_coverage,
        confidence = excluded.confidence,
        savings_basis = excluded.savings_basis,
        updated_at = datetime('now')
    `)

    stmt.run(
      score.media_item_id,
      score.quality_tier,
      score.tier_quality,
      score.tier_score,
      score.bitrate_tier_score,
      score.audio_tier_score,
      score.video_savings_bytes ?? null,
      score.overall_score,
      score.resolution_score,
      score.bitrate_score,
      score.audio_score,
      score.is_low_quality ? 1 : 0,
      score.needs_upgrade ? 1 : 0,
      score.issues,
      prevTier,
      upgradedAt,
      score.evidence_status ?? null,
      score.estimated_savings_bytes ?? null,
      score.savings_coverage,
      score.confidence ?? null,
      score.savings_basis ?? null
    )
  }

  upsertQualityScores(scores: QualityScore[]): void {
    if (!this.db) throw new Error('Database not initialized')
    const run = this.db.transaction((items: QualityScore[]) => {
      for (const item of items) {
        this.upsertQualityScore(item)
      }
    })
    run(scores)
  }

  upsertQualityRatings(scores: QualityScore[]): void {
    if (!this.db) throw new Error('Database not initialized')
    const upsert = this.db.prepare(`INSERT INTO quality_scores (
      media_item_id, quality_tier, tier_quality, tier_score, bitrate_tier_score, audio_tier_score,
      overall_score, is_low_quality, needs_upgrade
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(media_item_id) DO UPDATE SET
      quality_tier = excluded.quality_tier,
      tier_quality = excluded.tier_quality,
      tier_score = excluded.tier_score,
      bitrate_tier_score = excluded.bitrate_tier_score,
      audio_tier_score = excluded.audio_tier_score,
      overall_score = excluded.overall_score,
      is_low_quality = excluded.is_low_quality,
      needs_upgrade = excluded.needs_upgrade,
      updated_at = datetime('now')`)
    const run = this.db.transaction((items: QualityScore[]) => {
      for (const score of items) {
        upsert.run(score.media_item_id, score.quality_tier, score.tier_quality, score.tier_score,
          score.bitrate_tier_score, score.audio_tier_score, score.overall_score,
          score.is_low_quality ? 1 : 0, score.needs_upgrade ? 1 : 0)
      }
    })
    run(scores)
  }

  updateQualitySavings(score: Pick<QualityScore, 'media_item_id' | 'video_savings_bytes' | 'estimated_savings_bytes' | 'savings_coverage' | 'evidence_status' | 'confidence' | 'savings_basis'>): void {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.prepare(`UPDATE quality_scores SET
      video_savings_bytes = ?, estimated_savings_bytes = ?, savings_coverage = ?,
      evidence_status = ?, confidence = ?, savings_basis = ?, updated_at = datetime('now')
      WHERE media_item_id = ?`).run(
      score.video_savings_bytes ?? null,
      score.estimated_savings_bytes ?? null,
      score.savings_coverage,
      score.evidence_status ?? null,
      score.confidence ?? null,
      score.savings_basis ?? null,
      score.media_item_id,
    )
    if (result.changes === 0) throw new Error(`Quality score missing for media item ${score.media_item_id}`)
  }

  async withBatch<T>(fn: () => Promise<T> | T): Promise<T> {
    this.startBatch()
    try {
      return await fn()
    } finally {
      await this.endBatch()
    }
  }

  getItemVersionsForMediaIds(mediaItemIds: number[]): Map<number, MediaItemVersion[]> {
    if (!this.db || mediaItemIds.length === 0) return new Map()
    const result = new Map<number, MediaItemVersion[]>()
    const chunkSize = 500
    for (let i = 0; i < mediaItemIds.length; i += chunkSize) {
      const chunk = mediaItemIds.slice(i, i + chunkSize)
      const placeholders = chunk.map(() => '?').join(',')
      const rows = this.db.prepare(`SELECT * FROM media_item_versions WHERE media_item_id IN (${placeholders}) ORDER BY media_item_id, id`).all(...chunk) as Array<Omit<MediaItemVersion, 'has_object_audio' | 'is_best'> & { has_object_audio: number | null; is_best: number }>
      for (const row of rows) {
        const version: MediaItemVersion = { ...row, has_object_audio: Boolean(row.has_object_audio), is_best: Boolean(row.is_best) }
        if (!result.has(version.media_item_id)) {
          result.set(version.media_item_id, [])
        }
        result.get(version.media_item_id)!.push(version)
      }
    }
    return result
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
  getMediaSources(type?: string): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM media_sources'
    const params: string[] = []

    if (type) {
      sql += ' WHERE source_type = ?'
      params.push(type)
    }

    sql += ' ORDER BY display_name'

    const stmt = this.db.prepare(sql)
    const sources = (params.length ? stmt.all(...params) : stmt.all()) as MediaSource[]
    return sources.map(source => ({ ...source, connection_config: this.decryptMediaSourceConfig(source.connection_config) }))
  }

  /**
   * Get enabled media sources
   */
  getEnabledMediaSources(): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE is_enabled = 1 ORDER BY display_name')
    const sources = stmt.all() as MediaSource[]
    return sources.map(source => ({ ...source, connection_config: this.decryptMediaSourceConfig(source.connection_config) }))
  }

  /**
   * Get media source by ID
   */
  getMediaSource(sourceId: string): MediaSource | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE source_id = ?')
    const source = stmt.get(sourceId) as MediaSource | undefined
    if (!source) return null

    return { ...source, connection_config: this.decryptMediaSourceConfig(source.connection_config) }
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
  upsertMediaSource(source: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'>): void {
    if (!this.db) throw new Error('Database not initialized')

    // Encrypt connection config
    const encryption = getCredentialEncryptionService()
    const config = JSON.parse(source.connection_config) as Record<string, unknown>
    const encryptedConfig = JSON.stringify(encryption.encryptConnectionConfig(config))

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

  private decryptMediaSourceConfig(connectionConfig: string): string {
    const config = JSON.parse(connectionConfig) as Record<string, unknown>
    return JSON.stringify(getCredentialEncryptionService().decryptConnectionConfig(config))
  }

  /**
   * Delete media source
   */
  deleteMediaSource(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    console.log(`[BetterSQLite] Deleting source ${sourceId} and all associated data...`)

    const db = this.db
    db.transaction(() => {
      // Delete exclusions BEFORE media items (subquery needs media_items to exist)
      db.prepare(`
        DELETE FROM exclusions WHERE reference_id IN (
          SELECT CAST(id AS TEXT) FROM media_items WHERE source_id = ?
        )
      `).run(sourceId)

      // Delete wishlist items BEFORE media items (subquery needs media_items to exist)
      db.prepare(`
        DELETE FROM wishlist_items WHERE media_item_id IN (
          SELECT id FROM media_items WHERE source_id = ?
        )
      `).run(sourceId)

      // Delete media item related data (versions, quality scores, collections)
      this.deleteMediaItemsForSource(sourceId)

      // Delete music quality scores for albums from this source
      db.prepare(`
        DELETE FROM music_quality_scores WHERE album_id IN (
          SELECT id FROM music_albums WHERE source_id = ?
        )
      `).run(sourceId)

      // Delete album completeness data for albums from this source
      db.prepare(`
        DELETE FROM album_completeness WHERE album_id IN (
          SELECT id FROM music_albums WHERE source_id = ?
        )
      `).run(sourceId)

      // Delete artist completeness data for artists ONLY in this source
      // (preserve completeness for artists that exist in other sources too)
      db.prepare(`
        DELETE FROM artist_completeness WHERE artist_name IN (
          SELECT name FROM music_artists WHERE source_id = ?
        ) AND artist_name NOT IN (
          SELECT name FROM music_artists WHERE source_id != ?
        )
      `).run(sourceId, sourceId)

      // Delete music tracks, albums, artists
      db.prepare('DELETE FROM music_tracks WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM music_albums WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM music_artists WHERE source_id = ?').run(sourceId)

      // Delete completeness and scan data
      db.prepare('DELETE FROM series_completeness WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM movie_collections WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM library_scans WHERE source_id = ?').run(sourceId)

      // Clear person completeness (global, re-analyzed on demand)
      // Owned movie IDs may reference deleted items from this source
      db.prepare('DELETE FROM person_completeness').run()

      // Delete notifications for this source
      db.prepare('DELETE FROM notifications WHERE source_id = ?').run(sourceId)

      // Delete the source itself
      db.prepare('DELETE FROM media_sources WHERE source_id = ?').run(sourceId)
    })()

    console.log(`[BetterSQLite] Deleted source and all data: ${sourceId}`)
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
    upgradeMinTier: string | null
  }> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      SELECT library_id, library_name, library_type, is_enabled, last_scan_at, items_scanned, upgrade_min_tier
      FROM library_scans WHERE source_id = ?
    `)
    const rows = stmt.all(sourceId) as Array<{
      library_id: string
      library_name: string
      library_type: string
      is_enabled: number
      last_scan_at: string | null
      items_scanned: number
      upgrade_min_tier: string | null
    }>

    return rows.map(row => ({
      libraryId: row.library_id,
      libraryName: row.library_name,
      libraryType: row.library_type,
      isEnabled: row.is_enabled === 1,
      lastScanAt: row.last_scan_at,
      itemsScanned: row.items_scanned || 0,
      upgradeMinTier: row.upgrade_min_tier ?? null,
    }))
  }

  /**
   * Set or clear the per-library upgrade minimum tier.
   * Items below this tier will be flagged for upgrade regardless of quality level.
   * Pass null to revert to the default LOW-quality-only rule.
   */
  setLibraryUpgradeTier(sourceId: string, libraryId: string, minTier: string | null): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled, upgrade_min_tier)
       VALUES (?, ?, '', 'unknown', datetime('now'), 0, 1, ?)
       ON CONFLICT(source_id, library_id) DO UPDATE SET upgrade_min_tier = excluded.upgrade_min_tier`
    ).run(sourceId, libraryId, minTier)
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
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE file_path = ?')
    return (stmt.get(filePath) as MusicTrack) || null
  }

  /**
   * Upsert music track
   */
  upsertMusicTrack(track: MusicTrack): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO music_tracks (
        source_id, source_type, library_id, provider_id, album_id, artist_id,
        album_name, artist_name, title, track_number, disc_number, duration,
        file_path, file_size, container, file_mtime, audio_codec, audio_bitrate,
        sample_rate, bit_depth, channels, is_lossless, is_hi_res,
        musicbrainz_id, genres, mood, added_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        library_id = excluded.library_id,
        album_id = excluded.album_id,
        artist_id = excluded.artist_id,
        album_name = excluded.album_name,
        artist_name = excluded.artist_name,
        title = excluded.title,
        track_number = excluded.track_number,
        disc_number = excluded.disc_number,
        duration = excluded.duration,
        file_path = excluded.file_path,
        file_size = excluded.file_size,
        container = excluded.container,
        file_mtime = excluded.file_mtime,
        audio_codec = excluded.audio_codec,
        audio_bitrate = excluded.audio_bitrate,
        sample_rate = excluded.sample_rate,
        bit_depth = excluded.bit_depth,
        channels = excluded.channels,
        is_lossless = excluded.is_lossless,
        is_hi_res = excluded.is_hi_res,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_tracks.musicbrainz_id),
        genres = excluded.genres,
        mood = excluded.mood,
        updated_at = datetime('now')
    `)

    stmt.run(
      track.source_id,
      track.source_type,
      track.library_id || null,
      track.provider_id,
      track.album_id || null,
      track.artist_id || null,
      track.album_name || null,
      track.artist_name,
      track.title,
      track.track_number || null,
      track.disc_number || null,
      track.duration || null,
      track.file_path || null,
      track.file_size || null,
      track.container || null,
      track.file_mtime || null,
      track.audio_codec,
      track.audio_bitrate || null,
      track.sample_rate || null,
      track.bit_depth || null,
      track.channels || null,
      track.is_lossless ? 1 : 0,
      track.is_hi_res ? 1 : 0,
      track.musicbrainz_id || null,
      track.genres || null,
      track.mood || null,
      track.added_at || null
    )

    // Always look up by unique key — lastInsertRowid is unreliable after
    // ON CONFLICT DO UPDATE (may return stale rowid from a prior INSERT)
    const existing = this.db.prepare(
      'SELECT id FROM music_tracks WHERE source_id = ? AND provider_id = ?'
    ).get(track.source_id, track.provider_id) as { id: number } | undefined
    return existing?.id || 0
  }

  /**
   * Upsert music artist
   */
  upsertMusicArtist(artist: MusicArtist): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO music_artists (
        source_id, source_type, library_id, provider_id, name, sort_name,
        musicbrainz_id, genres, country, biography, thumb_url, art_url,
        album_count, track_count, user_fixed_match, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        library_id = excluded.library_id,
        name = excluded.name,
        sort_name = excluded.sort_name,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_artists.musicbrainz_id),
        genres = excluded.genres,
        country = excluded.country,
        biography = excluded.biography,
        thumb_url = COALESCE(excluded.thumb_url, music_artists.thumb_url),
        art_url = COALESCE(excluded.art_url, music_artists.art_url),
        album_count = excluded.album_count,
        track_count = excluded.track_count,
        user_fixed_match = CASE WHEN music_artists.user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END,
        updated_at = datetime('now')
    `)

    stmt.run(
      artist.source_id,
      artist.source_type,
      artist.library_id || null,
      artist.provider_id,
      artist.name,
      artist.sort_name || null,
      artist.musicbrainz_id || null,
      artist.genres || null,
      artist.country || null,
      artist.biography || null,
      artist.thumb_url || null,
      artist.art_url || null,
      artist.album_count || null,
      artist.track_count || null,
      artist.user_fixed_match ? 1 : 0
    )

    // Always look up by unique key — lastInsertRowid is unreliable after
    // ON CONFLICT DO UPDATE (may return stale rowid from a prior INSERT)
    const existing = this.db.prepare(
      'SELECT id FROM music_artists WHERE source_id = ? AND provider_id = ?'
    ).get(artist.source_id, artist.provider_id) as { id: number } | undefined
    return existing?.id || 0
  }

  /**
   * Upsert music album
   */
  upsertMusicAlbum(album: MusicAlbum): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO music_albums (
        source_id, source_type, library_id, provider_id, artist_id, artist_name,
        title, sort_title, year, musicbrainz_id, musicbrainz_release_group_id,
        genres, studio, album_type, track_count, total_duration, total_size,
        best_audio_codec, best_audio_bitrate, best_sample_rate, best_bit_depth,
        avg_audio_bitrate, thumb_url, art_url, release_date, added_at,
        user_fixed_match, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        library_id = excluded.library_id,
        artist_id = excluded.artist_id,
        artist_name = excluded.artist_name,
        title = excluded.title,
        sort_title = excluded.sort_title,
        year = excluded.year,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_albums.musicbrainz_id),
        musicbrainz_release_group_id = COALESCE(excluded.musicbrainz_release_group_id, music_albums.musicbrainz_release_group_id),
        genres = excluded.genres,
        studio = excluded.studio,
        album_type = excluded.album_type,
        track_count = excluded.track_count,
        total_duration = excluded.total_duration,
        total_size = excluded.total_size,
        best_audio_codec = excluded.best_audio_codec,
        best_audio_bitrate = excluded.best_audio_bitrate,
        best_sample_rate = excluded.best_sample_rate,
        best_bit_depth = excluded.best_bit_depth,
        avg_audio_bitrate = excluded.avg_audio_bitrate,
        thumb_url = COALESCE(excluded.thumb_url, music_albums.thumb_url),
        art_url = COALESCE(excluded.art_url, music_albums.art_url),
        release_date = excluded.release_date,
        user_fixed_match = CASE WHEN music_albums.user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END,
        updated_at = datetime('now')
    `)

    stmt.run(
      album.source_id,
      album.source_type,
      album.library_id || null,
      album.provider_id,
      album.artist_id || null,
      album.artist_name,
      album.title,
      album.sort_title || null,
      album.year || null,
      album.musicbrainz_id || null,
      album.musicbrainz_release_group_id || null,
      album.genres || null,
      album.studio || null,
      album.album_type || null,
      album.track_count || null,
      album.total_duration || null,
      album.total_size || null,
      album.best_audio_codec || null,
      album.best_audio_bitrate || null,
      album.best_sample_rate || null,
      album.best_bit_depth || null,
      album.avg_audio_bitrate || null,
      album.thumb_url || null,
      album.art_url || null,
      album.release_date || null,
      album.added_at || null,
      album.user_fixed_match ? 1 : 0
    )

    // Always look up by unique key to get the correct ID.
    // lastInsertRowid is unreliable after ON CONFLICT DO UPDATE — it may
    // return a stale rowid from a prior INSERT, causing tracks to link to
    // the wrong album.
    const existing = this.db.prepare(
      'SELECT id FROM music_albums WHERE source_id = ? AND provider_id = ?'
    ).get(album.source_id, album.provider_id) as { id: number } | undefined
    return existing?.id || 0
  }

  /**
   * Update music album artwork
   */
  updateMusicTrackMood(trackId: number, mood: string): void {
    this.updateMusicTrackTag(trackId, 'mood', mood)
  }

  updateMusicTrackTag(trackId: number, field: 'mood' | 'genre', value: string): void {
    if (!this.db) throw new Error('Database not initialized')
    const col = field === 'genre' ? 'genres' : 'mood'
    this.db.prepare(`UPDATE music_tracks SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).run(value, trackId)
  }

  updateMusicAlbumArtwork(albumId: number, artworkUrl: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      UPDATE music_albums SET thumb_url = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    stmt.run(artworkUrl, albumId)
  }

  /**
   * Get music artists with filters
   */
  getMusicArtists(filters?: MusicFilters): MusicArtist[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM music_artists WHERE 1=1'
    const params: unknown[] = []

    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.libraryId) {
      sql += ' AND library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.searchQuery) {
      sql += ' AND id IN (SELECT rowid FROM music_artist_fts WHERE music_artist_fts MATCH ?)'
      params.push(BetterSQLiteService.buildFtsQuery(filters.searchQuery))
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND name NOT GLOB '[A-Za-z]*'"
      } else {
        sql += ' AND UPPER(SUBSTR(name, 1, 1)) = ?'
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }

    const artistSortMap: Record<string, string> = { 'name': 'sort_name', 'title': 'sort_name', 'added_at': 'created_at' }
    const sortCol = artistSortMap[filters?.sortBy || ''] || 'sort_name'
    const sortDir = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    sql += ` ORDER BY ${sortCol} ${sortDir}, id ASC`

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MusicArtist[]
  }

  countMusicArtists(filters?: MusicFilters): number {
    if (!this.db) throw new Error('Database not initialized')
    let sql = 'SELECT COUNT(*) as count FROM music_artists WHERE 1=1'
    const params: unknown[] = []
    if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
    if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    if (filters?.searchQuery) { sql += ' AND id IN (SELECT rowid FROM music_artist_fts WHERE music_artist_fts MATCH ?)'; params.push(BetterSQLiteService.buildFtsQuery(filters.searchQuery)) }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND name NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(name, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as { count: number } | undefined
    return row?.count || 0
  }

  /**
   * Get music artist by ID
   */
  getMusicArtistById(id: number): MusicArtist | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_artists WHERE id = ?')
    return (stmt.get(id) as MusicArtist) || null
  }

  /**
   * Get music artist by name and source
   */
  getMusicArtistByName(name: string, sourceId: string): MusicArtist | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_artists WHERE name = ? AND source_id = ?')
    return (stmt.get(name, sourceId) as MusicArtist) || null
  }

  /**
   * Get music albums with filters
   */
  getMusicAlbums(filters?: MusicFilters): MusicAlbum[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM music_albums WHERE 1=1'
    const params: unknown[] = []

    if (filters?.artistId && filters?.artistName) {
      sql += ' AND (artist_id = ? OR artist_name = ?)'
      params.push(filters.artistId, filters.artistName)
    } else if (filters?.artistId) {
      sql += ' AND artist_id = ?'
      params.push(filters.artistId)
    } else if (filters?.artistName) {
      sql += ' AND artist_name = ?'
      params.push(filters.artistName)
    }
    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.libraryId) {
      sql += ' AND library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.searchQuery) {
      sql += ' AND id IN (SELECT rowid FROM music_album_fts WHERE music_album_fts MATCH ?)'
      params.push(BetterSQLiteService.buildFtsQuery(filters.searchQuery))
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND title NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(title, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }
    if (filters?.excludeAlbumTypes?.length) {
      const placeholders = filters.excludeAlbumTypes.map(() => '?').join(',')
      sql += ` AND (album_type IS NULL OR album_type NOT IN (${placeholders}))`
      params.push(...filters.excludeAlbumTypes)
    }

    const albumSortMap: Record<string, string> = { 'title': 'COALESCE(sort_title, title)', 'artist': 'artist_name', 'year': 'year', 'added_at': 'created_at' }
    const sortCol = albumSortMap[filters?.sortBy || ''] || 'artist_name'
    const sortDir = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    if (!filters?.sortBy || filters.sortBy === 'artist') {
      sql += ` ORDER BY ${sortCol} ${sortDir}, year DESC, id ASC`
    } else {
      sql += ` ORDER BY ${sortCol} ${sortDir}, id ASC`
    }

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MusicAlbum[]
  }

  countMusicAlbums(filters?: MusicFilters): number {
    if (!this.db) throw new Error('Database not initialized')
    let sql = 'SELECT COUNT(*) as count FROM music_albums WHERE 1=1'
    const params: unknown[] = []
    if (filters?.artistId && filters?.artistName) {
      sql += ' AND (artist_id = ? OR artist_name = ?)'; params.push(filters.artistId, filters.artistName)
    } else if (filters?.artistId) { sql += ' AND artist_id = ?'; params.push(filters.artistId) }
    else if (filters?.artistName) { sql += ' AND artist_name = ?'; params.push(filters.artistName) }
    if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
    if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    if (filters?.searchQuery) { sql += ' AND id IN (SELECT rowid FROM music_album_fts WHERE music_album_fts MATCH ?)'; params.push(BetterSQLiteService.buildFtsQuery(filters.searchQuery)) }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND title NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(title, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }
    if (filters?.excludeAlbumTypes?.length) {
      const placeholders = filters.excludeAlbumTypes.map(() => '?').join(',')
      sql += ` AND (album_type IS NULL OR album_type NOT IN (${placeholders}))`
      params.push(...filters.excludeAlbumTypes)
    }
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as { count: number } | undefined
    return row?.count || 0
  }

  /**
   * Get music album by ID
   */
  getMusicAlbumById(id: number): MusicAlbum | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_albums WHERE id = ?')
    return (stmt.get(id) as MusicAlbum) || null
  }

  /**
   * Get music album by name and artist
   */
  getMusicAlbumByName(title: string, artistId: number): MusicAlbum | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_albums WHERE title = ? AND artist_id = ?')
    return (stmt.get(title, artistId) as MusicAlbum) || null
  }

  /**
   * Get music albums by artist name
   */
  getMusicAlbumsByArtistName(artistName: string, limit = 500): MusicAlbum[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_albums WHERE artist_name = ? LIMIT ?')
    return stmt.all(artistName, limit) as MusicAlbum[]
  }

  /**
   * Get music tracks with filters
   */
  getMusicTracks(filters?: MusicFilters): MusicTrack[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM music_tracks WHERE 1=1'
    const params: unknown[] = []

    if (filters?.albumId) {
      sql += ' AND album_id = ?'
      params.push(filters.albumId)
    }
    if (filters?.artistId) {
      sql += ' AND artist_id = ?'
      params.push(filters.artistId)
    }
    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.searchQuery) {
      sql += ' AND id IN (SELECT rowid FROM music_track_fts WHERE music_track_fts MATCH ?)'
      params.push(BetterSQLiteService.buildFtsQuery(filters.searchQuery))
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND title NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(title, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }
        if (filters?.hasTagField) {
      const col = filters.hasTagField === 'genre' ? 'genres' : 'mood'
      sql += ` AND ${col} IS NOT NULL AND ${col} != '' AND ${col} != '[]'`
    }

    const trackSortMap: Record<string, string> = { 'title': 'title', 'artist': 'artist_name', 'album': 'album_name', 'codec': 'audio_codec', 'duration': 'duration', 'added_at': 'created_at' }
    if (filters?.sortBy && trackSortMap[filters.sortBy]) {
      const sortCol = trackSortMap[filters.sortBy]
      const sortDir = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
      sql += ` ORDER BY ${sortCol} ${sortDir}, id ASC`
    } else if (filters?.albumId) {
      sql += ' ORDER BY disc_number ASC, track_number ASC, id ASC'
    } else {
      sql += ' ORDER BY title ASC, id ASC'
    }

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MusicTrack[]
  }

  /**
   * Batch fetch tracks for multiple album IDs in a single query
   * Returns Map of album_id → MusicTrack[]
   */
  getMusicTracksByAlbumIds(albumIds: number[]): Map<number, MusicTrack[]> {
    if (!this.db) throw new Error('Database not initialized')
    const result = new Map<number, MusicTrack[]>()
    if (albumIds.length === 0) return result

    const placeholders = albumIds.map(() => '?').join(',')
    const stmt = this.db.prepare(
      `SELECT * FROM music_tracks WHERE album_id IN (${placeholders}) ORDER BY album_id, disc_number ASC, track_number ASC`
    )
    const rows = stmt.all(...albumIds) as MusicTrack[]

    for (const track of rows) {
      if (track.album_id) {
        const list = result.get(track.album_id)
        if (list) list.push(track)
        else result.set(track.album_id, [track])
      }
    }
    return result
  }

  countMusicTracks(filters?: MusicFilters): number {
    if (!this.db) throw new Error('Database not initialized')
    let sql = 'SELECT COUNT(*) as count FROM music_tracks WHERE 1=1'
    const params: unknown[] = []
    if (filters?.albumId) { sql += ' AND album_id = ?'; params.push(filters.albumId) }
    if (filters?.artistId) { sql += ' AND artist_id = ?'; params.push(filters.artistId) }
    if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
    if (filters?.searchQuery) { sql += ' AND id IN (SELECT rowid FROM music_track_fts WHERE music_track_fts MATCH ?)'; params.push(BetterSQLiteService.buildFtsQuery(filters.searchQuery)) }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND title NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(title, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }
        if (filters?.hasTagField) {
      const col = filters.hasTagField === 'genre' ? 'genres' : 'mood'
      sql += ` AND ${col} IS NOT NULL AND ${col} != '' AND ${col} != '[]'`
    }
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as { count: number } | undefined
    return row?.count || 0
  }

  /**
   * Get music track by ID
   */
  getMusicTrackById(id: number): MusicTrack | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE id = ?')
    return (stmt.get(id) as MusicTrack) || null
  }

  /**
   * Delete music track
   */
  deleteMusicTrack(id: number): void {
    if (!this.db) throw new Error('Database not initialized')

    const db = this.db
    const track = db.prepare(
      'SELECT id, title, album_id, artist_id, track_number, musicbrainz_id FROM music_tracks WHERE id = ?'
    ).get(id) as { id: number; title: string; album_id?: number; artist_id?: number; track_number?: number; musicbrainz_id?: string } | undefined

    const txn = db.transaction(() => {
    db.prepare('DELETE FROM music_tracks WHERE id = ?').run(id)

    if (track?.album_id) {
      const albumTrackCount = db.prepare(
        'SELECT COUNT(*) as cnt FROM music_tracks WHERE album_id = ?'
      ).get(track.album_id) as { cnt: number }
      if (albumTrackCount.cnt === 0) {
        // Album is now empty — add it to artist's missing_albums before deleting
        const album = db.prepare(
          'SELECT title, artist_name, musicbrainz_id FROM music_albums WHERE id = ?'
        ).get(track.album_id) as { title: string; artist_name: string; musicbrainz_id?: string } | undefined
        if (album) {
          const acRow = db.prepare(
            'SELECT id, missing_albums, owned_albums, total_albums, completeness_percentage FROM artist_completeness WHERE artist_name = ?'
          ).get(album.artist_name) as { id: number; missing_albums: string; owned_albums: number; total_albums: number; completeness_percentage: number } | undefined
          if (acRow) {
            const missingAlbums: Array<{ musicbrainz_id: string; title: string; year?: number; album_type?: string }> =
              JSON.parse(acRow.missing_albums || '[]')
            const alreadyMissing = missingAlbums.some(
              a => (album.musicbrainz_id && a.musicbrainz_id === album.musicbrainz_id) ||
                   a.title.toLowerCase() === album.title.toLowerCase()
            )
            if (!alreadyMissing) {
              missingAlbums.push({
                musicbrainz_id: album.musicbrainz_id || '',
                title: album.title,
              })
            }
            const newOwned = Math.max(0, acRow.owned_albums - 1)
            const newPct = acRow.total_albums > 0 ? Math.round((newOwned / acRow.total_albums) * 100) : 0
            db.prepare(
              'UPDATE artist_completeness SET missing_albums = ?, owned_albums = ?, completeness_percentage = ?, updated_at = datetime(\'now\') WHERE id = ?'
            ).run(JSON.stringify(missingAlbums), newOwned, newPct, acRow.id)
          }
        }

        db.prepare('DELETE FROM music_quality_scores WHERE album_id = ?').run(track.album_id)
        db.prepare('DELETE FROM album_completeness WHERE album_id = ?').run(track.album_id)
        db.prepare('DELETE FROM music_albums WHERE id = ?').run(track.album_id)
      } else {
        db.prepare(
          'UPDATE music_albums SET track_count = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(albumTrackCount.cnt, track.album_id)

        // Update album_completeness: add deleted track to missing_tracks
        const acAlbum = db.prepare(
          'SELECT id, missing_tracks, owned_tracks, total_tracks FROM album_completeness WHERE album_id = ?'
        ).get(track.album_id) as { id: number; missing_tracks: string; owned_tracks: number; total_tracks: number } | undefined
        if (acAlbum) {
          const missingTracks: Array<{ musicbrainz_id?: string; title: string; track_number?: number }> =
            JSON.parse(acAlbum.missing_tracks || '[]')
          const alreadyMissing = missingTracks.some(
            t => t.title.toLowerCase() === track.title.toLowerCase()
          )
          if (!alreadyMissing) {
            missingTracks.push({
              musicbrainz_id: track.musicbrainz_id || undefined,
              title: track.title,
              track_number: track.track_number || undefined,
            })
            missingTracks.sort((a, b) => (a.track_number || 0) - (b.track_number || 0))
          }
          const newOwned = Math.max(0, acAlbum.owned_tracks - 1)
          const newPct = acAlbum.total_tracks > 0 ? Math.round((newOwned / acAlbum.total_tracks) * 100) : 0
          db.prepare(
            'UPDATE album_completeness SET missing_tracks = ?, owned_tracks = ?, completeness_percentage = ?, updated_at = datetime(\'now\') WHERE id = ?'
          ).run(JSON.stringify(missingTracks), newOwned, newPct, acAlbum.id)
        }
      }
    }

    if (track?.artist_id) {
      const artistTrackCount = db.prepare(
        'SELECT COUNT(*) as cnt FROM music_tracks WHERE artist_id = ?'
      ).get(track.artist_id) as { cnt: number }
      if (artistTrackCount.cnt === 0) {
        const artist = db.prepare('SELECT name FROM music_artists WHERE id = ?').get(track.artist_id) as { name: string } | undefined
        if (artist) {
          db.prepare('DELETE FROM artist_completeness WHERE artist_name = ?').run(artist.name)
        }
        db.prepare('DELETE FROM music_artists WHERE id = ?').run(track.artist_id)
      } else {
        const albumCount = db.prepare(
          'SELECT COUNT(DISTINCT album_id) as cnt FROM music_tracks WHERE artist_id = ? AND album_id IS NOT NULL'
        ).get(track.artist_id) as { cnt: number }
        db.prepare(
          'UPDATE music_artists SET track_count = ?, album_count = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(artistTrackCount.cnt, albumCount.cnt, track.artist_id)
      }
    }
    })

    txn()
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

  /**
   * Update music artist counts
   */
  updateMusicArtistCounts(artistId: number, albumCount: number, trackCount: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(`
      UPDATE music_artists SET album_count = ?, track_count = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(albumCount, trackCount, artistId)
  }

  /**
   * Update music artist artwork
   */
  updateMusicArtistArtwork(
    sourceId: string,
    providerId: string,
    artwork: { thumbUrl?: string; artUrl?: string }
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const updates: string[] = []
    const params: unknown[] = []

    if (artwork.thumbUrl !== undefined) {
      updates.push('thumb_url = ?')
      params.push(artwork.thumbUrl)
    }
    if (artwork.artUrl !== undefined) {
      updates.push('art_url = ?')
      params.push(artwork.artUrl)
    }

    if (updates.length === 0) return

    updates.push("updated_at = datetime('now')")
    params.push(sourceId, providerId)

    const sql = `UPDATE music_artists SET ${updates.join(', ')} WHERE source_id = ? AND provider_id = ?`
    this.db.prepare(sql).run(...params)
  }

  /**
   * Update music artist MusicBrainz ID
   */
  updateMusicArtistMbid(artistId: number, musicbrainzId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(`
      UPDATE music_artists SET musicbrainz_id = ?, updated_at = datetime('now')
      WHERE id = ? AND (user_fixed_match IS NULL OR user_fixed_match = 0)
    `).run(musicbrainzId, artistId)
  }

  /**
   * Update music album MusicBrainz ID
   */
  updateMusicAlbumMbid(albumId: number, musicbrainzId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(`
      UPDATE music_albums SET musicbrainz_id = ?, updated_at = datetime('now')
      WHERE id = ? AND (user_fixed_match IS NULL OR user_fixed_match = 0)
    `).run(musicbrainzId, albumId)
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
    const seriesIdentityKey = (data as any).series_identity_key || deriveSeriesIdentityKey({
      sourceId,
      libraryId,
      folderRelativePath: data.series_title,
      tmdbId: data.tmdb_id,
      tvdbId: (data as any).tvdb_id,
    })

    // Check if record exists by canonical series identity key
    const stmt = this.db.prepare(
      'SELECT id FROM series_completeness WHERE series_identity_key = ? AND source_id = ? AND library_id = ?'
    )
    const row = stmt.get(seriesIdentityKey, sourceId, libraryId) as { id: number } | undefined
    const existingId = row?.id || null

    if (existingId !== null) {
      this.db.prepare(`
        UPDATE series_completeness SET
          series_identity_key = ?, series_title = ?,
          total_seasons = ?, total_episodes = ?, owned_seasons = ?, owned_episodes = ?,
          missing_seasons = ?, missing_episodes = ?, completeness_percentage = ?,
          tmdb_id = ?, poster_url = ?, backdrop_url = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        seriesIdentityKey, data.series_title,
        data.total_seasons, data.total_episodes, data.owned_seasons, data.owned_episodes,
        JSON.stringify(data.missing_seasons), JSON.stringify(data.missing_episodes),
        data.completeness_percentage,
        data.tmdb_id || null, data.poster_url || null, data.backdrop_url || null,
        data.status || null, existingId
      )
      return existingId
    }

    this.db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes,
        completeness_percentage, tmdb_id, poster_url, backdrop_url, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      seriesIdentityKey, data.series_title, sourceId, libraryId, data.total_seasons, data.total_episodes,
      data.owned_seasons, data.owned_episodes,
      JSON.stringify(data.missing_seasons), JSON.stringify(data.missing_episodes),
      data.completeness_percentage, data.tmdb_id || null, data.poster_url || null,
      data.backdrop_url || null, data.status || null
    )

    // Look up by unique identity key
    const inserted = this.db.prepare(
      'SELECT id FROM series_completeness WHERE series_identity_key = ? AND source_id = ? AND library_id = ?'
    ).get(seriesIdentityKey, sourceId, libraryId) as { id: number } | undefined
    return inserted?.id || 0
  }

  // Parse JSON blob columns from raw SQLite row into typed arrays
  private static parseSeriesRow(row: SeriesCompleteness): SeriesCompleteness {
    return {
      ...row,
      missing_seasons: Array.isArray(row.missing_seasons)
        ? row.missing_seasons
        : JSON.parse((row.missing_seasons as unknown as string) || '[]'),
      missing_episodes: Array.isArray(row.missing_episodes)
        ? row.missing_episodes
        : JSON.parse((row.missing_episodes as unknown as string) || '[]'),
    }
  }

  private static parseCollectionRow(row: MovieCollection): MovieCollection {
    return {
      ...row,
      missing_movies: Array.isArray(row.missing_movies)
        ? row.missing_movies
        : JSON.parse((row.missing_movies as unknown as string) || '[]'),
      owned_movie_ids: Array.isArray(row.owned_movie_ids)
        ? row.owned_movie_ids
        : JSON.parse((row.owned_movie_ids as unknown as string) || '[]'),
    }
  }

  /**
   * Get series completeness (deduplicated by series_identity_key)
   */
  getSeriesCompleteness(sourceId?: string): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    const sourceFilter = sourceId ? ' AND sc2.source_id = ?' : ''
    const outerSourceFilter = sourceId ? ' AND sc.source_id = ?' : ''
    const params: unknown[] = sourceId ? [sourceId] : []

    const stmt = this.db.prepare(`
      SELECT sc.*
      FROM series_completeness sc
      LEFT JOIN library_scans ls ON sc.source_id = ls.source_id AND sc.library_id = ls.library_id
      INNER JOIN (
        SELECT COALESCE(sc2.series_identity_key, sc2.series_title) as identity_key, MAX(sc2.completeness_percentage) as max_pct
        FROM series_completeness sc2
        LEFT JOIN library_scans ls2 ON sc2.source_id = ls2.source_id AND sc2.library_id = ls2.library_id
        WHERE (ls2.is_enabled = 1 OR ls2.is_enabled IS NULL)${sourceFilter}
        GROUP BY COALESCE(sc2.series_identity_key, sc2.series_title)
      ) best ON COALESCE(sc.series_identity_key, sc.series_title) = best.identity_key AND sc.completeness_percentage = best.max_pct
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)${outerSourceFilter}
      GROUP BY COALESCE(sc.series_identity_key, sc.series_title)
      ORDER BY sc.series_title ASC
    `)
    const allParams = sourceId ? [...params, ...params] : []
    return (stmt.all(...allParams) as SeriesCompleteness[]).map(BetterSQLiteService.parseSeriesRow)
  }

  /**
   * Get series completeness by identity key
   */
  getSeriesCompletenessByIdentity(
    seriesIdentityKey: string,
    sourceId?: string,
    libraryId?: string
  ): SeriesCompleteness | null {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM series_completeness WHERE series_identity_key = ?'
    const params: unknown[] = [seriesIdentityKey]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    const stmt = this.db.prepare(sql)
    const row = (stmt.get(...params) as SeriesCompleteness) || null
    return row ? BetterSQLiteService.parseSeriesRow(row) : null
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
    return (stmt.all(...params) as SeriesCompleteness[]).map(BetterSQLiteService.parseSeriesRow)
  }

  /**
   * Get incomplete series (completeness < 100%)
   * @param sourceId Optional source ID to filter by
   */
  getIncompleteSeries(sourceId?: string): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    const subqueryFilter = sourceId ? ' AND sc2.source_id = ?' : ''
    const outerFilter = sourceId ? ' AND sc.source_id = ?' : ''
    const params: unknown[] = sourceId ? [sourceId] : []

    const stmt = this.db.prepare(`
      SELECT sc.*
      FROM series_completeness sc
      LEFT JOIN library_scans ls ON sc.source_id = ls.source_id AND sc.library_id = ls.library_id
      INNER JOIN (
        SELECT sc2.series_title, MAX(sc2.completeness_percentage) as max_pct
        FROM series_completeness sc2
        WHERE sc2.tmdb_id IS NOT NULL${subqueryFilter}
        GROUP BY sc2.series_title
        HAVING max_pct < 100
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE sc.tmdb_id IS NOT NULL${outerFilter}
        AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      GROUP BY sc.series_title
      ORDER BY sc.completeness_percentage ASC
    `)
    const allParams = sourceId ? [...params, ...params] : []
    return (stmt.all(...allParams) as SeriesCompleteness[]).map(BetterSQLiteService.parseSeriesRow)
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
        MAX(m.series_tmdb_id) as tmdb_id,
        MIN(m.source_id) as source_id,
        MIN(m.source_type) as source_type,
        MIN(m.library_id) as library_id,
        COALESCE(m.series_identity_key, MIN(m.series_identity_key)) as series_identity_key,
        COALESCE(SUM(m.file_size_bytes), 0) as total_size_bytes,
        COALESCE(SUM(m.play_count), 0) as total_play_count,
        MAX(m.last_watched_at) as last_watched_at,
        SUM(q.estimated_savings_bytes) as estimated_savings_bytes,
        CASE
          WHEN COUNT(q.estimated_savings_bytes) = 0 THEN 'insufficient'
          WHEN SUM(CASE WHEN q.estimated_savings_bytes IS NULL OR q.savings_coverage IS NULL OR q.savings_coverage != 'complete' THEN 1 ELSE 0 END) > 0 THEN 'partial'
          ELSE 'complete'
        END as savings_coverage
      FROM media_items m
      LEFT JOIN quality_scores q ON q.media_item_id = m.id
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
      sql += ' AND m.id IN (SELECT rowid FROM media_fts WHERE media_fts MATCH ?)'
      params.push(`series_title : ${BetterSQLiteService.buildFtsQuery(filters.searchQuery)}`)
    }

    sql += ' GROUP BY m.series_identity_key, m.source_id, m.library_id'

    // Sorting
    const sortOrder = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    switch (filters?.sortBy) {
      case 'episode_count':
        sql += ` ORDER BY episode_count ${sortOrder}, COALESCE(sort_title, series_title) ASC`
        break
      case 'season_count':
        sql += ` ORDER BY season_count ${sortOrder}, COALESCE(sort_title, series_title) ASC`
        break
      case 'play_count':
        sql += ` ORDER BY total_play_count ${sortOrder}, COALESCE(sort_title, series_title) ASC`
        break
      case 'last_watched_at':
        sql += ` ORDER BY last_watched_at IS NULL ASC, last_watched_at ${sortOrder}, COALESCE(sort_title, series_title) ASC`
        break
      case 'estimated_savings_bytes':
        sql += ` ORDER BY COALESCE(SUM(q.estimated_savings_bytes), 0) ${sortOrder}, COALESCE(sort_title, series_title) ASC`
        break
      case 'total_size_bytes':
        sql += ` ORDER BY total_size_bytes ${sortOrder}, COALESCE(sort_title, series_title) ASC`
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
      SELECT COUNT(DISTINCT COALESCE(m.series_identity_key, m.series_title) || ':' || COALESCE(m.source_id, '') || ':' || COALESCE(m.library_id, '')) as count
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
      sql += ' AND m.id IN (SELECT rowid FROM media_fts WHERE media_fts MATCH ?)'
      params.push(`series_title : ${BetterSQLiteService.buildFtsQuery(filters.searchQuery)}`)
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
      sql += ' AND m.id IN (SELECT rowid FROM media_fts WHERE media_fts MATCH ?)'
      params.push(`series_title : ${BetterSQLiteService.buildFtsQuery(filters.searchQuery)}`)
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
      SELECT sc.series_title, MAX(sc.completeness_percentage) as best_completeness, sc.tmdb_id
      FROM series_completeness sc
      LEFT JOIN library_scans ls ON sc.source_id = ls.source_id AND sc.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      GROUP BY sc.series_title
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
      LEFT JOIN library_scans ls ON sc.source_id = ls.source_id AND sc.library_id = ls.library_id
      INNER JOIN (
        SELECT sc2.series_title, MAX(sc2.completeness_percentage) as max_pct
        FROM series_completeness sc2
        LEFT JOIN library_scans ls2 ON sc2.source_id = ls2.source_id AND sc2.library_id = ls2.library_id
        WHERE sc2.tmdb_id IS NOT NULL AND (ls2.is_enabled = 1 OR ls2.is_enabled IS NULL)
        GROUP BY sc2.series_title
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE sc.tmdb_id IS NOT NULL AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
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
          collection_name = ?, total_movies = ?, owned_movies = ?,
          missing_movies = ?, owned_movie_ids = ?, completeness_percentage = ?,
          poster_url = COALESCE(?, poster_url), backdrop_url = COALESCE(?, backdrop_url), updated_at = datetime('now')
        WHERE id = ?
      `).run(
        data.collection_name, data.total_movies, data.owned_movies,
        JSON.stringify(data.missing_movies), JSON.stringify(data.owned_movie_ids),
        data.completeness_percentage,
        data.poster_url || null, data.backdrop_url || null, existingId
      )
      return existingId
    }

    this.db.prepare(`
      INSERT INTO movie_collections (
        tmdb_collection_id, collection_name, source_id, library_id,
        total_movies, owned_movies, missing_movies, owned_movie_ids,
        completeness_percentage, poster_url, backdrop_url,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      data.tmdb_collection_id, data.collection_name, sourceId, libraryId,
      data.total_movies, data.owned_movies,
      JSON.stringify(data.missing_movies), JSON.stringify(data.owned_movie_ids),
      data.completeness_percentage, data.poster_url || null, data.backdrop_url || null
    )

    // Look up by unique key — lastInsertRowid is unreliable after ON CONFLICT DO UPDATE
    const inserted = this.db.prepare(
      'SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id = ?'
    ).get(data.tmdb_collection_id, sourceId, libraryId) as { id: number } | undefined
    return inserted?.id || 0
  }

  /**
   * Get all movie collections
   */
  getMovieCollections(sourceId?: string): MovieCollection[] {
    if (!this.db) throw new Error('Database not initialized')
    if (sourceId) {
      const stmt = this.db.prepare(`
        SELECT mc.* FROM movie_collections mc
        LEFT JOIN library_scans ls ON mc.source_id = ls.source_id AND mc.library_id = ls.library_id
        WHERE mc.source_id = ? AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        ORDER BY mc.collection_name ASC
      `)
      return (stmt.all(sourceId) as MovieCollection[]).map(BetterSQLiteService.parseCollectionRow)
    }
    const stmt = this.db.prepare(`
      SELECT mc.* FROM movie_collections mc
      LEFT JOIN library_scans ls ON mc.source_id = ls.source_id AND mc.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ORDER BY mc.collection_name ASC
    `)
    return (stmt.all() as MovieCollection[]).map(BetterSQLiteService.parseCollectionRow)
  }

  /**
   * Get movie collection by TMDB ID
   */
  getMovieCollectionByTmdbId(tmdbCollectionId: string): MovieCollection | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM movie_collections WHERE tmdb_collection_id = ?')
    const row = (stmt.get(tmdbCollectionId) as MovieCollection) || null
    return row ? BetterSQLiteService.parseCollectionRow(row) : null
  }

  /**
   * Get incomplete movie collections
   * @param sourceId Optional source ID to filter by
   */
  getIncompleteMovieCollections(sourceId?: string): MovieCollection[] {
    if (!this.db) throw new Error('Database not initialized')

    if (sourceId) {
      const stmt = this.db.prepare(`
        SELECT mc.* FROM movie_collections mc
        LEFT JOIN library_scans ls ON mc.source_id = ls.source_id AND mc.library_id = ls.library_id
        WHERE mc.completeness_percentage < 100 AND mc.source_id = ?
          AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        ORDER BY mc.completeness_percentage ASC
      `)
      return (stmt.all(sourceId) as MovieCollection[]).map(BetterSQLiteService.parseCollectionRow)
    }

    const stmt = this.db.prepare(`
      SELECT mc.* FROM movie_collections mc
      LEFT JOIN library_scans ls ON mc.source_id = ls.source_id AND mc.library_id = ls.library_id
      WHERE mc.completeness_percentage < 100
        AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ORDER BY mc.completeness_percentage ASC
    `)
    return (stmt.all() as MovieCollection[]).map(BetterSQLiteService.parseCollectionRow)
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
      console.log(`[BetterSQLite] Cleared movie collections for source ${sourceId}`)
    } else {
      this.db.prepare('DELETE FROM movie_collections').run()
      console.log('[BetterSQLite] Cleared all movie collections')
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
      console.log(`[BetterSQLite] Deleted ${count} single-movie collections`)
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

    const enabledFilter = `
      FROM movie_collections mc
      LEFT JOIN library_scans ls ON mc.source_id = ls.source_id AND mc.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
    `

    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count ${enabledFilter}`)
    const total = (totalStmt.get() as { count: number }).count

    const completeStmt = this.db.prepare(
      `SELECT COUNT(*) as count ${enabledFilter} AND mc.completeness_percentage = 100`
    )
    const complete = (completeStmt.get() as { count: number }).count

    const incompleteStmt = this.db.prepare(
      `SELECT COUNT(*) as count ${enabledFilter} AND mc.completeness_percentage < 100`
    )
    const incomplete = (incompleteStmt.get() as { count: number }).count

    const missingStmt = this.db.prepare(
      `SELECT SUM(json_array_length(mc.missing_movies)) as count ${enabledFilter} AND mc.missing_movies IS NOT NULL`
    )
    const totalMissing = (missingStmt.get() as { count: number | null }).count || 0

    const avgStmt = this.db.prepare(`SELECT AVG(mc.completeness_percentage) as avg ${enabledFilter}`)
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

    // Check existing tier to detect upgrades
    const existing = this.db.prepare(
      'SELECT quality_tier, previous_quality_tier, upgraded_at FROM music_quality_scores WHERE album_id = ?'
    ).get(score.album_id) as { quality_tier: string; previous_quality_tier: string | null; upgraded_at: string | null } | undefined

    let prevTier: string | null = null
    let upgradedAt: string | null = null

    if (existing) {
      const oldRank = BetterSQLiteService.MUSIC_TIER_RANK[existing.quality_tier] ?? 0
      const newRank = BetterSQLiteService.MUSIC_TIER_RANK[score.quality_tier] ?? 0
      if (newRank > oldRank) {
        prevTier = existing.quality_tier
        upgradedAt = new Date().toISOString()
      } else {
        prevTier = existing.previous_quality_tier
        upgradedAt = existing.upgraded_at
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO music_quality_scores (
        album_id, quality_tier, tier_quality, tier_score,
        codec_score, bitrate_score, needs_upgrade, issues,
        previous_quality_tier, upgraded_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(album_id) DO UPDATE SET
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        codec_score = excluded.codec_score,
        bitrate_score = excluded.bitrate_score,
        needs_upgrade = excluded.needs_upgrade,
        issues = excluded.issues,
        previous_quality_tier = excluded.previous_quality_tier,
        upgraded_at = excluded.upgraded_at,
        updated_at = datetime('now')
    `)
    stmt.run(
      score.album_id, score.quality_tier, score.tier_quality, score.tier_score,
      score.codec_score, score.bitrate_score, score.needs_upgrade ? 1 : 0, score.issues,
      prevTier, upgradedAt
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
      SELECT a.*, q.quality_tier, q.tier_quality, q.tier_score FROM music_albums a
      INNER JOIN music_quality_scores q ON a.id = q.album_id
      LEFT JOIN library_scans ls ON a.source_id = ls.source_id AND a.library_id = ls.library_id
      WHERE q.needs_upgrade = 1
        AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
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
        artist_name, musicbrainz_id, total_albums, owned_albums,
        total_singles, owned_singles, total_eps, owned_eps,
        missing_albums, missing_singles, missing_eps,
        completeness_percentage, country, active_years, artist_type,
        thumb_url, last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(artist_name) DO UPDATE SET
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, artist_completeness.musicbrainz_id),
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
      data.artist_name, data.musicbrainz_id || null, data.total_albums, data.owned_albums,
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
      const stmt = this.db.prepare(`
        SELECT DISTINCT ac.*, ma.thumb_url
        FROM artist_completeness ac
        INNER JOIN music_artists ma ON ac.artist_name = ma.name AND ma.source_id = ?
        LEFT JOIN library_scans ls ON ma.source_id = ls.source_id AND ma.library_id = ls.library_id
        WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
        ORDER BY ac.artist_name ASC
      `)
      return stmt.all(sourceId) as ArtistCompleteness[]
    }

    const stmt = this.db.prepare(`
      SELECT DISTINCT ac.*, ma.thumb_url
      FROM artist_completeness ac
      LEFT JOIN music_artists ma ON ac.artist_name = ma.name
      LEFT JOIN library_scans ls ON ma.source_id = ls.source_id AND ma.library_id = ls.library_id
      WHERE (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ORDER BY ac.artist_name ASC
    `)
    return stmt.all() as ArtistCompleteness[]
  }

  /**
   * Sync artist completeness after a scan by removing newly-owned albums
   * from missing_albums/missing_eps/missing_singles JSON lists.
   * No MusicBrainz API calls needed — works entirely from local data.
   * @returns Number of artists updated
   */
  syncArtistCompletenessAfterScan(sourceId: string): number {
    if (!this.db) throw new Error('Database not initialized')

    // Get all artists with completeness records that have items in this source
    const artists = this.db.prepare(`
      SELECT DISTINCT ac.id, ac.artist_name, ac.missing_albums, ac.missing_singles, ac.missing_eps,
        ac.owned_albums, ac.owned_singles, ac.owned_eps,
        ac.total_albums, ac.total_singles, ac.total_eps
      FROM artist_completeness ac
      INNER JOIN music_artists ma ON ac.artist_name = ma.name AND ma.source_id = ?
    `).all(sourceId) as Array<{
      id: number; artist_name: string
      missing_albums: string; missing_singles: string; missing_eps: string
      owned_albums: number; owned_singles: number; owned_eps: number
      total_albums: number; total_singles: number; total_eps: number
    }>

    let updated = 0

    for (const ac of artists) {
      // Get current owned album titles and MusicBrainz IDs for this artist
      const ownedAlbums = this.db.prepare(`
        SELECT title, musicbrainz_id FROM music_albums
        WHERE artist_name = ? AND source_id = ?
      `).all(ac.artist_name, sourceId) as Array<{ title: string; musicbrainz_id?: string }>

      const ownedTitlesLower = new Set(ownedAlbums.map(a => a.title.toLowerCase()))
      const ownedMbIds = new Set(ownedAlbums.filter(a => a.musicbrainz_id).map(a => a.musicbrainz_id!))

      let changed = false

      // Filter missing_albums — remove entries that are now owned
      const missingAlbums: Array<{ musicbrainz_id: string; title: string }> = JSON.parse(ac.missing_albums || '[]')
      const filteredAlbums = missingAlbums.filter(m => {
        if (m.musicbrainz_id && ownedMbIds.has(m.musicbrainz_id)) return false
        if (ownedTitlesLower.has(m.title.toLowerCase())) return false
        return true
      })
      if (filteredAlbums.length !== missingAlbums.length) changed = true

      // Filter missing_singles
      const missingSingles: Array<{ musicbrainz_id: string; title: string }> = JSON.parse(ac.missing_singles || '[]')
      const filteredSingles = missingSingles.filter(m => {
        if (m.musicbrainz_id && ownedMbIds.has(m.musicbrainz_id)) return false
        if (ownedTitlesLower.has(m.title.toLowerCase())) return false
        return true
      })
      if (filteredSingles.length !== missingSingles.length) changed = true

      // Filter missing_eps
      const missingEps: Array<{ musicbrainz_id: string; title: string }> = JSON.parse(ac.missing_eps || '[]')
      const filteredEps = missingEps.filter(m => {
        if (m.musicbrainz_id && ownedMbIds.has(m.musicbrainz_id)) return false
        if (ownedTitlesLower.has(m.title.toLowerCase())) return false
        return true
      })
      if (filteredEps.length !== missingEps.length) changed = true

      // Also check if actual owned album count changed
      const actualOwnedAlbums = ownedAlbums.length
      const countChanged = actualOwnedAlbums !== ac.owned_albums

      if (changed || countChanged) {
        // Use actual owned count from DB; derive singles/eps from missing list since we can't distinguish types from music_albums
        const newOwnedAlbums = ac.total_albums - filteredAlbums.length
        const newOwnedSingles = ac.total_singles - filteredSingles.length
        const newOwnedEps = ac.total_eps - filteredEps.length
        // Weighted: albums 3x, EPs 2x, singles 1x
        const totalWeighted = ac.total_albums * 3 + ac.total_eps * 2 + ac.total_singles
        const ownedWeighted = newOwnedAlbums * 3 + newOwnedEps * 2 + newOwnedSingles
        const newPct = totalWeighted > 0 ? Math.round((ownedWeighted / totalWeighted) * 100) : 0

        this.db.prepare(`
          UPDATE artist_completeness SET
            missing_albums = ?, missing_singles = ?, missing_eps = ?,
            owned_albums = ?, owned_singles = ?, owned_eps = ?,
            completeness_percentage = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(
          JSON.stringify(filteredAlbums), JSON.stringify(filteredSingles), JSON.stringify(filteredEps),
          newOwnedAlbums, newOwnedSingles, newOwnedEps,
          newPct, ac.id
        )
        updated++
      }
    }

    return updated
  }

  /**
   * Sync album completeness after a scan by removing newly-owned tracks
   * from missing_tracks JSON lists.
   * No MusicBrainz API calls needed — works entirely from local data.
   * @returns Number of albums updated
   */
  syncAlbumCompletenessAfterScan(sourceId: string): number {
    if (!this.db) throw new Error('Database not initialized')

    // Get all album_completeness records for albums in this source
    const records = this.db.prepare(`
      SELECT ac.id, ac.album_id, ac.missing_tracks, ac.owned_tracks, ac.total_tracks
      FROM album_completeness ac
      INNER JOIN music_albums ma ON ac.album_id = ma.id AND ma.source_id = ?
    `).all(sourceId) as Array<{
      id: number; album_id: number; missing_tracks: string; owned_tracks: number; total_tracks: number
    }>

    let updated = 0

    for (const ac of records) {
      // Get actual track count and titles for this album
      const ownedTracks = this.db.prepare(
        'SELECT title, musicbrainz_id FROM music_tracks WHERE album_id = ?'
      ).all(ac.album_id) as Array<{ title: string; musicbrainz_id?: string }>

      const actualOwnedCount = ownedTracks.length
      const ownedTitlesLower = new Set(ownedTracks.map(t => t.title.toLowerCase()))
      const ownedMbIds = new Set(ownedTracks.filter(t => t.musicbrainz_id).map(t => t.musicbrainz_id!))

      // Remove tracks from missing list that are now owned
      const missingTracks: Array<{ musicbrainz_id?: string; title: string; track_number?: number }> =
        JSON.parse(ac.missing_tracks || '[]')

      const filteredTracks = missingTracks.filter(m => {
        if (m.musicbrainz_id && ownedMbIds.has(m.musicbrainz_id)) return false
        if (ownedTitlesLower.has(m.title.toLowerCase())) return false
        return true
      })

      // Update if owned count changed OR missing list changed
      const missingChanged = filteredTracks.length !== missingTracks.length
      const countChanged = actualOwnedCount !== ac.owned_tracks

      if (missingChanged || countChanged) {
        const newPct = ac.total_tracks > 0 ? Math.round((actualOwnedCount / ac.total_tracks) * 100) : 0

        this.db.prepare(
          'UPDATE album_completeness SET missing_tracks = ?, owned_tracks = ?, completeness_percentage = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(JSON.stringify(filteredTracks), actualOwnedCount, newPct, ac.id)
        updated++
      }
    }

    return updated
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

    // Skip if already exists (same logic as addWishlistItemsBulk)
    if (item.tmdb_id && this.wishlistItemExists(item.tmdb_id)) return -1
    if (item.musicbrainz_id && this.wishlistItemExists(undefined, item.musicbrainz_id)) return -1
    if (item.media_item_id && this.wishlistItemExists(undefined, undefined, item.media_item_id)) return -1

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

  setSeriesOriginalLanguage(tmdbId: string, language: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(`
      UPDATE media_items
      SET original_language = ?, updated_at = datetime('now')
      WHERE type = 'episode' AND series_tmdb_id = ?
        AND (original_language IS NULL OR original_language = '')
    `).run(language, tmdbId)
  }

  /**
   * Update series match (TMDB ID) for all episodes of a series
   */
  updateSeriesMatch(
    seriesIdentityKey: string,
    sourceId: string,
    libraryId: string | null | undefined,
    tmdbId: string,
    posterUrl?: string,
    newSeriesTitle?: string,
    originalLanguage?: string
  ): number {
    if (!this.db) throw new Error('Database not initialized')
    if (!seriesIdentityKey || seriesIdentityKey.trim() === '') {
      throw new Error('seriesIdentityKey is required to update series match')
    }
    if (!sourceId || sourceId.trim() === '') {
      throw new Error('sourceId is required to update series match')
    }
    if (!tmdbId || tmdbId.trim() === '') {
      throw new Error('tmdbId is required to update series match')
    }

    const cleanLibraryId = (typeof libraryId === 'string' && libraryId.trim() !== '') ? libraryId.trim() : null
    const newIdentityKey = `tmdb:${tmdbId}`

    return this.db.transaction(() => {
      // 1. Update media_items strictly matching series_identity_key, source_id, and library_id
      const params: unknown[] = [tmdbId, newIdentityKey, 1]
      let sql = 'UPDATE media_items SET series_tmdb_id = ?, series_identity_key = ?, user_fixed_match = ?'

      if (originalLanguage) {
        sql += ', original_language = ?'
        params.push(originalLanguage)
      }

      if (posterUrl) {
        sql += ', poster_url = ?'
        params.push(posterUrl)
      }
      if (newSeriesTitle) {
        sql += ', series_title = ?'
        params.push(newSeriesTitle)
      }

      if (cleanLibraryId !== null) {
        sql += " WHERE series_identity_key = ? AND source_id = ? AND library_id = ? AND type = 'episode'"
        params.push(seriesIdentityKey, sourceId, cleanLibraryId)
      } else {
        sql += " WHERE series_identity_key = ? AND source_id = ? AND (library_id IS NULL OR library_id = '') AND type = 'episode'"
        params.push(seriesIdentityKey, sourceId)
      }

      this.db!.prepare(sql).run(...params)

      // 2. Handle series_completeness merge/update to prevent UNIQUE(series_identity_key, source_id, library_id) collision
      const scLibraryId = cleanLibraryId || ''
      const existingNew = this.db!.prepare(
        'SELECT id FROM series_completeness WHERE series_identity_key = ? AND source_id = ? AND library_id = ?'
      ).get(newIdentityKey, sourceId, scLibraryId) as { id: number } | undefined

      const currentOld = this.db!.prepare(
        'SELECT id FROM series_completeness WHERE series_identity_key = ? AND source_id = ? AND library_id = ?'
      ).get(seriesIdentityKey, sourceId, scLibraryId) as { id: number } | undefined

      if (existingNew) {
        // If a row for newIdentityKey already exists in this scope, delete the old row so they do not collide
        if (currentOld && currentOld.id !== existingNew.id) {
          this.db!.prepare('DELETE FROM series_completeness WHERE id = ?').run(currentOld.id)
        }
        let updateNewSql = 'UPDATE series_completeness SET tmdb_id = ?'
        const updateNewParams: unknown[] = [tmdbId]
        if (newSeriesTitle) {
          updateNewSql += ', series_title = ?'
          updateNewParams.push(newSeriesTitle)
        }
        if (posterUrl) {
          updateNewSql += ', poster_url = ?'
          updateNewParams.push(posterUrl)
        }
        updateNewSql += ' WHERE id = ?'
        updateNewParams.push(existingNew.id)
        this.db!.prepare(updateNewSql).run(...updateNewParams)
      } else if (currentOld) {
        // No conflict: update old row to new identity key and TMDB ID
        let scSql = 'UPDATE series_completeness SET series_identity_key = ?, tmdb_id = ?'
        const scParams: unknown[] = [newIdentityKey, tmdbId]
        if (newSeriesTitle) {
          scSql += ', series_title = ?'
          scParams.push(newSeriesTitle)
        }
        if (posterUrl) {
          scSql += ', poster_url = ?'
          scParams.push(posterUrl)
        }
        scSql += ' WHERE id = ?'
        scParams.push(currentOld.id)
        this.db!.prepare(scSql).run(...scParams)
      }

      // Return count of updated episodes strictly in this library scope
      if (cleanLibraryId !== null) {
        const countStmt = this.db!.prepare(
          "SELECT COUNT(*) as count FROM media_items WHERE series_identity_key = ? AND source_id = ? AND library_id = ? AND type = 'episode'"
        )
        return (countStmt.get(newIdentityKey, sourceId, cleanLibraryId) as { count: number })?.count || 0
      } else {
        const countStmt = this.db!.prepare(
          "SELECT COUNT(*) as count FROM media_items WHERE series_identity_key = ? AND source_id = ? AND (library_id IS NULL OR library_id = '') AND type = 'episode'"
        )
        return (countStmt.get(newIdentityKey, sourceId) as { count: number })?.count || 0
      }
    })()
  }

  /**
   * Update movie match (TMDB ID, poster, etc.)
   */
  updateMovieMatch(
    mediaItemId: number,
    tmdbId: string,
    posterUrl?: string,
    title?: string,
    year?: number,
    originalLanguage?: string
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
    if (originalLanguage) {
      sql += ', original_language = ?'
      params.push(originalLanguage)
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
  updateMovieWithTMDBId(mediaItemId: number, tmdbId: string, originalLanguage?: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      "UPDATE media_items SET tmdb_id = ?, original_language = COALESCE(?, original_language) WHERE id = ? AND type = 'movie'"
    ).run(tmdbId, originalLanguage ?? null, mediaItemId)
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
    const deleteVersionsStmt = this.db.prepare('DELETE FROM media_item_versions WHERE media_item_id = ?')
    const deleteCollectionsStmt = this.db.prepare('DELETE FROM media_item_collections WHERE media_item_id = ?')
    const deleteWishlistStmt = this.db.prepare('DELETE FROM wishlist_items WHERE media_item_id = ?')
    const deleteScoreStmt = this.db.prepare('DELETE FROM quality_scores WHERE media_item_id = ?')
    const deleteStmt = this.db.prepare('DELETE FROM media_items WHERE id = ?')

    const transaction = this.db.transaction(() => {
      for (const item of items) {
        if (!validPlexIds.has(item.plex_id)) {
          deleteVersionsStmt.run(item.id)
          deleteCollectionsStmt.run(item.id)
          deleteWishlistStmt.run(item.id)
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
    sourceId: string,
    plexId: string,
    artwork: { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string }
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const updates: string[] = []
    const params: unknown[] = []

    if (artwork.posterUrl !== undefined) {
      updates.push('poster_url = ?')
      params.push(artwork.posterUrl)
    }
    if (artwork.episodeThumbUrl !== undefined) {
      updates.push('episode_thumb_url = ?')
      params.push(artwork.episodeThumbUrl)
    }
    if (artwork.seasonPosterUrl !== undefined) {
      updates.push('season_poster_url = ?')
      params.push(artwork.seasonPosterUrl)
    }

    if (updates.length === 0) return

    updates.push("updated_at = datetime('now')")
    params.push(sourceId, plexId)

    const sql = `UPDATE media_items SET ${updates.join(', ')} WHERE source_id = ? AND plex_id = ?`
    this.db.prepare(sql).run(...params)
  }

  // ============================================================================
  // TRANSACTION SUPPORT
  // ============================================================================

  /**
   * Run a function in a transaction (immediate write lock)
   */
  transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not initialized')
    return (this.db.transaction(fn) as unknown as { immediate: () => T }).immediate()
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
   * Export working document CSV for tracking upgrades and completions
   */
  exportWorkingCSV(options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
    includeMusicUpgrades?: boolean
  }): string {
    if (!this.db) throw new Error('Database not initialized')

    const esc = (val: unknown): string => {
      const str = String(val ?? '')
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const sections: string[] = []

    if (options.includeUpgrades) {
      const rows = this.db.prepare(`
        SELECT mi.title, mi.year, mi.type, mi.series_title, mi.season_number, mi.episode_number,
          qs.quality_tier, qs.tier_score, mi.resolution, mi.video_bitrate_kbps, mi.audio_channels,
          mi.video_codec, mi.audio_codec, mi.file_size_bytes, mi.tmdb_id, mi.imdb_id, mi.file_path,
          ms.display_name as source_name
        FROM media_items mi
        JOIN quality_scores qs ON qs.media_item_id = mi.id
        LEFT JOIN media_sources ms ON ms.source_id = mi.source_id
        WHERE qs.needs_upgrade = 1
        ORDER BY qs.quality_tier, mi.type, mi.title
      `).all() as Array<Record<string, unknown>>

      if (rows.length > 0) {
        const tierOrder = ['SD', '720p', '1080p', '4K']
        const cols = 'Title,Year,Type,Series,Season,Episode,Current Tier,Target Tier,Quality Score,Resolution,Video Bitrate,Audio Channels,Video Codec,Audio Codec,File Size (MB),Source,TMDB ID,IMDB ID,File Path'
        const csvRows = rows.map(r => {
          const currentIdx = tierOrder.indexOf(r.quality_tier as string)
          const targetTier = currentIdx < tierOrder.length - 1 ? tierOrder[currentIdx + 1] : r.quality_tier
          const fileSizeMB = r.file_size_bytes ? Math.round((r.file_size_bytes as number) / 1048576) : ''
          return [
            esc(r.title), r.year || '', r.type || '',
            esc(r.series_title), r.season_number ?? '', r.episode_number ?? '',
            r.quality_tier || '', targetTier, r.tier_score ?? '', r.resolution || '',
            r.video_bitrate_kbps || '', r.audio_channels || '', r.video_codec || '', r.audio_codec || '',
            fileSizeMB, esc(r.source_name), r.tmdb_id || '', r.imdb_id || '', esc(r.file_path),
          ].join(',')
        })
        sections.push(['=== UPGRADE CANDIDATES ===', cols, ...csvRows].join('\n'))
      }
    }

    if (options.includeMissingMovies) {
      const collections = this.db.prepare(`
        SELECT collection_name, missing_movies, completeness_percentage
        FROM movie_collections
        WHERE missing_movies IS NOT NULL AND missing_movies != '[]'
        ORDER BY completeness_percentage DESC, collection_name
      `).all() as Array<{ collection_name: string; missing_movies: string; completeness_percentage: number }>

      if (collections.length > 0) {
        const cols = 'Collection,Movie Title,Year,Release Date,TMDB ID,Collection Completeness %'
        const csvRows: string[] = []
        for (const coll of collections) {
          const movies = JSON.parse(coll.missing_movies) as Array<{ title: string; year?: number; tmdb_id: string; release_date?: string }>
          for (const m of movies) {
            csvRows.push([esc(coll.collection_name), esc(m.title), m.year || '', m.release_date || '', m.tmdb_id || '', coll.completeness_percentage ?? ''].join(','))
          }
        }
        if (csvRows.length > 0) sections.push(['=== MISSING MOVIES (Collections) ===', cols, ...csvRows].join('\n'))
      }
    }

    if (options.includeMissingEpisodes) {
      const series = this.db.prepare(`
        SELECT series_title, missing_episodes, tmdb_id, completeness_percentage
        FROM series_completeness
        WHERE missing_episodes IS NOT NULL AND missing_episodes != '[]'
        ORDER BY series_title
      `).all() as Array<{ series_title: string; missing_episodes: string; tmdb_id: string; completeness_percentage: number }>

      if (series.length > 0) {
        const cols = 'Series Title,Season,Episode,Episode Title,Air Date,TMDB ID,Series Completeness %'
        const csvRows: string[] = []
        for (const s of series) {
          const episodes = JSON.parse(s.missing_episodes) as Array<{ season_number: number; episode_number: number; title?: string; air_date?: string }>
          for (const ep of episodes) {
            csvRows.push([esc(s.series_title), ep.season_number, ep.episode_number, esc(ep.title), ep.air_date || '', s.tmdb_id || '', s.completeness_percentage ?? ''].join(','))
          }
        }
        if (csvRows.length > 0) sections.push(['=== MISSING TV EPISODES ===', cols, ...csvRows].join('\n'))
      }
    }

    if (options.includeMissingAlbums) {
      const artists = this.db.prepare(`
        SELECT artist_name, missing_albums, missing_singles, missing_eps FROM artist_completeness
        WHERE (missing_albums IS NOT NULL AND missing_albums != '[]')
           OR (missing_singles IS NOT NULL AND missing_singles != '[]')
           OR (missing_eps IS NOT NULL AND missing_eps != '[]')
        ORDER BY artist_name
      `).all() as Array<{ artist_name: string; missing_albums: string; missing_singles: string; missing_eps: string }>

      if (artists.length > 0) {
        const cols = 'Artist Name,Album Title,Year,Album Type,MusicBrainz ID'
        const csvRows: string[] = []
        for (const a of artists) {
          const parseAlbums = (json: string, type: string) => {
            const items = JSON.parse(json) as Array<{ title: string; year?: number; musicbrainz_id?: string }>
            for (const item of items) {
              csvRows.push([esc(a.artist_name), esc(item.title), item.year || '', type, item.musicbrainz_id || ''].join(','))
            }
          }
          parseAlbums(a.missing_albums, 'Album')
          parseAlbums(a.missing_singles, 'Single')
          parseAlbums(a.missing_eps, 'EP')
        }
        if (csvRows.length > 0) sections.push(['=== MISSING ALBUMS ===', cols, ...csvRows].join('\n'))
      }
    }

    if (options.includeMusicUpgrades) {
      const rows = this.db.prepare(`
        SELECT ma.title, ma.artist_name, ma.year, mq.quality_tier, mq.needs_upgrade,
          ma.best_audio_codec, ma.avg_audio_bitrate, ma.best_sample_rate, ma.best_bit_depth,
          ms.display_name as source_name
        FROM music_albums ma
        JOIN music_quality_scores mq ON mq.album_id = ma.id
        LEFT JOIN media_sources ms ON ms.source_id = ma.source_id
        WHERE mq.needs_upgrade = 1
        ORDER BY mq.quality_tier, ma.artist_name, ma.title
      `).all() as Array<Record<string, unknown>>

      if (rows.length > 0) {
        const cols = 'Artist,Album,Year,Current Tier,Codec,Bitrate (kbps),Sample Rate,Bit Depth,Source'
        const csvRows = rows.map(r => [
          esc(r.artist_name), esc(r.title), r.year || '', r.quality_tier || '',
          r.best_audio_codec || '', r.avg_audio_bitrate || '', r.best_sample_rate || '',
          r.best_bit_depth || '', esc(r.source_name),
        ].join(','))
        sections.push(['=== MUSIC QUALITY UPGRADES ===', cols, ...csvRows].join('\n'))
      }
    }

    // UTF-8 BOM for Excel compatibility + sections joined by double newline
    return '\uFEFF' + sections.join('\n\n')
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
          console.log(`[BetterSQLite] Could not clear table ${table}`)
        }
      }
    })
    transaction()
  }

  /**
   * Reset library data only — preserves settings, exclusions, sources, and wishlist.
   * Clears all scanned media, quality scores, completeness data, and notifications.
   */
  resetLibraryData(): void {
    if (!this.db) throw new Error('Database not initialized')

    // Order matters: child tables before parent tables (FK constraints)
    const tables = [
      'media_item_collections',
      'media_item_versions',
      'quality_scores',
      'media_items',
      'album_completeness',
      'artist_completeness',
      'music_quality_scores',
      'music_tracks',
      'music_albums',
      'music_artists',
      'movie_collections',
      'series_completeness',
      'person_completeness',
      'notifications',
      'tmdb_cache',
      'library_scans',
      'task_queue',
      'task_events',
      'pending_tasks',
    ]

    const transaction = this.db.transaction(() => {
      for (const table of tables) {
        try {
          this.db!.prepare(`DELETE FROM ${table}`).run()
        } catch {
          console.log(`[BetterSQLite] Could not clear table ${table}`)
        }
      }
    })
    transaction()
    console.log('[BetterSQLite] Library data reset — settings, exclusions, sources, and wishlist preserved')
  }

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  /**
   * Create a notification
   */
  createNotification(notification: Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `)

    const result = stmt.run(
      notification.type,
      notification.title,
      notification.message,
      notification.sourceId || null,
      notification.sourceName || null,
      notification.itemCount || 0,
      notification.metadata ? JSON.stringify(notification.metadata) : '{}'
    )

    this.pruneReadNotifications()
    return Number(result.lastInsertRowid)
  }

  /**
   * Create multiple notifications
   */
  createNotifications(notifications: Array<Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>>): number[] {
    if (!this.db) throw new Error('Database not initialized')

    const ids: number[] = []
    const stmt = this.db.prepare(`
      INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `)

    const transaction = this.db.transaction(() => {
      for (const notification of notifications) {
        const result = stmt.run(
          notification.type,
          notification.title,
          notification.message,
          notification.sourceId || null,
          notification.sourceName || null,
          notification.itemCount || 0,
          notification.metadata ? JSON.stringify(notification.metadata) : '{}'
        )
        ids.push(Number(result.lastInsertRowid))
      }
    })
    transaction()
    this.pruneReadNotifications()

    return ids
  }

  /**
   * Get notifications with optional filtering
   */
  getNotifications(options: GetNotificationsOptions = {}): Notification[] {
    if (!this.db) throw new Error('Database not initialized')

    const { limit = 100, offset = 0, type, unreadOnly = false } = options

    let sql = 'SELECT * FROM notifications WHERE 1=1'
    const params: unknown[] = []

    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }
    if (unreadOnly) {
      sql += ' AND is_read = 0'
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as Array<{
      id: number
      type: string
      title: string
      message: string
      source_id: string | null
      source_name: string | null
      item_count: number
      metadata: string
      is_read: number
      created_at: string
      read_at: string | null
    }>

    return rows.map(row => ({
      id: row.id,
      type: row.type as NotificationType,
      title: row.title,
      message: row.message,
      sourceId: row.source_id || undefined,
      sourceName: row.source_name || undefined,
      itemCount: row.item_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      isRead: row.is_read === 1,
      createdAt: row.created_at,
      readAt: row.read_at || undefined,
    }))
  }

  /**
   * Get unread notifications
   */
  getUnreadNotifications(): Notification[] {
    return this.getNotifications({ unreadOnly: true })
  }

  /**
   * Get notification count
   */
  getNotificationCount(): NotificationCountResult {
    if (!this.db) throw new Error('Database not initialized')

    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM notifications')
    const unreadStmt = this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0')

    return {
      total: (totalStmt.get() as { count: number }).count,
      unread: (unreadStmt.get() as { count: number }).count,
    }
  }

  /**
   * Mark notifications as read
   */
  markNotificationsRead(ids: number[]): void {
    if (!this.db) throw new Error('Database not initialized')
    if (ids.length === 0) return

    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(`UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids)
  }

  /**
   * Mark all notifications as read
   */
  markAllNotificationsRead(): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare("UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE is_read = 0").run()
  }

  /**
   * Delete notifications
   */
  deleteNotifications(ids: number[]): void {
    if (!this.db) throw new Error('Database not initialized')
    if (ids.length === 0) return

    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`).run(...ids)
  }

  /**
   * Clear all notifications
   */
  clearAllNotifications(): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM notifications').run()
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
   * Returns a Map of tmdb_id → MediaItem
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
      const rows = stmt.all(...batch).map((row) => this.mapMediaItem(row as Record<string, unknown>))
      for (const row of rows) {
        if (row.tmdb_id) result.set(row.tmdb_id, row)
      }
    }
    return result
  }

  /**
   * Get episode count for a TV show by its series-level TMDB ID
   */
  getEpisodeCountBySeriesTmdbId(seriesTmdbId: string, seasonNumber?: number): number {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_tmdb_id = ?" +
      (seasonNumber === undefined ? '' : ' AND season_number = ?')
    )
    return (stmt.get(...(seasonNumber === undefined ? [seriesTmdbId] : [seriesTmdbId, seasonNumber])) as { count: number }).count
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
   * Returns a Map of musicbrainz_id → MusicAlbum
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
   * Resolve wishlist tracks by MusicBrainz IDs with one batched query.
   */
  getMusicTracksByMusicbrainzIds(ids: string[]): Map<string, MusicTrack> {
    if (!this.db) throw new Error('Database not initialized')
    const result = new Map<string, MusicTrack>()
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500)
      const placeholders = batch.map(() => '?').join(',')
      const rows = this.db.prepare(`SELECT * FROM music_tracks WHERE musicbrainz_id IN (${placeholders})`).all(...batch) as MusicTrack[]
      for (const row of rows) if (row.musicbrainz_id) result.set(row.musicbrainz_id, row)
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
   * Returns a Map of media_item_id → QualityScore
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

    this.pruneTaskHistory()
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

    this.pruneActivityLog()
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
  // Pending task queue persistence
  // ============================================================================

  savePendingTasks(tasks: Array<{
    taskId: string; type: string; label: string
    sourceId?: string; libraryId?: string; artistId?: number; createdAt: string; payload?: unknown
  }>): void {
    if (!this.db) return
    const save = this.db.transaction(() => {
      this.db!.prepare('DELETE FROM pending_tasks').run()
      const insert = this.db!.prepare(
        `INSERT INTO pending_tasks(position, task_id, type, label, source_id, library_id, artist_id, created_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      tasks.forEach((t, i) => {
        insert.run(i, t.taskId, t.type, t.label, t.sourceId ?? null, t.libraryId ?? null, t.artistId ?? null, t.createdAt, t.payload === undefined ? null : JSON.stringify(t.payload))
      })
    })
    save()
  }

  getPendingTasks(): Array<{
    taskId: string; type: string; label: string
    sourceId: string | null; libraryId: string | null; artistId: number | null; createdAt: string; payloadJson: string | null
  }> {
    if (!this.db) return []
    return (this.db.prepare(
      'SELECT task_id as taskId, type, label, source_id as sourceId, library_id as libraryId, artist_id as artistId, created_at as createdAt, payload_json as payloadJson FROM pending_tasks ORDER BY position ASC'
    ).all() as Array<{ taskId: string; type: string; label: string; sourceId: string | null; libraryId: string | null; artistId: number | null; createdAt: string; payloadJson: string | null }>)
  }

  clearPendingTasks(): void {
    if (!this.db) return
    this.db.prepare('DELETE FROM pending_tasks').run()
  }

  // ============================================================================
  // PERSON FILMOGRAPHY COMPLETENESS
  // ============================================================================

  upsertPersonCompleteness(data: {
    person_type: string; person_name: string; tmdb_person_id: number
    total_movies: number; owned_movies: number
    missing_movies: string; owned_movie_ids: string
    completeness_percentage: number; profile_url?: string
  }): number {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(`
      INSERT INTO person_completeness (person_type, person_name, tmdb_person_id, total_movies, owned_movies, missing_movies, owned_movie_ids, completeness_percentage, profile_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(person_type, tmdb_person_id) DO UPDATE SET
        person_name = excluded.person_name,
        total_movies = excluded.total_movies,
        owned_movies = excluded.owned_movies,
        missing_movies = excluded.missing_movies,
        owned_movie_ids = excluded.owned_movie_ids,
        completeness_percentage = excluded.completeness_percentage,
        profile_url = COALESCE(excluded.profile_url, person_completeness.profile_url),
        updated_at = datetime('now')
    `).run(
      data.person_type, data.person_name, data.tmdb_person_id,
      data.total_movies, data.owned_movies,
      data.missing_movies, data.owned_movie_ids,
      data.completeness_percentage, data.profile_url || null
    )
    const row = this.db.prepare(
      'SELECT id FROM person_completeness WHERE person_type = ? AND tmdb_person_id = ?'
    ).get(data.person_type, data.tmdb_person_id) as { id: number } | undefined
    return row?.id || 0
  }

  getPersonCompleteness(personType?: string): Array<{
    id: number; person_type: string; person_name: string; tmdb_person_id: number
    total_movies: number; owned_movies: number
    missing_movies: string; owned_movie_ids: string
    completeness_percentage: number; profile_url: string | null
  }> {
    if (!this.db) return []
    const where = personType ? ' WHERE person_type = ?' : ''
    const params = personType ? [personType] : []
    return this.db.prepare(
      `SELECT * FROM person_completeness${where} ORDER BY completeness_percentage DESC, person_name ASC`
    ).all(...params) as Array<{
      id: number; person_type: string; person_name: string; tmdb_person_id: number
      total_movies: number; owned_movies: number
      missing_movies: string; owned_movie_ids: string
      completeness_percentage: number; profile_url: string | null
    }>
  }

  deletePersonCompleteness(id: number): void {
    if (!this.db) return
    this.db.prepare('DELETE FROM person_completeness WHERE id = ?').run(id)
  }
}
