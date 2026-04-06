// @ts-nocheck
import { getLoggingService } from '../services/LoggingService'
import { DatabaseSync } from 'node:sqlite'
import * as path from 'path'
import { app } from 'electron'
import { runMigrations } from './DatabaseMigration'
import {
  ConfigRepository,
  MediaRepository,
  MusicRepository,
  StatsRepository,
  NotificationRepository,
  TVShowRepository,
  SourceRepository,
  WishlistRepository,
  ExclusionRepository,
  TaskRepository
} from './repositories'
import type {
  MediaItem,
  MediaItemFilters,
  MediaSource,
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicFilters,
  WishlistItem,
  WishlistFilters,
  TVShowFilters,
  SeriesCompleteness,
} from '../types/database'
import type {
  Notification,
  NotificationCountResult,
  GetNotificationsOptions,
} from '../types/monitoring'

// Singleton instance
let serviceInstance: BetterSQLiteService | null = null

export function getBetterSQLiteService(): BetterSQLiteService {
  if (!serviceInstance) {
    serviceInstance = new BetterSQLiteService()
  }
  return serviceInstance
}

/**
 * BetterSQLiteService - High-performance database service
 */
export class BetterSQLiteService {
  private db: DatabaseSync.Database | null = null
  private dbPath: string
  private _isInitialized = false
  private _inBatch = false

  // Repositories
  private _configRepo: ConfigRepository | null = null
  private _mediaRepo: MediaRepository | null = null
  private _musicRepo: MusicRepository | null = null
  private _statsRepo: StatsRepository | null = null
  private _notificationRepo: NotificationRepository | null = null
  private _tvShowRepo: TVShowRepository | null = null
  private _sourceRepo: SourceRepository | null = null
  private _wishlistRepo: WishlistRepository | null = null
  private _exclusionRepo: ExclusionRepository | null = null
  private _taskRepo: TaskRepository | null = null

  get isInitialized(): boolean { return this._isInitialized }

  // Lazy-loaded repository getters
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

  private get tvShowRepo(): TVShowRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._tvShowRepo) this._tvShowRepo = new TVShowRepository(this.db)
    return this._tvShowRepo
  }

  private get sourceRepo(): SourceRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._sourceRepo) this._sourceRepo = new SourceRepository(this.db)
    return this._sourceRepo
  }

  private get wishlistRepo(): WishlistRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._wishlistRepo) this._wishlistRepo = new WishlistRepository(this.db)
    return this._wishlistRepo
  }

  private get exclusionRepo(): ExclusionRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._exclusionRepo) this._exclusionRepo = new ExclusionRepository(this.db)
    return this._exclusionRepo
  }

  private get taskRepo(): TaskRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._taskRepo) this._taskRepo = new TaskRepository(this.db)
    return this._taskRepo
  }

  constructor() {
    try {
      const userDataPath = app.getPath('userData')
      this.dbPath = path.join(userDataPath, 'totality-v2.db')
    } catch {
      this.dbPath = ':memory:'
    }
  }

  initialize(): void {
    if (this._isInitialized) return

    try {
      this.db = new DatabaseSync(this.dbPath)
      this.db.exec('PRAGMA ' + 'journal_mode = WAL')
      this.db.exec('PRAGMA ' + 'synchronous = NORMAL')
      this.db.exec('PRAGMA ' + 'cache_size = -32000')
      this.db.exec('PRAGMA ' + 'foreign_keys = ON')
      this.db.exec('PRAGMA ' + 'temp_store = MEMORY')
      this.db.exec('PRAGMA ' + 'busy_timeout = 5000')

      runMigrations(this.db as any)
      this._isInitialized = true
      getLoggingService().info('[BetterSQLiteService]', 'Database initialized')
    } catch (error) {
      getLoggingService().error('[BetterSQLiteService]', 'Database initialization failed:', error)
      throw error
    }
  }

  close(): void {
    if (this.db) {
      this.db.exec('PRAGMA ' + 'optimize')
      this.db.close()
      this.db = null
      this._isInitialized = false
    }
  }

  getDbPath(): string { return this.dbPath }

  // Batch operations
  startBatch(): void {
    if (this._inBatch) return
    this.db?.exec('BEGIN DEFERRED')
    this._inBatch = true
  }

  endBatch(): void {
    if (!this._inBatch) return
    this.db?.exec('COMMIT')
    this._inBatch = false
  }

  forceSave(): void {
    if (this.db) this.db.exec('PRAGMA ' + 'wal_checkpoint(TRUNCATE)')
  }

  // --- Configuration ---
  getSetting(key: string): string | null { return this.configRepo.getSetting(key) }
  setSetting(key: string, value: string): void { this.configRepo.setSetting(key, value) }
  getAllSettings(): Record<string, string> { return this.configRepo.getAllSettings() }
  getSettingsByPrefix(prefix: string): Record<string, string> { return this.configRepo.getSettingsByPrefix(prefix) }

  // --- Sources ---
  getMediaSources(type?: string): MediaSource[] {
    const all = this.sourceRepo.getMediaSources()
    return type ? all.filter(s => s.source_type === type) : all
  }
  getEnabledMediaSources(): MediaSource[] {
    return this.sourceRepo.getMediaSources().filter(s => s.is_enabled)
  }
  getMediaSourceById(id: string): MediaSource | null { return this.sourceRepo.getMediaSourceById(id) }
  upsertMediaSource(source: any): number { return this.sourceRepo.upsertMediaSource(source) }
  deleteMediaSource(id: string): void { this.sourceRepo.deleteMediaSource(id) }
  toggleMediaSource(id: string, enabled: boolean): void {
    const source = this.sourceRepo.getMediaSourceById(id)
    if (source) {
      this.sourceRepo.upsertMediaSource({ ...source, is_enabled: enabled })
    }
  }
  updateSourceConnectionTime(id: string): void {
    this.db?.prepare("UPDATE media_sources SET last_connected_at = datetime('now') WHERE source_id = ?").run(id)
  }
  getSourceLibraries(id: string): any[] {
    return this.db?.prepare('SELECT DISTINCT library_id as id, library_id as name FROM media_items WHERE source_id = ?').all(id) || []
  }
  isLibraryEnabled(sourceId: string, libraryId: string): boolean {
    const row = this.db?.prepare('SELECT is_enabled FROM library_scans WHERE source_id = ? AND library_id = ?').get(sourceId, libraryId) as { is_enabled: number } | undefined
    return row ? row.is_enabled === 1 : true
  }
  toggleLibrary(sourceId: string, libraryId: string, enabled: boolean): void {
    this.db?.prepare(`
      INSERT INTO library_scans (source_id, library_id, is_enabled, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, library_id) DO UPDATE SET is_enabled = ?, updated_at = datetime('now')
    `).run(sourceId, libraryId, enabled ? 1 : 0, enabled ? 1 : 0)
  }
  setLibrariesEnabled(sourceId: string, libraries: Array<{ id: string; enabled: boolean }>): void {
    this.db?.exec('BEGIN DEFERRED')
    try {
      for (const lib of libraries) this.toggleLibrary(sourceId, lib.id, lib.enabled)
      this.db?.exec('COMMIT')
    } catch(err) { this.db?.exec('ROLLBACK'); throw err; }
  }
  getEnabledLibraryIds(sourceId: string): string[] {
    const rows = this.db?.prepare('SELECT library_id FROM library_scans WHERE source_id = ? AND is_enabled = 1').all(sourceId) as Array<{ library_id: string }>
    return rows ? rows.map(r => r.library_id) : []
  }

  // --- Media Items ---
  getMediaItems(filters?: MediaItemFilters): MediaItem[] { return this.mediaRepo.getMediaItems(filters) }
  getMediaItemById(id: number): MediaItem | null { return this.mediaRepo.getById(id) }
  getMediaItemByPlexId(sourceId: string, plexId: string): MediaItem | null { return this.mediaRepo.getMediaItemByProviderId(plexId, sourceId) }
  getMediaItemByProviderId(pId: string, sId: string): MediaItem | null { return this.mediaRepo.getMediaItemByProviderId(pId, sId) }
  getMediaItemByPath(pathStr: string): MediaItem | null { return this.mediaRepo.getMediaItemByPath(pathStr) }
  getMediaItemsCountBySource(sourceId: string): number {
    return this.statsRepo.getMediaItemsCountBySource(sourceId)
  }
  countMediaItems(filters?: MediaItemFilters): number { return this.mediaRepo.getMediaItems(filters).length }
  upsertMediaItem(item: any): number { return this.mediaRepo.upsertMediaItem(item) }
  deleteMediaItem(id: number): void { this.mediaRepo.deleteMediaItem(id) }
  deleteMediaItemsForSource(sourceId: string): void { this.mediaRepo.deleteMediaItemsForSource(sourceId) }
  getMediaItemVersions(id: number): any[] { return this.db?.prepare('SELECT * FROM media_item_versions WHERE media_item_id = ?').all(id) || [] }
  syncMediaItemVersions(id: number, versions: any[]): void {
    this.db?.exec('BEGIN DEFERRED')
    try {
      this.db?.prepare('DELETE FROM media_item_versions WHERE media_item_id = ?').run(id)
      for (const v of versions) {
        this.db?.prepare(`
          INSERT INTO media_item_versions (
            media_item_id, version_source, file_path, file_size, duration,
            resolution, width, height, video_codec, video_bitrate,
            audio_codec, audio_channels, audio_bitrate, is_best
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, v.version_source || 'primary', v.file_path, v.file_size, v.duration, v.resolution, v.width, v.height, v.video_codec, v.video_bitrate, v.audio_codec, v.audio_channels, v.audio_bitrate, v.is_best ? 1 : 0)
      }
      this.db?.exec('COMMIT')
    } catch(err) { this.db?.exec('ROLLBACK'); throw err; }
  }
  updateMovieMatch(id: number, tmdbId: string, poster?: string, title?: string, year?: number): void {
    this.mediaRepo.updateMovieMatch(id, tmdbId, poster, title, year)
  }
  updateMovieWithTMDBId(id: number, tmdbId: string): void {
    this.mediaRepo.updateMovieWithTMDBId(id, tmdbId)
  }
  updateMediaItemArtwork(id: number | string, p: any, art?: any): void {
    if (typeof id === 'number') this.mediaRepo.updateMediaItemArtwork(id, p)
    else { const item = this.mediaRepo.getMediaItemByProviderId(p, id); if (item) this.mediaRepo.updateMediaItemArtwork(item.id!, art) }
  }
  removeStaleMediaItems(ids: Set<string>, type: any): number { return this.mediaRepo.removeStaleMediaItems(ids, type) }
  updateMediaItemVersionQuality(id: number, score: any): void {
    this.db?.prepare('UPDATE media_item_versions SET efficiency_score = ?, storage_debt_bytes = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(score.efficiency_score, score.storage_debt_bytes, id)
  }
  updateBestVersion(itemId: number): void {
    this.db?.exec('BEGIN DEFERRED')
    try {
      this.db?.prepare('UPDATE media_item_versions SET is_best = 0 WHERE media_item_id = ?').run(itemId)
      this.db?.prepare(`
        UPDATE media_item_versions SET is_best = 1 WHERE id = (
          SELECT id FROM media_item_versions WHERE media_item_id = ? ORDER BY efficiency_score DESC, file_size DESC LIMIT 1
        )
      `).run(itemId)
      this.db?.exec('COMMIT')
    } catch(err) { this.db?.exec('ROLLBACK'); throw err; }
  }
  getMediaItemsByTmdbIds(ids: string[]): Map<string, MediaItem> { return this.mediaRepo.getMediaItemsByTmdbIds(ids) }
  addMediaItemToCollection(mediaId: number, collectionId: string | void): void {
    if (!collectionId) return
    this.db?.prepare(`
      INSERT OR IGNORE INTO media_item_collections (media_item_id, tmdb_collection_id, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(mediaId, collectionId)
  }

  // --- TV Shows ---
  getTVShows(filters?: TVShowFilters): any[] { return this.tvShowRepo.getTVShowSummaries(filters) }
  countTVShows(filters?: TVShowFilters): number { return this.tvShowRepo.countTVShows(filters) }
  countTVEpisodes(_filters?: TVShowFilters): number {
    return (this.db?.prepare("SELECT COUNT(*) as count FROM media_items WHERE type = 'episode'").get() as any)?.count || 0
  }
  getTVShowEpisodes(title: string, sourceId?: string): MediaItem[] { return this.tvShowRepo.getTVShowEpisodes(title, sourceId) }
  getSeriesCompleteness(sourceId?: string): any[] { return this.getAllSeriesCompleteness(sourceId) }
  getAllSeriesCompleteness(sourceId?: string, libraryId?: string): any[] {
    let sql = 'SELECT * FROM series_completeness WHERE 1=1'
    const params = []
    if (sourceId) { sql += ' AND source_id = ?'; params.push(sourceId) }
    if (libraryId) { sql += ' AND library_id = ?'; params.push(libraryId) }
    return this.db?.prepare(sql).all(...params) || []
  }
  getIncompleteSeries(sourceId?: string): any[] {
    const sql = 'SELECT * FROM series_completeness WHERE completeness_percentage < 100'
    if (sourceId) return this.db?.prepare(sql + ' AND source_id = ?').all(sourceId) || []
    return this.db?.prepare(sql).all() || []
  }
  getSeriesCompletenessStats(): any { return this.statsRepo.getLibraryStats() } // Use stats repo or implementation
  deleteSeriesCompleteness(id: number): void { this.db?.prepare('DELETE FROM series_completeness WHERE id = ?').run(id) }
  getEpisodesForSeries(title: string, sId?: string, lId?: string): MediaItem[] { return this.mediaRepo.getEpisodesForSeries(title, sId, lId) }
  upsertSeriesCompleteness(data: SeriesCompleteness): number { return this.tvShowRepo.upsertSeriesCompleteness(data) }
  getSeriesCompletenessByTitle(title: string, sId?: string, lId?: string): any { 
    if (!sId) return this.db?.prepare('SELECT * FROM series_completeness WHERE series_title = ? LIMIT 1').get(title)
    return this.tvShowRepo.getSeriesCompletenessByTitle(title, sId, lId || '') 
  }
  getEpisodeCountForSeason(title: string, season: number): number { return this.mediaRepo.getEpisodeCountForSeason(title, season) }
  getEpisodeCountForSeasonEpisode(t: string, s: number, e: number): number { return this.mediaRepo.getEpisodeCountForSeasonEpisode(t, s, e) }
  updateSeriesMatch(t: string, sId: string, tmdbId: string, p?: string, nt?: string): number { return this.mediaRepo.updateSeriesMatch(t, sId, tmdbId, p, nt) }
  getEpisodeCountBySeriesTmdbId(tmdbId: string): number { return this.mediaRepo.getEpisodeCountBySeriesTmdbId(tmdbId) }

  // --- Music ---
  getMusicArtists(filters?: MusicFilters): MusicArtist[] { return this.musicRepo.getMusicArtists(filters) }
  getMusicArtistById(id: number): MusicArtist | null { return this.musicRepo.getMusicArtistById(id) }
  countMusicArtists(filters?: MusicFilters): number { return this.musicRepo.countMusicArtists(filters) }
  getMusicAlbums(filters?: MusicFilters): MusicAlbum[] { return this.musicRepo.getMusicAlbums(filters) }
  getMusicAlbumById(id: number): MusicAlbum | null { return this.musicRepo.getMusicAlbumById(id) }
  countMusicAlbums(filters?: MusicFilters): number { return this.musicRepo.countMusicAlbums(filters) }
  getMusicTracks(filtersOrId: any): MusicTrack[] {
    if (typeof filtersOrId === 'number') return this.musicRepo.getMusicTracks({ albumId: filtersOrId })
    return this.musicRepo.getMusicTracks(filtersOrId)
  }
  countMusicTracks(filters?: MusicFilters): number { return this.musicRepo.countMusicTracks(filters) }
  getMusicTrackByPath(p: string): MusicTrack | null { return this.musicRepo.getMusicTrackByPath(p) }
  getMusicAlbumsByArtistName(name: string, limit?: number): MusicAlbum[] { return this.musicRepo.getMusicAlbumsByArtistName(name, limit) }
  getMusicAlbumsByMusicbrainzIds(ids: string[]): Map<string, MusicAlbum> { return this.musicRepo.getMusicAlbumsByMusicbrainzIds(ids) }
  getMusicTracksByAlbumIds(albumIds: number[]): Map<number, MusicTrack[]> { return this.musicRepo.getMusicTracksByAlbumIds(albumIds) }
  getMusicTrackByMusicbrainzId(id: string): MusicTrack | null { return this.musicRepo.getMusicTrackByMusicbrainzId(id) }
  upsertMusicQualityScore(score: any): void { this.musicRepo.upsertMusicQualityScore(score) }
  getMusicQualityScore(id: number): any { return this.musicRepo.getMusicQualityScore(id) }
  upsertArtistCompleteness(data: any): void { this.musicRepo.upsertArtistCompleteness(data) }
  getArtistCompleteness(name: string): any { return this.musicRepo.getArtistCompleteness(name) }
  getAllArtistCompleteness(sourceId?: string): any[] { return this.musicRepo.getAllArtistCompleteness(sourceId) }
  upsertAlbumCompleteness(data: any): void { this.musicRepo.upsertAlbumCompleteness(data) }
  getAllAlbumCompleteness(): any[] { return this.musicRepo.getAllAlbumCompleteness() }
  getAlbumCompleteness(id: number): any { return this.musicRepo.getAlbumCompleteness(id) }
  getIncompleteAlbums(): any[] { return this.musicRepo.getIncompleteAlbums() }
  updateMusicArtistMbid(id: number, mbid: string): void { this.musicRepo.updateMusicArtistMbid(id, mbid) }
  updateMusicAlbumMbid(id: number, mbid: string): void { this.musicRepo.updateMusicAlbumMbid(id, mbid) }
  updateMusicAlbumArtwork(sId: string | number, pId?: string, art?: any): void { this.musicRepo.updateMusicAlbumArtwork(sId as any, pId as any, art) }
  getMusicStats(sourceId?: string): any { return this.musicRepo.getMusicStats(sourceId) }
  getAlbumsNeedingUpgrade(limit?: number, sourceId?: string): any[] { return this.musicRepo.getAlbumsNeedingUpgrade(limit, sourceId) }
  updateArtistMatch(id: number, mbid: string): void { this.musicRepo.updateMusicArtistMbid(id, mbid) }
  updateAlbumMatch(id: number, mbid: string): void { this.musicRepo.updateMusicAlbumMbid(id, mbid) }
  upsertMusicArtist(data: any): number { return this.musicRepo.upsertArtist(data) }
  upsertMusicAlbum(data: any): number { return this.musicRepo.upsertAlbum(data) }
  upsertMusicTrack(data: any): number { return this.musicRepo.upsertTrack(data) }
  updateMusicArtistCounts(id: number, ac: number, tc: number): void { this.musicRepo.updateMusicArtistCounts(id, ac, tc) }
  deleteMusicTrack(id: number): void { this.musicRepo.deleteMusicTrack(id) }
  getMusicArtistByName(name: string, sourceId: string): any { return this.musicRepo.getMusicArtistByName(name, sourceId) }
  getMusicAlbumByName(title: string, artistId: number): any { return this.musicRepo.getMusicAlbumByName(title, artistId) }

  // --- Notifications ---
  getNotifications(options?: GetNotificationsOptions): Notification[] { return this.notificationRepo.getNotifications(options) }
  getUnreadNotificationCount(): NotificationCountResult { 
    const stats = this.notificationRepo.getUnreadCount()
    return { total: (stats as any).total, unread: (stats as any).unread }
  }
  getNotificationCount(): NotificationCountResult { 
    const stats = this.notificationRepo.getUnreadCount()
    return { total: (stats as any).total, unread: (stats as any).unread }
  }
  createNotification(notif: any): number { return this.notificationRepo.createNotification(notif) }
  markNotificationsRead(ids: number[]): void { this.notificationRepo.markAsRead(ids) }
  markAllNotificationsRead(): void { this.db?.prepare('UPDATE notifications SET is_read = 1, read_at = datetime(\'now\') WHERE is_read = 0').run() }
  deleteNotifications(ids: number[]): void { for (const id of ids) this.db?.prepare('DELETE FROM notifications WHERE id = ?').run(id) }
  clearAllNotifications(): void { this.db?.prepare('DELETE FROM notifications').run() }

  // --- Wishlist ---
  getWishlistItems(filters?: WishlistFilters): WishlistItem[] { return this.wishlistRepo.getWishlistItems(filters) }
  getWishlistCount(): number { return (this.db?.prepare('SELECT COUNT(*) as count FROM wishlist_items').get() as any)?.count || 0 }
  wishlistItemExists(tmdbId?: string, mbid?: string, mId?: number): boolean {
    if (tmdbId) return !!this.db?.prepare('SELECT 1 FROM wishlist_items WHERE tmdb_id = ? LIMIT 1').get(tmdbId)
    if (mbid) return !!this.db?.prepare('SELECT 1 FROM wishlist_items WHERE musicbrainz_id = ? LIMIT 1').get(mbid)
    if (mId) return !!this.db?.prepare('SELECT 1 FROM wishlist_items WHERE media_item_id = ? LIMIT 1').get(mId)
    return false
  }
  getWishlistCountsByReason(): any {
    const rows = this.db?.prepare('SELECT reason, COUNT(*) as count FROM wishlist_items GROUP BY reason').all() as Array<{ reason: string; count: number }>
    const counts: Record<string, number> = {}
    if (rows) rows.forEach(r => counts[r.reason] = r.count)
    return counts
  }
  getActiveWishlistItems(): WishlistItem[] { return this.wishlistRepo.getWishlistItems({ status: 'active' }) }
  addWishlistItem(item: any): number { return (this.wishlistRepo as any).add(item) }
  addWishlistItemsBulk(items: any[]): number {
    let count = 0
    this.db?.exec('BEGIN DEFERRED')
    try {
      for (const i of items) { this.addWishlistItem(i); count++ }
      this.db?.exec('COMMIT')
    } catch(err) { this.db?.exec('ROLLBACK'); throw err; }
    return count
  }
  updateWishlistItem(id: number, data: any): void {
    const allowedKeys = [
      'media_type', 'title', 'subtitle', 'year', 'reason', 'tmdb_id', 'imdb_id',
      'musicbrainz_id', 'series_title', 'season_number', 'episode_number',
      'collection_name', 'artist_name', 'album_title', 'poster_url', 'priority',
      'notes', 'status', 'media_item_id'
    ];
    const updates: string[] = [];
    const values: any[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (allowedKeys.includes(k)) {
        updates.push(`${k} = ?`);
        values.push(v);
      }
    }
    if (updates.length === 0) return;
    this.db?.prepare(`UPDATE wishlist_items SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values, id)
  }
  removeWishlistItem(id: number): void { this.db?.prepare('DELETE FROM wishlist_items WHERE id = ?').run(id) }
  getWishlistItemById(id: number): any { return this.db?.prepare('SELECT * FROM wishlist_items WHERE id = ?').get(id) }

  // --- Exclusions ---
  getExclusions(type?: string, parentKey?: string): any[] { return this.exclusionRepo.getExclusions(type, parentKey) }
  isExcluded(type: string, refId?: number, refKey?: string): boolean { return this.exclusionRepo.isExcluded(type, refId, refKey) }
  addExclusion(type: any, refId?: any, refKey?: any, parentKey?: any, title?: any): void {
    this.exclusionRepo.addExclusion({ exclusion_type: type, reference_id: refId, reference_key: refKey, parent_key: parentKey, title })
  }
  removeExclusion(id: number): void { this.db?.prepare('DELETE FROM exclusions WHERE id = ?').run(id) }

  // --- Tasks ---
  addTaskHistory(entry: any): number { return this.taskRepo.addTaskHistory(entry) }
  getTaskHistory(limit?: number): any[] { return this.taskRepo.getTaskHistory(limit) }
  saveActivityLogEntry(entry: any): void { this.taskRepo.addActivityLog({ entry_type: entry.entryType, message: entry.message, task_id: entry.taskId, task_type: entry.taskType }) }
  getActivityLog(type: string, limit: number): any[] { return type === 'task' ? this.taskRepo.getTaskHistory(limit) : this.taskRepo.getActivityLogs(limit) }
  clearTaskHistory(): void { this.taskRepo.clearHistory() }
  clearActivityLog(type: string): void { this.db?.prepare('DELETE FROM activity_log WHERE entry_type = ?').run(type) }
  saveTaskHistory(entry: any): number { return this.taskRepo.addTaskHistory(entry) }

  // --- Stats ---
  getLibraryStats(sourceId?: string): any { return this.statsRepo.getLibraryStats(sourceId) }
  getAggregatedSourceStats(): any { return this.statsRepo.getAggregatedSourceStats() }

  // --- Quality Scores ---
  getQualityScores(): any[] { return this.db?.prepare('SELECT * FROM quality_scores').all() || [] }
  getQualityScoreByMediaId(id: number): any { return this.db?.prepare('SELECT * FROM quality_scores WHERE media_item_id = ?').get(id) }
  getQualityScoresByMediaItemIds(ids: number[]): Map<number, any> {
    const result = new Map<number, any>()
    if (ids.length === 0) return result
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db?.prepare(`SELECT * FROM quality_scores WHERE media_item_id IN (${placeholders})`).all(...ids) as any[]
    if (rows) rows.forEach(r => result.set(r.media_item_id, r))
    return result
  }
  upsertQualityScore(score: any): number {
    const stmt = this.db?.prepare(`
      INSERT INTO quality_scores (media_item_id, overall_score, needs_upgrade, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(media_item_id) DO UPDATE SET
        overall_score = excluded.overall_score,
        needs_upgrade = excluded.needs_upgrade,
        updated_at = datetime('now')
    `)
    return Number(stmt?.run(score.media_item_id, score.overall_score, score.needs_upgrade ? 1 : 0).lastInsertRowid)
  }

  // --- Movie Collections ---
  getMovieCollections(sourceId?: string): any[] { const sql = 'SELECT * FROM movie_collections'; if (sourceId) return this.db?.prepare(sql + ' WHERE source_id = ?').all(sourceId) || []; return this.db?.prepare(sql).all() || [] }
  getIncompleteMovieCollections(sourceId?: string): any[] { const sql = 'SELECT * FROM movie_collections WHERE completeness_percentage < 100'; if (sourceId) return this.db?.prepare(sql + ' AND source_id = ?').all(sourceId) || []; return this.db?.prepare(sql).all() || [] }
  clearMovieCollections(sourceId?: string): void { if (sourceId) this.db?.prepare('DELETE FROM movie_collections WHERE source_id = ?').run(sourceId); else this.db?.prepare('DELETE FROM movie_collections').run() }
  upsertMovieCollection(data: any): void {
    this.db?.prepare(`
      INSERT INTO movie_collections (tmdb_collection_id, collection_name, total_movies, owned_movies, missing_movies, owned_movie_ids, completeness_percentage, source_id, library_id, poster_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(tmdb_collection_id, source_id, library_id) DO UPDATE SET total_movies = excluded.total_movies, owned_movies = excluded.owned_movies, missing_movies = excluded.missing_movies, owned_movie_ids = excluded.owned_movie_ids, completeness_percentage = excluded.completeness_percentage, poster_url = COALESCE(excluded.poster_url, movie_collections.poster_url), updated_at = datetime('now')
    `).run(data.tmdb_collection_id, data.collection_name, data.total_movies, data.owned_movies, data.missing_movies, data.owned_movie_ids, data.completeness_percentage, data.source_id || '', data.library_id || '', data.poster_url || null)
  }
  deleteMovieCollection(id: number): boolean { const result = this.db?.prepare('DELETE FROM movie_collections WHERE id = ?').run(id); return (result?.changes || 0) > 0 }
  getMovieCollectionStats(): any { return this.db?.prepare('SELECT COUNT(*) as total, AVG(completeness_percentage) as avg_completeness FROM movie_collections').get() }

  // --- Utils ---
  getLetterOffset(table: any, letter: any, filters: any): number { return this.mediaRepo.getLetterOffset(table, letter, filters) }
  getLibraryScanTime(sourceId: string, libraryId: string): string | null { const row = this.db?.prepare('SELECT last_scan_at FROM library_scans WHERE source_id = ? AND library_id = ?').get(sourceId, libraryId) as { last_scan_at: string } | undefined; return row ? row.last_scan_at : null }
  getLibraryScanTimes(sourceId: string): Map<string, any> {
    const result = new Map<string, any>()
    const rows = this.db?.prepare('SELECT library_id, last_scan_at, items_scanned FROM library_scans WHERE source_id = ?').all(sourceId) as any[]
    if (rows) rows.forEach(r => result.set(r.library_id, r))
    return result
  }
  globalSearch(query: string, limit = 5): any {
    const q = `%${query}%`
    return {
      movies: this.db?.prepare("SELECT * FROM media_items WHERE type = 'movie' AND title LIKE ? LIMIT ?").all(q, limit) || [],
      tvShows: this.db?.prepare("SELECT DISTINCT series_title as title FROM media_items WHERE type = 'episode' AND series_title LIKE ? LIMIT ?").all(q, limit) || [],
      artists: this.db?.prepare("SELECT * FROM music_artists WHERE name LIKE ? LIMIT ?").all(q, limit) || [],
      albums: this.db?.prepare("SELECT * FROM music_albums WHERE title LIKE ? LIMIT ?").all(q, limit) || []
    }
  }
  resetDatabase(): void {
    const tables = ['media_items', 'media_sources', 'music_artists', 'music_albums', 'music_tracks', 'notifications', 'settings', 'task_history', 'activity_log', 'exclusions', 'library_scans', 'movie_collections', 'series_completeness', 'music_quality_scores', 'artist_completeness', 'album_completeness']
    this.db?.exec('BEGIN DEFERRED')
    try {
      for (const t of tables) this.db?.prepare(`DELETE FROM ${t}`).run()
      this.db?.exec('COMMIT')
    } catch(err) { this.db?.exec('ROLLBACK'); throw err; }
  }

  // --- Scan Tracking ---
  updateLibraryScanTime(sourceId: string, libraryId: string, _name: string, _type: string, items: number): void {
    this.db?.prepare(`
      INSERT INTO library_scans (source_id, library_id, last_scan_at, items_scanned, created_at, updated_at)
      VALUES (?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, library_id) DO UPDATE SET last_scan_at = datetime('now'), items_scanned = ?, updated_at = datetime('now')
    `).run(sourceId, libraryId, items, items)
    this.sourceRepo.updateLastScanAt(sourceId)
  }
  updateSourceScanTime(sourceId: string): void { this.sourceRepo.updateLastScanAt(sourceId) }

  // Backup/Export
  exportData(): any { return { settings: this.getAllSettings() } }
  exportWorkingCSV(_options: any): string { return 'Not implemented in this version' }
  async importData(_data: any): Promise<any> { return { success: true } }
}
