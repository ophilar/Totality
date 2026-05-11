import { createClient, Client } from '@libsql/client'
import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import * as path from 'path'
import * as fs from 'fs'
import { runMigrations } from '@main/database/DatabaseMigration'
import { ConfigRepository } from '@main/database/repositories/ConfigRepository'
import { MediaRepository } from '@main/database/repositories/MediaRepository'
import { MusicRepository } from '@main/database/repositories/MusicRepository'
import { StatsRepository } from '@main/database/repositories/StatsRepository'
import { NotificationRepository } from '@main/database/repositories/NotificationRepository'
import { TVShowRepository } from '@main/database/repositories/TVShowRepository'
import { SourceRepository } from '@main/database/repositories/SourceRepository'
import { WishlistRepository } from '@main/database/repositories/WishlistRepository'
import { ExclusionRepository } from '@main/database/repositories/ExclusionRepository'
import { TaskRepository } from '@main/database/repositories/TaskRepository'
import { DuplicateRepository } from '@main/database/repositories/DuplicateRepository'
import { MovieCollectionRepository } from '@main/database/repositories/MovieCollectionRepository'

let serviceInstance: BetterSQLiteService | null = null

/**
 * Get the database service instance (singleton)
 */
export function getDatabase(): BetterSQLiteService {
  return serviceInstance ??= new BetterSQLiteService()
}

/**
 * Returns the current database backend type.
 */
export function getDatabaseBackend(): 'libsql' {
  return 'libsql'
}

export function resetBetterSQLiteServiceForTesting(): void {
  serviceInstance?.close()
  serviceInstance = null
}

/**
 * BetterSQLiteService - Container for the LibSQL client.
 */
export class BetterSQLiteService {
  private _client: Client | null = null
  private _drizzle: LibSQLDatabase<typeof schema> | null = null
  private dbPath: string = ''
  private _transactionDepth = 0
  private repos: Record<string, any> = {}
  private _lock: Promise<void> = Promise.resolve()

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const nextLock = this._lock.then(fn)
    this._lock = nextLock.then(() => {}, () => {})
    return nextLock
  }

  public async initialize(dbPath: string): Promise<void> {
    if (this._client) return
    this.dbPath = dbPath

    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const client = createClient({
      url: `file:${dbPath}`,
    })

    await client.execute('PRAGMA journal_mode = WAL')
    await client.execute('PRAGMA synchronous = NORMAL')
    await client.execute('PRAGMA foreign_keys = ON')
    await client.execute('PRAGMA busy_timeout = 5000')
    
    this._client = client
    this._drizzle = drizzle(client, { schema })

    // Run migrations
    await runMigrations(client)
  }

  public close(): void {
    this._client?.close()
    this._client = null
    this.repos = {}
  }

  get isInitialized(): boolean { return !!this._client }
  public getDbPath(): string { return this.dbPath }

  public get db(): Client {
    if (!this._client) throw new Error('Database not initialized. Call initialize(path) during app startup.')
    return this._client
  }

  public get drizzle(): LibSQLDatabase<typeof schema> {
    if (!this._drizzle) throw new Error('Database not initialized. Call initialize(path) during app startup.')
    return this._drizzle
  }

  // Repository Getters
  public get config() { return this.repos.config ??= new ConfigRepository(this.db as any, this.drizzle) }
  public get media() { return this.repos.media ??= new MediaRepository(this.db as any, this.drizzle) }
  public get music() { return this.repos.music ??= new MusicRepository(this.db as any, this.drizzle) }
  public get stats() { return this.repos.stats ??= new StatsRepository(this.drizzle) }
  public get notifications() { return this.repos.notifications ??= new NotificationRepository(this.db as any, this.drizzle) }
  public get tvShows() { return this.repos.tvShows ??= new TVShowRepository(this.db as any, this.drizzle) }
  public get sources() { return this.repos.sources ??= new SourceRepository(this.db as any, this.drizzle) }
  public get wishlist() { return this.repos.wishlist ??= new WishlistRepository(this.db as any, this.drizzle) }
  public get exclusions() { return this.repos.exclusions ??= new ExclusionRepository(this.db as any, this.drizzle) }
  public get tasks() { return this.repos.tasks ??= new TaskRepository(this.db as any, this.drizzle) }
  public get duplicates() { return this.repos.duplicates ??= new DuplicateRepository(this.db as any, this.drizzle) }
  public get movieCollections() { return this.repos.movieCollections ??= new MovieCollectionRepository(this.db as any, this.drizzle) }

  // Transaction API
  public async beginBatch(): Promise<void> {
    await this.withLock(async () => {
      const isFirst = this._transactionDepth === 0
      this._transactionDepth++
      if (isFirst) {
        await this.db.execute('BEGIN IMMEDIATE')
      }
    })
  }

  public async startBatch(): Promise<void> {
    await this.beginBatch()
  }

  public async endBatch(): Promise<void> {
    await this.withLock(async () => {
      if (this._transactionDepth <= 0) return
      
      const isLast = this._transactionDepth === 1
      if (isLast) {
        await this._client?.execute('COMMIT')
      }
      this._transactionDepth--
    })
  }

  public async rollbackBatch(): Promise<void> {
    await this.withLock(async () => {
      if (this._transactionDepth > 0) {
        await this._client?.execute('ROLLBACK')
        this._transactionDepth = 0
      }
    })
  }

  public isInTransaction(): boolean { return this._transactionDepth > 0 }
  public forceSave(): void { this._client?.execute('PRAGMA wal_checkpoint(PASSIVE)') }

  public async exportData(): Promise<Record<string, any[]>> {
    const data: Record<string, any[]> = { _meta: [{ version: 1, exported_at: new Date().toISOString() }] }
    const tables = ['settings', 'media_sources', 'library_scans', 'media_items', 'music_artists', 'music_albums', 'music_tracks', 'quality_scores', 'series_completeness', 'movie_collections', 'exclusions']
    for (const t of tables) {
      try { 
        const result = await this.db.execute(`SELECT * FROM ${t}`)
        data[t] = result.rows as any[]
      } catch {}
    }
    return data
  }

  public async resetDatabase(): Promise<void> {
    const result = await this.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    const tables = result.rows.map(row => row.name as string)
    
    await this.beginBatch()
    try {
      for (const t of tables) await this._client?.execute(`DELETE FROM ${t}`)
      await this.endBatch()
    } catch (e) {
      await this.rollbackBatch()
      throw e
    }
  }

  public async importData(data: Record<string, any[]>): Promise<{ imported: number, errors: number }> {
    let imported = 0, errors = 0
    await this.beginBatch()
    try {
      for (const [table, rows] of Object.entries(data)) {
        if (table === '_meta' || !Array.isArray(rows)) continue
        for (const row of rows) {
          try {
            const keys = Object.keys(row)
            const cols = keys.join(','), vals = keys.map(() => '?').join(',')
            await this.db.execute({
              sql: `INSERT OR REPLACE INTO ${table} (${cols}) VALUES (${vals})`,
              args: Object.values(row) as any[]
            })
            imported++
          } catch { errors++ }
        }
      }
      await this.endBatch()
    } catch (e) {
      await this.rollbackBatch()
      throw e
    }
    return { imported, errors }
  }
}
