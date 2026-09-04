import { createClient, Client } from '@libsql/client'
import type { InValue } from '@libsql/client'
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
import { IdentityRepository } from '@main/database/repositories/IdentityRepository'
import { MediaRemuxJobRepository } from '@main/database/repositories/MediaRemuxJobRepository'
import { getErrorMessage } from '@main/services/utils/errorUtils'

let serviceInstance: BetterSQLiteService | null = null
type ExportRow = Record<string, unknown>
type ExportData = Record<string, ExportRow[]>

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
  private repos: Partial<{
    config: ConfigRepository
    media: MediaRepository
    music: MusicRepository
    stats: StatsRepository
    notifications: NotificationRepository
    tvShows: TVShowRepository
    sources: SourceRepository
    wishlist: WishlistRepository
    exclusions: ExclusionRepository
    tasks: TaskRepository
    duplicates: DuplicateRepository
    movieCollections: MovieCollectionRepository
    identities: IdentityRepository
    mediaRemuxJobs: MediaRemuxJobRepository
  }> = {}
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

    // Run credential encryption migration
    const { getCredentialEncryptionService } = await import('@main/services/CredentialEncryptionService')
    
    const encryption = getCredentialEncryptionService()
    await encryption.migrateCredentials(
      async () => this.sources.getSources(),
      async (id, config) => {
        const existing = await this.sources.getSourceById(id)
        if (existing) {
          await this.sources.upsertSource({
            ...existing,
            connection_config: config
          })
        }
      },
      async () => this.config.getAllSettings(),
      async (key, val) => this.config.setSetting(key, val)
    )
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
  public get config() { return this.repos.config ??= new ConfigRepository(this.db, this.drizzle) }
  public get media() { return this.repos.media ??= new MediaRepository(this.db, this.drizzle) }
  public get music() { return this.repos.music ??= new MusicRepository(this.db, this.drizzle) }
  public get stats() { return this.repos.stats ??= new StatsRepository(this.drizzle) }
  public get notifications() { return this.repos.notifications ??= new NotificationRepository(this.db, this.drizzle) }
  public get tvShows() { return this.repos.tvShows ??= new TVShowRepository(this.db, this.drizzle) }
  public get sources() { return this.repos.sources ??= new SourceRepository(this.db, this.drizzle) }
  public get wishlist() { return this.repos.wishlist ??= new WishlistRepository(this.db, this.drizzle) }
  public get exclusions() { return this.repos.exclusions ??= new ExclusionRepository(this.db, this.drizzle) }
  public get tasks() { return this.repos.tasks ??= new TaskRepository(this.db, this.drizzle) }
  public get duplicates() { return this.repos.duplicates ??= new DuplicateRepository(this.db, this.drizzle) }
  public get movieCollections() { return this.repos.movieCollections ??= new MovieCollectionRepository(this.db, this.drizzle) }
  public get identities() { return this.repos.identities ??= new IdentityRepository(this.db) }
  public get mediaRemuxJobs() { return this.repos.mediaRemuxJobs ??= new MediaRemuxJobRepository(this.db, this.drizzle) }

  // Transaction API
  /**
   * Execute a complete, short-lived write transaction under the database lock.
   * The callback must contain local database work only; remote I/O must happen
   * before or after this scope.
   */
  public async withBatch<T>(fn: () => Promise<T>): Promise<T> {
    if (this._transactionDepth !== 0) {
      throw new Error('Cannot start scoped transaction while another batch is active')
    }

    return this.withLock(async () => {
      this._transactionDepth = 1
      try {
        await this.db.execute('BEGIN IMMEDIATE')
        const result = await fn()
        await this.db.execute('COMMIT')
        this._transactionDepth = 0
        return result
      } catch (error) {
        try {
          await this.db.execute('ROLLBACK')
        } catch (rollbackError) {
          if (error && typeof error === 'object') {
            Object.assign(error as Error, { rollbackCause: rollbackError })
          }
        } finally {
          this._transactionDepth = 0
        }
        throw error
      }
    })
  }

  public isInTransaction(): boolean { return this._transactionDepth > 0 }
  public forceSave(): void { this._client?.execute('PRAGMA wal_checkpoint(PASSIVE)') }

  public async exportData(): Promise<ExportData> {
    const data: ExportData = { _meta: [{ version: 1, exported_at: new Date().toISOString() }] }
    const tables = [
      'settings',
      'media_sources',
      'library_scans',
      'media_items',
      'music_artists',
      'music_albums',
      'music_tracks',
      'quality_scores',
      'series_completeness',
      'movie_collections',
      'exclusions'
    ]

    try {
      const tableCheck = await this.db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      const existingTables = new Set(tableCheck.rows.map(row => row.name as string))

      for (const t of tables) {
        if (!existingTables.has(t)) continue
        const result = await this.db.execute(`SELECT * FROM "${t.replace(/"/g, '""')}"`)
        data[t] = result.rows as ExportRow[]
      }
    } catch (e) {
      throw new Error(`Database export failed: ${getErrorMessage(e)}`)
    }
    return data
  }

  public async resetDatabase(): Promise<void> {
    await this.withBatch(async () => {
      const result = await this.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      const tables = result.rows.map(row => row.name as string)
      for (const t of tables) {
        await this._client?.execute(`DELETE FROM "${t.replace(/"/g, '""')}"`)
      }
    })
  }

  public async importData(data: ExportData): Promise<{ imported: number, errors: number }> {
    let imported = 0
    await this.withBatch(async () => {
      const tableCheck = await this.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      const validTables = new Set(tableCheck.rows.map(row => row.name as string))

      for (const [table, rows] of Object.entries(data)) {
        if (table === '_meta' || !Array.isArray(rows) || !validTables.has(table)) continue

        const colCheck = await this.db.execute(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
        const validCols = new Set(colCheck.rows.map(row => row.name as string))

        for (const row of rows) {
          const validEntries = Object.entries(row).filter(([key]) => validCols.has(key))
          if (validEntries.length === 0) continue

          const keys = validEntries.map(([key]) => key)
          const values = validEntries.map(([, val]) => val)

          const cols = keys.map(k => '"' + k.replace(/"/g, '""') + '"').join(',')
          const vals = keys.map(() => '?').join(',')
          await this.db.execute({
            sql: `INSERT OR REPLACE INTO "${table.replace(/"/g, '""')}" (${cols}) VALUES (${vals})`,
            args: values as InValue[]
          })
          imported++
        }
      }
    }).catch((e) => {
      throw new Error(`Database import failed transactionally: ${getErrorMessage(e)}`)
    })
    return { imported, errors: 0 }
  }
}
