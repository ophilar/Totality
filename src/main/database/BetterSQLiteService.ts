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
  TaskRepository,
  DuplicateRepository
} from './repositories'

// Singleton instance
let serviceInstance: BetterSQLiteService | null = null

export function getBetterSQLiteService(): BetterSQLiteService {
  if (!serviceInstance) {
    serviceInstance = new BetterSQLiteService()
  }
  return serviceInstance
}

export function resetBetterSQLiteServiceForTesting(): void {
  if (serviceInstance) {
    serviceInstance.close()
    serviceInstance = null
  }
}

/**
 * BetterSQLiteService - High-performance database service container
 * Provides access to repositories and manages database lifecycle.
 */
export class BetterSQLiteService {
  private db: DatabaseSync | null = null
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
  private _duplicateRepo: DuplicateRepository | null = null

  get isInitialized(): boolean { return this._isInitialized }

  // Lazy-loaded repository getters
  public get configRepo(): ConfigRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._configRepo) this._configRepo = new ConfigRepository(this.db)
    return this._configRepo
  }

  public get mediaRepo(): MediaRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._mediaRepo) this._mediaRepo = new MediaRepository(this.db)
    return this._mediaRepo
  }

  public get musicRepo(): MusicRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._musicRepo) this._musicRepo = new MusicRepository(this.db)
    return this._musicRepo
  }

  public get statsRepo(): StatsRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._statsRepo) this._statsRepo = new StatsRepository(this.db)
    return this._statsRepo
  }

  public get notificationRepo(): NotificationRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._notificationRepo) this._notificationRepo = new NotificationRepository(this.db)
    return this._notificationRepo
  }

  public get tvShowRepo(): TVShowRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._tvShowRepo) this._tvShowRepo = new TVShowRepository(this.db)
    return this._tvShowRepo
  }

  public get sourceRepo(): SourceRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._sourceRepo) this._sourceRepo = new SourceRepository(this.db)
    return this._sourceRepo
  }

  public get wishlistRepo(): WishlistRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._wishlistRepo) this._wishlistRepo = new WishlistRepository(this.db)
    return this._wishlistRepo
  }

  public get exclusionRepo(): ExclusionRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._exclusionRepo) this._exclusionRepo = new ExclusionRepository(this.db)
    return this._exclusionRepo
  }

  public get taskRepo(): TaskRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._taskRepo) this._taskRepo = new TaskRepository(this.db)
    return this._taskRepo
  }

  public get duplicateRepo(): DuplicateRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._duplicateRepo) this._duplicateRepo = new DuplicateRepository(this.db)
    return this._duplicateRepo
  }

  constructor(customDbPath?: string) {
    try {
      if (customDbPath) {
        this.dbPath = customDbPath
      } else if (process.env.TOTALITY_DB_PATH) {
        this.dbPath = process.env.TOTALITY_DB_PATH
      } else {
        const userDataPath = app.getPath('userData')
        this.dbPath = path.join(userDataPath, 'totality-v2.db')
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'test') {
        this.dbPath = ':memory:'
      } else {
        throw error
      }
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

  // Transaction control
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

  rollback(): void {
    if (!this._inBatch) return
    this.db?.exec('ROLLBACK')
    this._inBatch = false
  }

  forceSave(): void {
    if (this.db) this.db.exec('PRAGMA ' + 'wal_checkpoint(TRUNCATE)')
  }

  // --- COMPATIBILITY SHIMS (Legacy methods that proxy to repos) ---
  // TODO: Remove these after updating all callers
  getSetting(key: string): string | null { return this.configRepo.getSetting(key) }
  setSetting(key: string, value: string): void { this.configRepo.setSetting(key, value) }
  getAllSettings(): Record<string, string> { return this.configRepo.getAllSettings() }
  
  getMediaSources(type?: string): any[] { return this.sourceRepo.getMediaSources(type) }
  getEnabledMediaSources(): any[] { return this.sourceRepo.getEnabledMediaSources() }
  getMediaSourceById(id: string): any { return this.sourceRepo.getMediaSourceById(id) }
  upsertMediaSource(source: any): number { return this.sourceRepo.upsertMediaSource(source) }
  deleteMediaSource(id: string): void { this.sourceRepo.deleteMediaSource(id) }
  toggleMediaSource(id: string, enabled: boolean): void { this.sourceRepo.toggleLibrary(id, '', enabled) } // Approximate legacy
  
  getMediaItems(filters?: any): any[] { return this.mediaRepo.getMediaItems(filters) }
  getMediaItemById(id: number): any { return this.mediaRepo.getMediaItem(id) }
  getMediaItemByPlexId(sourceId: string, plexId: string): any { return this.mediaRepo.getMediaItemByProviderId(plexId, sourceId) }
  getMediaItemByProviderId(pId: string, sId: string): any { return this.mediaRepo.getMediaItemByProviderId(pId, sId) }
  getMediaItemsByTmdbIds(ids: string[]): any { return this.mediaRepo.getMediaItemsByTmdbIds(ids) }
  upsertMediaItem(item: any): number { return this.mediaRepo.upsertMediaItem(item) }
  deleteMediaItem(id: number): void { this.mediaRepo.deleteMediaItem(id) }
  syncMediaItemVersions(id: number, versions: any[]): void { this.mediaRepo.syncMediaItemVersions(id, versions) }
  updateMediaItemArtwork(id: any, art: any): void { this.mediaRepo.updateMediaItemArtwork(id, art) }
  
  getTVShows(filters?: any): any[] { return this.tvShowRepo.getTVShowSummaries(filters) }
  getTVShowEpisodes(title: string, sId?: string): any[] { return this.tvShowRepo.getTVShowEpisodes(title, sId) }
  getEpisodesForSeries(title: string, sId?: string, lId?: string): any[] { return this.mediaRepo.getEpisodesForSeries(title, sId, lId) }
  getSeriesCompleteness(sourceId?: string): any[] { return this.tvShowRepo.getAllSeriesCompleteness(sourceId) }
  getSeriesCompletenessByTitle(title: string, sId: string, lId: string): any { return this.tvShowRepo.getSeriesCompletenessByTitle(title, sId, lId) }
  upsertSeriesCompleteness(data: any): number { return this.tvShowRepo.upsertSeriesCompleteness(data) }
  getIncompleteSeries(sourceId?: string): any[] { return this.tvShowRepo.getIncompleteSeries(sourceId) }
  getSeriesCompletenessStats(): any { return this.statsRepo.getLibraryStats() }
  deleteSeriesCompleteness(id: number): void { this.tvShowRepo.deleteSeriesCompleteness(id) }
  updateSeriesMatch(t: string, sId: string, tmdbId: string, p?: string, nt?: string): number { return this.mediaRepo.updateSeriesMatch(t, sId, tmdbId, p, nt) }
  
  getMusicArtists(filters?: any): any[] { return this.musicRepo.getMusicArtists(filters) }
  getMusicAlbums(filters?: any): any[] { return this.musicRepo.getMusicAlbums(filters) }
  getMusicAlbumsByMusicbrainzIds(ids: string[]): any { return this.musicRepo.getMusicAlbumsByMusicbrainzIds(ids) }
  getMusicTrackByMusicbrainzId(id: string): any { return this.musicRepo.getMusicTrackByMusicbrainzId(id) }
  getMusicTracks(filters?: any): any[] { return this.musicRepo.getMusicTracks(filters) }
  getMusicTracksByAlbumIds(ids: number[]): any { return this.musicRepo.getMusicTracksByAlbumIds(ids) }
  getMusicQualityScore(id: number): any { return this.musicRepo.getMusicQualityScore(id) }
  upsertMusicQualityScore(score: any): void { this.musicRepo.upsertMusicQualityScore(score) }
  upsertArtistCompleteness(data: any): void { this.musicRepo.upsertArtistCompleteness(data) }
  upsertAlbumCompleteness(data: any): void { this.musicRepo.upsertAlbumCompleteness(data) }
  getMusicStats(sourceId?: string): any { return this.musicRepo.getMusicStats(sourceId) }
  
  getNotifications(options?: any): any[] { return this.notificationRepo.getNotifications(options) }
  getNotificationCount(): any { return this.notificationRepo.getUnreadCount() }
  createNotification(notif: any): number { return this.notificationRepo.createNotification(notif) }
  
  getWishlistItems(filters?: any): any[] { return this.wishlistRepo.getWishlistItems(filters) }
  getActiveWishlistItems(): any[] { return this.wishlistRepo.getWishlistItems({ status: 'active' }) }
  addWishlistItem(item: any): number { return this.wishlistRepo.add(item) }
  updateWishlistItem(id: number, updates: any): void { this.wishlistRepo.update(id, updates) }
  deleteWishlistItem(id: number): void { this.wishlistRepo.delete(id) }
  wishlistItemExists(tId?: string, mbId?: string, mId?: number): boolean { return this.wishlistRepo.exists(tId, mbId, mId) }
  getWishlistCount(): number { return this.wishlistRepo.getWishlistCount() }
  getWishlistCountsByReason(): any { return this.wishlistRepo.getCountsByReason() }
  
  getLibraryStats(sourceId?: string): any { return this.statsRepo.getLibraryStats(sourceId) }
  getAggregatedSourceStats(): any { return this.statsRepo.getAggregatedSourceStats() }
  getDashboardSummary(sourceId?: string): any { return this.statsRepo.getDashboardSummary(sourceId) }
  getMovieCollectionStats(): any { return this.statsRepo.getCollectionStats() }

  getMovieCollections(sourceId?: string): any[] {
    return this.db?.prepare('SELECT * FROM movie_collections' + (sourceId ? ' WHERE source_id = ?' : '')).all(...(sourceId ? [sourceId] : [])) || []
  }
  upsertMovieCollection(data: any): void {
    this.db?.prepare(`
      INSERT INTO movie_collections (
        tmdb_collection_id, collection_name, source_id, library_id,
        total_movies, owned_movies, missing_movies, owned_movie_ids,
        completeness_percentage, poster_url, backdrop_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(tmdb_collection_id, source_id, library_id) DO UPDATE SET
        collection_name = excluded.collection_name,
        total_movies = excluded.total_movies,
        owned_movies = excluded.owned_movies,
        missing_movies = excluded.missing_movies,
        owned_movie_ids = excluded.owned_movie_ids,
        completeness_percentage = excluded.completeness_percentage,
        poster_url = excluded.poster_url,
        backdrop_url = excluded.backdrop_url,
        updated_at = datetime('now')
    `).run(
      data.tmdb_collection_id, data.collection_name, data.source_id || '', data.library_id || '',
      data.total_movies, data.owned_movies, data.missing_movies, data.owned_movie_ids,
      data.completeness_percentage, data.poster_url || null, data.backdrop_url || null
    )
  }
  clearMovieCollections(sourceId?: string): void {
    if (sourceId) this.db?.prepare('DELETE FROM movie_collections WHERE source_id = ?').run(sourceId)
    else this.db?.prepare('DELETE FROM movie_collections').run()
  }
  getIncompleteMovieCollections(sourceId?: string): any[] {
    return this.db?.prepare('SELECT * FROM movie_collections WHERE completeness_percentage < 100' + (sourceId ? ' AND source_id = ?' : '')).all(...(sourceId ? [sourceId] : [])) || []
  }
  deleteMovieCollection(id: number): boolean {
    return Number(this.db?.prepare('DELETE FROM movie_collections WHERE id = ?').run(id).changes) > 0
  }

  upsertQualityScore(score: any): number { return this.mediaRepo.upsertQualityScore(score) }
  getQualityScoresByMediaItemIds(ids: number[]): any { return this.mediaRepo.getQualityScoresByMediaItemIds(ids) }
  updateMovieWithTMDBId(id: number, tmdbId: string): void { this.mediaRepo.updateMovieWithTMDBId(id, tmdbId) }
  updateMovieMatch(id: number, tmdbId: string, p?: string, t?: string, y?: number): void { this.mediaRepo.updateMovieMatch(id, tmdbId, p, t, y) }
  getEpisodeCountForSeason(t: string, s: number): number { return this.mediaRepo.getEpisodeCountForSeason(t, s) }
  getEpisodeCountForSeasonEpisode(t: string, s: number, e: number): number { return this.mediaRepo.getEpisodeCountForSeasonEpisode(t, s, e) }
  getMediaItemsByTmdbIds(ids: string[]): any { return this.mediaRepo.getMediaItemsByTmdbIds(ids) }
  updateLibraryScanTime(sourceId: string, libraryId: string, _name: string, _type: string, items: number): void {
    this.sourceRepo.updateLibraryScanTime(sourceId, libraryId, items)
  }
  isLibraryEnabled(sourceId: string, libraryId: string): boolean { return this.sourceRepo.isLibraryEnabled(sourceId, libraryId) }
  getLibraryScanTimes(sourceId: string): any { return this.sourceRepo.getLibraryScanTimes(sourceId) }
  updateSourceScanTime(sourceId: string): void { this.sourceRepo.updateLastScanAt(sourceId) }
  updateSourceConnectionTime(sourceId: string): void { this.sourceRepo.updateSourceConnectionTime(sourceId) }

  resetDatabase(): void {
    const tables = ['media_items', 'media_sources', 'music_artists', 'music_albums', 'music_tracks', 'notifications', 'settings', 'task_history', 'activity_log', 'exclusions', 'library_scans', 'movie_collections', 'series_completeness', 'music_quality_scores', 'artist_completeness', 'album_completeness']
    this.db?.exec('BEGIN DEFERRED')
    try {
      for (const t of tables) this.db?.prepare(`DELETE FROM ${t}`).run()
      this.db?.exec('COMMIT')
    } catch(err) { this.db?.exec('ROLLBACK'); throw err; }
  }

  // Backup/Export
  exportData(): any { return { settings: this.getAllSettings() } }
  async importData(_data: any): Promise<any> { return { success: true } }
}
