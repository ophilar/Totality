// @ts-nocheck
import { KodiSqlBaseProvider } from './KodiSqlBaseProvider'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import {
  SourceConfig,
  MediaLibrary,
  ProviderType,
} from '../base/MediaProvider'
import {
  QUERY_MOVIE_COUNT,
  QUERY_EPISODE_COUNT,
  QUERY_MUSIC_SONG_COUNT
} from './KodiDatabaseSchema'
import { getLoggingService } from '../../services/LoggingService'
import { getErrorMessage } from '../../services/utils/errorUtils'

/**
 * KodiLocalProvider
 *
 * Implements the MediaProvider interface for a local Kodi installation.
 * Accesses Kodi's SQLite databases directly from the local file system.
 */
export class KodiLocalProvider extends KodiSqlBaseProvider {
  readonly providerType: ProviderType = 'kodi-local' as ProviderType

  private databasePath: string = ''
  private musicDatabasePath: string = ''
  private db: DatabaseSync | null = null
  private musicDb: DatabaseSync | null = null

  constructor(config: SourceConfig) {
    super(config)
    if (config.connectionConfig) {
      this.databasePath = (config.connectionConfig as any).databasePath || ''
      this.musicDatabasePath = (config.connectionConfig as any).musicDatabasePath || ''
    }
  }

  protected async queryAll<T>(sql: string, params: any[] = []): Promise<T[]> {
    const db = await this.getDb()
    return db.prepare(sql).all(...params) as T[]
  }

  protected async queryOne<T>(sql: string, params: any[] = []): Promise<T | null> {
    const db = await this.getDb()
    return (db.prepare(sql).get(...params) as T) || null
  }

  private async getDb(): Promise<DatabaseSync> {
    if (this.db) return this.db
    if (!this.databasePath || !fs.existsSync(this.databasePath)) {
      throw new Error(`Kodi database not found at: ${this.databasePath}`)
    }
    const { DatabaseSync } = await import('node:sqlite')
    this.db = new DatabaseSync(this.databasePath, { readOnly: true })
    return this.db
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    const libraries: MediaLibrary[] = []
    try {
      const movieCount = (await this.queryOne<any>(QUERY_MOVIE_COUNT))?.count || 0
      const episodeCount = (await this.queryOne<any>(QUERY_EPISODE_COUNT))?.count || 0

      if (movieCount > 0) libraries.push({ id: 'movies', name: 'Movies', type: 'movie', itemCount: movieCount })
      if (episodeCount > 0) libraries.push({ id: 'tvshows', name: 'TV Shows', type: 'show', itemCount: episodeCount })
      
      if (this.musicDatabasePath && fs.existsSync(this.musicDatabasePath)) {
        const { DatabaseSync } = await import('node:sqlite')
        const mdb = new DatabaseSync(this.musicDatabasePath, { readOnly: true })
        const songCount = (mdb.prepare(QUERY_MUSIC_SONG_COUNT).get() as any)?.count || 0
        if (songCount > 0) libraries.push({ id: 'music', name: 'Music', type: 'music', itemCount: songCount })
        mdb.close()
      }
    } catch (err) {
      getLoggingService().error('[KodiLocalProvider]', 'Error reading video libraries:', err)
    }
    return libraries
  }

  async testConnection(): Promise<any> {
    try {
      await this.getDb()
      return { success: true, serverName: 'Local Kodi SQLite' }
    } catch (err) {
      return { success: false, error: getErrorMessage(err) }
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
