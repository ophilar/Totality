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

  constructor() {
    try {
      if (process.env.NODE_ENV === 'test') {
        const tempDir = path.join(process.cwd(), 'tests', 'tmp')
        if (!require('fs').existsSync(tempDir)) require('fs').mkdirSync(tempDir, { recursive: true })
        this.dbPath = path.join(tempDir, `test-${Math.random().toString(36).substring(7)}.db`)
      } else {
        const userDataPath = app.getPath('userData')
        this.dbPath = path.join(userDataPath, 'totality.db')
      }
    } catch (e) {
      // Fallback for testing environments where app.getPath might fail
      this.dbPath = path.join(process.cwd(), `totality-test-${Math.random().toString(36).substring(7)}.db`)
    }
  }

  public async initialize(): Promise<void> {
    if (this._isInitialized) return

    try {
      this.db = new DatabaseSync(this.dbPath)
      
      // Optimization: WAL mode for better concurrency
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = NORMAL')
      this.db.exec('PRAGMA foreign_keys = ON')
      
      // Run migrations
      await runMigrations(this.db)
      
      this._isInitialized = true
      getLoggingService().info('Database', `Initialized at ${this.dbPath}`)
    } catch (error) {
      getLoggingService().error('Database', `Initialization failed: ${error}`)
      throw error
    }
  }

  public close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this._isInitialized = false
      getLoggingService().info('Database', 'Closed')
    }
  }

  get isInitialized(): boolean { return this._isInitialized }

  // Lazy-loaded repository getters
  public get config(): ConfigRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._configRepo) this._configRepo = new ConfigRepository(this.db)
    return this._configRepo
  }

  public get media(): MediaRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._mediaRepo) this._mediaRepo = new MediaRepository(this.db)
    return this._mediaRepo
  }

  public get music(): MusicRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._musicRepo) this._musicRepo = new MusicRepository(this.db)
    return this._musicRepo
  }

  public get stats(): StatsRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._statsRepo) this._statsRepo = new StatsRepository(this.db)
    return this._statsRepo
  }

  public get notifications(): NotificationRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._notificationRepo) this._notificationRepo = new NotificationRepository(this.db)
    return this._notificationRepo
  }

  public get tvShows(): TVShowRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._tvShowRepo) this._tvShowRepo = new TVShowRepository(this.db)
    return this._tvShowRepo
  }

  public get sources(): SourceRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._sourceRepo) this._sourceRepo = new SourceRepository(this.db)
    return this._sourceRepo
  }

  public get wishlist(): WishlistRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._wishlistRepo) this._wishlistRepo = new WishlistRepository(this.db)
    return this._wishlistRepo
  }

  public get exclusions(): ExclusionRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._exclusionRepo) this._exclusionRepo = new ExclusionRepository(this.db)
    return this._exclusionRepo
  }

  public get tasks(): TaskRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._taskRepo) this._taskRepo = new TaskRepository(this.db)
    return this._taskRepo
  }

  public get duplicates(): DuplicateRepository {
    if (!this.db) throw new Error('Database not initialized')
    if (!this._duplicateRepo) this._duplicateRepo = new DuplicateRepository(this.db)
    return this._duplicateRepo
  }

  // --- Core Database Methods ---
  public getDbPath(): string { return this.dbPath }
  
  public getSetting(key: string, defaultValue?: any) { return this.config.getSetting(key) || defaultValue }
  public setSetting(key: string, value: any) { return this.config.setSetting(key, String(value)) }
  public deleteSetting(key: string) { return this.config.deleteSetting(key) }

  public beginBatch(): void { this.db?.exec('BEGIN IMMEDIATE') }
  public startBatch(): void { this.beginBatch() }
  public endBatch(): void { this.db?.exec('COMMIT') }
  public forceSave(): void { this.db?.exec('PRAGMA wal_checkpoint(TRUNCATE)') }

  public exportData(): any {
    if (!this.db) throw new Error('Database not initialized')
    const data: any = { _meta: [{ version: 1, exported_at: new Date().toISOString() }] }
    const tables = ['settings', 'media_sources', 'library_scans', 'media_items', 'music_artists', 'music_albums', 'music_tracks', 'quality_scores', 'series_completeness', 'movie_collections', 'exclusions']
    
    for (const table of tables) {
      try {
        data[table] = (this.db as any).prepare(`SELECT * FROM ${table}`).all()
      } catch (e) {
        getLoggingService().warn('Database', `Could not export table ${table}: ${e}`)
      }
    }
    return data
  }

  public async importData(data: any): Promise<{ imported: number, errors: number }> {
    if (!this.db) throw new Error('Database not initialized')
    let imported = 0
    let errors = 0

    this.db.exec('BEGIN TRANSACTION')
    try {
      for (const [table, rows] of Object.entries(data)) {
        if (table === '_meta' || !Array.isArray(rows)) continue
        
        for (const row of rows) {
          try {
            const keys = Object.keys(row as any)
            const placeholders = keys.map(() => '?').join(',')
            const columns = keys.join(',')
            this.db.prepare(`INSERT OR REPLACE INTO ${table} (${columns}) VALUES (${placeholders})`).run(...(Object.values(row as any) as any[]))
            imported++
          } catch (e) {
            errors++
          }
        }
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return { imported, errors }
  }

  public async resetDatabase(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const tables = ['settings', 'media_sources', 'library_scans', 'media_items', 'music_artists', 'music_albums', 'music_tracks', 'quality_scores', 'series_completeness', 'movie_collections', 'exclusions', 'media_item_versions', 'media_item_collections']
    
    this.db.exec('BEGIN TRANSACTION')
    try {
      for (const table of tables) {
        this.db.exec(`DELETE FROM ${table}`)
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
}
